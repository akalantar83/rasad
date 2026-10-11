"""Watchlists: analyst-defined keywords / entities / topics. Hits become `watch` signals (and therefore alerts)."""
import time

from . import db
from .text import normalize

SCHEMA = """
CREATE TABLE IF NOT EXISTS watchlists(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, terms TEXT, entities TEXT, topics TEXT, langs TEXT,
  min_articles INTEGER DEFAULT 1, severity TEXT DEFAULT 'warning', enabled INTEGER DEFAULT 1, owner TEXT, created REAL, last_hit REAL);
"""


def init():
    with db.tx() as c:
        c.executescript(SCHEMA)


def _row(w):
    w = dict(w)
    for k in ("terms", "entities", "topics", "langs"):
        w[k] = db.jload(w[k], []) or []
    w["enabled"] = bool(w["enabled"])
    return w


def list_all():
    return [_row(w) for w in db.q("SELECT * FROM watchlists ORDER BY id DESC")]


def save(body, wid=None, owner="system"):
    def L(k):
        v = body.get(k)
        if isinstance(v, str):
            v = [x.strip() for x in v.replace("،", ",").split(",")]
        return [x for x in (v or []) if x][:40]
    terms, ents, topics, langs = L("terms"), L("entities"), L("topics"), L("langs")
    if not (terms or ents or topics):
        raise ValueError("دست‌کم یک واژه، موجودیت یا موضوع لازم است")
    sev = body.get("severity") or "warning"
    if sev not in ("info", "warning", "critical"):
        raise ValueError("سطح نامعتبر")
    row = ((body.get("name") or (terms + ents + topics)[0])[:80], db.jdump(terms), db.jdump(ents), db.jdump(topics), db.jdump(langs),
           max(1, int(body.get("min_articles") or 1)), sev, 1 if body.get("enabled", True) else 0)
    with db.tx() as c:
        if wid:
            if not c.execute("SELECT 1 FROM watchlists WHERE id=?", (wid,)).fetchone():
                raise KeyError(wid)
            c.execute("UPDATE watchlists SET name=?,terms=?,entities=?,topics=?,langs=?,min_articles=?,severity=?,enabled=? WHERE id=?", (*row, wid))
        else:
            wid = c.execute("""INSERT INTO watchlists(name,terms,entities,topics,langs,min_articles,severity,enabled,owner,created)
                               VALUES(?,?,?,?,?,?,?,?,?,?)""", (*row, owner, time.time())).lastrowid
    return _row(db.q1("SELECT * FROM watchlists WHERE id=?", (wid,)))


def delete(wid):
    with db.tx() as c:
        c.execute("DELETE FROM watchlists WHERE id=?", (wid,))


def hits(w, since, limit=200):
    """Articles matching a watchlist since a timestamp (term match on normalized title/lead/fa-title, OR entity mention, AND topic/lang filters)."""
    w = _row(w) if not isinstance(w.get("terms"), list) else w
    rows = db.q("""SELECT a.id,a.title,a.title_fa,a.lead,a.lang,a.category,a.story_id,a.published_at,a.url,s.name sname
                   FROM articles a JOIN sources s ON s.id=a.source_id WHERE a.published_at>? AND a.duplicate_of IS NULL
                   ORDER BY a.published_at DESC LIMIT 3000""", (since,))
    ent_hits = set()
    if w["entities"]:
        ent_hits = {r["article_id"] for r in db.q("SELECT article_id FROM mentions WHERE entity_id IN (%s)" % ",".join("?" * len(w["entities"])), w["entities"])}
    terms = [normalize(t) for t in w["terms"] if t]
    out = []
    for a in rows:
        if w["langs"] and a["lang"] not in w["langs"]:
            continue
        if w["topics"] and a["category"] not in w["topics"]:
            continue
        hit = a["id"] in ent_hits
        if not hit and terms:
            hay = normalize(" ".join(x or "" for x in (a["title"], a["title_fa"], a["lead"])))
            hit = any(t in hay for t in terms)
        if not hit and not terms and not w["entities"]:
            hit = True  # topic-only watchlist
        if hit:
            out.append(a)
            if len(out) >= limit:
                break
    return out


def match(now=None, window_h=6):
    """Build `watch` signals for enabled watchlists (bucketed per 6h window so each burst alerts once)."""
    now = now or time.time()
    bucket = int(now // (window_h * 3600))
    sigs = []
    for w in db.q("SELECT * FROM watchlists WHERE enabled=1"):
        w = _row(w)
        arts = hits(w, now - window_h * 3600)
        if len(arts) < w["min_articles"]:
            continue
        stories = sorted({a["story_id"] for a in arts if a["story_id"]})
        srcs = sorted({a["sname"] for a in arts})
        sigs.append({"type": "watch", "key": f"{w['id']}:{bucket}", "label": f"پایش «{w['name']}»: {len(arts)} خبر از {len(srcs)} منبع",
                     "score": float(len(arts)), "baseline": float(w["min_articles"]), "observed": float(len(arts)), "window": f"{window_h}h",
                     "severity": w["severity"], "story_ids": stories[:20],
                     "explain": "تازه‌ترین: " + " | ".join((a["title_fa"] or a["title"])[:90] for a in arts[:3])})
        with db.tx() as c:
            c.execute("UPDATE watchlists SET last_hit=? WHERE id=?", (now, w["id"]))
    return sigs
