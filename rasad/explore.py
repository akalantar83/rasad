"""Advanced search / explore: full-text (FTS5, BM25) with filters, facets, pagination and CSV export."""
import csv
import io
import time

from . import db
from .text import normalize


def _fts_query(q):
    toks = [t.replace('"', "") for t in normalize(q or "").split() if t.strip()]
    return " ".join(f'"{t}"' for t in toks)


def _where(p):
    where, args = ["a.duplicate_of IS NULL"], []
    since = p.get("since") or (time.time() - int(p.get("hours") or 168) * 3600)
    where.append("a.published_at>?"); args.append(float(since))
    if p.get("until"):
        where.append("a.published_at<=?"); args.append(float(p["until"]))
    for key, col in (("lang", "a.lang"), ("category", "a.category"), ("source", "a.source_id"), ("urgency", "a.urgency")):
        vals = [v for v in (p.get(key) or "").split(",") if v]
        if vals:
            where.append(f"{col} IN ({','.join('?' * len(vals))})"); args += vals
    if p.get("entity"):
        where.append("a.id IN (SELECT article_id FROM mentions WHERE entity_id=?)"); args.append(p["entity"])
    return where, args


def search(p):
    q = _fts_query(p.get("q"))
    where, args = _where(p)
    size = max(1, min(100, int(p.get("size") or 25)))
    page = max(1, int(p.get("page") or 1))
    join, rank = "", "a.published_at DESC"
    if q:
        join = "JOIN (SELECT id fid, bm25(articles_fts) r, snippet(articles_fts, 2, '«', '»', '…', 14) snip FROM articles_fts WHERE articles_fts MATCH ?) f ON f.fid=a.id"
        args = [q] + args
        if p.get("sort", "relevance") == "relevance":
            rank = "f.r ASC, a.published_at DESC"
    sel = "a.id,a.title,a.title_fa,a.lead,a.url,a.lang,a.published_at,a.category,a.urgency,a.sentiment,a.story_id,a.source_id,s.name source_name"
    base = f"FROM articles a JOIN sources s ON s.id=a.source_id {join} WHERE {' AND '.join(where)}"
    try:
        total = db.q1(f"SELECT COUNT(*) n {base}", args)["n"]
        rows = db.q(f"SELECT {sel}{', f.snip' if q else ''} {base} ORDER BY {rank} LIMIT ? OFFSET ?", (*args, size, (page - 1) * size))
        facets = {}
        for key, col, lab in (("lang", "a.lang", None), ("category", "a.category", None), ("source", "a.source_id", "s.name")):
            facets[key] = db.q(f"SELECT {col} k, {lab or col} label, COUNT(*) n {base} GROUP BY {col} ORDER BY n DESC LIMIT 30", args)
        hist = db.q(f"SELECT CAST(a.published_at/3600 AS INTEGER)*3600 t, COUNT(*) n {base} GROUP BY t ORDER BY t", args)
    except Exception as e:  # malformed FTS syntax etc.
        raise ValueError("عبارت جست‌وجو نامعتبر است: " + str(e)[:80])
    for r in rows:
        r["lead"] = (r["lead"] or "")[:320]
    return {"total": total, "page": page, "size": size, "pages": (total + size - 1) // size, "items": rows, "facets": facets, "histogram": hist}


def csv_export(p, limit=5000):
    p = dict(p, size=100)
    out = io.StringIO()
    out.write("\ufeff")
    w = csv.writer(out)
    w.writerow(["published_utc", "source", "lang", "category", "urgency", "title", "title_fa", "url", "story_id"])
    page, n = 1, 0
    while n < limit:
        r = search(dict(p, page=page))
        for a in r["items"]:
            w.writerow([time.strftime("%Y-%m-%d %H:%M", time.gmtime(a["published_at"])), a["source_name"], a["lang"], a["category"], a["urgency"],
                        a["title"], a["title_fa"] or "", a["url"], a["story_id"] or ""])
            n += 1
        if page >= r["pages"]:
            break
        page += 1
    return out.getvalue()
