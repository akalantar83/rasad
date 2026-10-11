"""Alert triage workflow: status lifecycle, assignment, notes and a per-alert event history."""
import time

from . import auth, db

STATUSES = {"new": "جدید", "pending": "در انتظار تأیید", "approved": "تأییدشده", "ack": "دیده‌شده", "investigating": "در حال بررسی",
            "resolved": "حل‌شده", "dismissed": "نادیده/کاذب", "rejected": "ردشده"}
OPEN = ("new", "pending", "approved", "ack", "investigating")
TYPES_FA = {"volume_spike": "جهش حجم موضوع", "entity_spike": "جهش اشاره به بازیگر", "new_actor": "بازیگر نوظهور", "fast_spread": "گسترش سریع",
            "watch": "فهرست پایش", "spike": "جهش حجم", "emerging_actor": "بازیگر نوظهور"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS signal_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT, signal_id INTEGER, ts REAL, actor TEXT, action TEXT, status TEXT, note TEXT);
CREATE INDEX IF NOT EXISTS ix_sigev ON signal_events(signal_id);
"""


def init():
    with db.tx() as c:
        c.executescript(SCHEMA)
        cols = {r[1] for r in c.execute("PRAGMA table_info(signals)").fetchall()}
        for col, typ in (("assignee", "TEXT"), ("note", "TEXT"), ("updated", "REAL"), ("updated_by", "TEXT")):
            if col not in cols:
                c.execute(f"ALTER TABLE signals ADD COLUMN {col} {typ}")
        # one-off repair: labels that still carry raw LLM-entity ids («X:foo») get the human name
        for g in c.execute("SELECT id,key,label FROM signals WHERE label LIKE '%«X:%'").fetchall():
            row = c.execute("SELECT name_fa FROM entities WHERE id=?", (g[1],)).fetchone()
            if row and row[0]:
                c.execute("UPDATE signals SET label=? WHERE id=?", (g[2].replace(f"«{g[1]}»", f"«{row[0]}»"), g[0]))


def _row(r):
    r["story_ids"] = db.jload(r["story_ids"], []) or []
    r["explanation"] = db.jload(r["explanation"], {}) or {}
    r["ai"] = db.jload(r.get("ai"), None)
    r["status_fa"] = STATUSES.get(r["status"], r["status"])
    r["type_fa"] = TYPES_FA.get(r["type"], r["type"])
    r["open"] = r["status"] in OPEN
    return r


def listing(hours=168, status=None, severity=None, typ=None, assignee=None, q=None, limit=300):
    where, args = ["created>?"], [time.time() - hours * 3600]
    if status == "open":
        where.append(f"status IN ({','.join('?' * len(OPEN))})"); args += OPEN
    elif status:
        where.append("status=?"); args.append(status)
    if severity:
        where.append("severity=?"); args.append(severity)
    if typ:
        where.append("type=?"); args.append(typ)
    if assignee == "me":
        where.append("assignee=?"); args.append(auth.actor())
    elif assignee:
        where.append("assignee=?"); args.append(assignee)
    if q:
        where.append("label LIKE ?"); args.append(f"%{q}%")
    rows = [_row(r) for r in db.q(f"SELECT * FROM signals WHERE {' AND '.join(where)} ORDER BY created DESC LIMIT ?", (*args, limit))]
    base = time.time() - hours * 3600
    counts = {r["status"]: r["n"] for r in db.q("SELECT status, COUNT(*) n FROM signals WHERE created>? GROUP BY status", (base,))}
    sev = {r["severity"]: r["n"] for r in db.q(f"SELECT severity, COUNT(*) n FROM signals WHERE created>? AND status IN ({','.join('?' * len(OPEN))}) GROUP BY severity", (base, *OPEN))}
    return {"items": rows, "counts": counts, "open": sum(counts.get(s, 0) for s in OPEN), "open_by_severity": sev,
            "statuses": STATUSES, "types": TYPES_FA}


def detail(gid):
    r = db.q1("SELECT * FROM signals WHERE id=?", (gid,))
    if not r:
        raise KeyError(gid)
    r = _row(r)
    ids = r["story_ids"][:12]
    r["stories"] = db.q(f"SELECT id,title,title_fa,category,source_count,last_update FROM stories WHERE id IN ({','.join('?' * len(ids))})", ids) if ids else []
    r["events"] = db.q("SELECT * FROM signal_events WHERE signal_id=? ORDER BY id DESC", (gid,))
    return r


def update(gid, body):
    r = db.q1("SELECT * FROM signals WHERE id=?", (gid,))
    if not r:
        raise KeyError(gid)
    who, now = auth.actor(), time.time()
    sets, args, acts = ["updated=?", "updated_by=?"], [now, who], []
    st = body.get("status")
    if st:
        if st not in STATUSES:
            raise ValueError("وضعیت نامعتبر")
        sets.append("status=?"); args.append(st); acts.append(("status", st))
    if "assignee" in body:
        a = (body.get("assignee") or "").strip() or None
        if a and a != "me" and not db.q1("SELECT 1 FROM users WHERE username=?", (a,)):
            raise ValueError("کاربر مقصد وجود ندارد")
        a = who if a == "me" else a
        sets.append("assignee=?"); args.append(a); acts.append(("assign", a or "—"))
    note = (body.get("note") or "").strip()[:2000]
    if note:
        sets.append("note=?"); args.append(note)
    if not acts and not note:
        raise ValueError("تغییری ارسال نشده است")
    with db.tx() as c:
        c.execute(f"UPDATE signals SET {','.join(sets)} WHERE id=?", (*args, gid))
        for i, (act, val) in enumerate(acts or [("note", None)]):
            c.execute("INSERT INTO signal_events(signal_id,ts,actor,action,status,note) VALUES(?,?,?,?,?,?)",
                      (gid, now, who, act, val, note if i == 0 else None))
    db.audit(who, "alert:" + ",".join(a for a, _ in acts or [("note", None)]), str(gid), {"status": st, "assignee": body.get("assignee")})
    return detail(gid)


def bulk(ids, status):
    out = 0
    for gid in ids[:200]:
        try:
            update(int(gid), {"status": status}); out += 1
        except (KeyError, ValueError):
            pass
    return out
