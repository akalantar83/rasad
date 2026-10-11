import calendar
import concurrent.futures as cf
import time
import urllib.robotparser as robotparser
from urllib.parse import urlparse

import feedparser
import httpx
import trafilatura
import yaml

from .. import db, llm, ai
from ..config import settings
from ..text import canonical_url, detect_lang, sha, strip_html, normalize
from .base import Agent

_robots = {}


def robots_ok(url: str) -> bool:
    p = urlparse(url)
    base = f"{p.scheme}://{p.netloc}"
    rp = _robots.get(base)
    if rp is None:
        rp = robotparser.RobotFileParser()
        try:
            r = httpx.get(base + "/robots.txt", timeout=8, follow_redirects=True, headers={"User-Agent": settings.user_agent})
            rp.parse(r.text.splitlines() if r.status_code == 200 else [])
        except Exception:
            rp.parse([])
        _robots[base] = rp
    return rp.can_fetch(settings.user_agent, url)


def sync_sources():
    """Load sources.yaml into DB (keeps runtime state such as fail_count and human activation)."""
    data = yaml.safe_load(open(settings.sources_file, encoding="utf-8")) or {}
    with db.tx() as c:
        for s in data.get("sources", []):
            row = c.execute("SELECT status FROM sources WHERE id=?", (s["id"],)).fetchone()
            status = row["status"] if row else s.get("status", "active")
            meta = {"kind": s.get("kind", "rss"), "query": s.get("query")}
            c.execute("""INSERT INTO sources(id,name,url,homepage,lang,country,type,ownership_group,credibility,topics,status,meta)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,lang=excluded.lang,
                country=excluded.country,type=excluded.type,ownership_group=excluded.ownership_group,meta=excluded.meta""",
                      (s["id"], s["name"], s["url"], s.get("homepage"), s.get("lang"), s.get("country"), s.get("type"),
                       s.get("ownership_group", s["id"]), s.get("credibility", 0.6), db.jdump(s.get("topics", [])), status, db.jdump(meta)))


class SourceScout(Agent):
    name, title_fa = "scout", "کاشف منابع"
    role_fa = "اعتبارسنجی منابع در انتظار تأیید، پایش سلامت و به‌روزرسانی امتیاز اعتبار"

    def run(self, ctx):
        sync_sources()
        out = {"validated": [], "health": []}
        pend = db.q("SELECT * FROM sources WHERE status='pending'")
        for i, s in enumerate(pend):
            ctx.checkpoint()
            try:
                r = httpx.get(s["url"], timeout=15, follow_redirects=True, headers={"User-Agent": settings.user_agent})
                n = len(feedparser.parse(r.content).entries)
                verdict = "ok" if n > 0 else "empty"
            except Exception as e:
                n, verdict = 0, f"error: {e.__class__.__name__}"
            out["validated"].append({"id": s["id"], "name": s["name"], "entries": n, "verdict": verdict,
                                     "robots_ok": robots_ok(s["url"])})
            ctx.progress((i + 1) / max(1, len(pend)) * 0.5, s["name"])
        # health-adjusted credibility (bounded nudges around the prior)
        day = time.time() - 86400
        for s in db.q("SELECT * FROM sources WHERE status='active'"):
            st = db.q1("""SELECT COUNT(*) n, AVG(extraction_quality) q, SUM(duplicate_of IS NOT NULL) d
                         FROM articles WHERE source_id=? AND fetched_at>?""", (s["id"], day))
            health = 1.0 if s["fail_count"] == 0 else max(0.0, 1 - 0.2 * s["fail_count"])
            out["health"].append({"id": s["id"], "items_24h": st["n"], "extract_q": round(st["q"] or 0, 2), "health": health})
        # AI profile for candidate sources (once per source)
        prof_n = 0
        need = [dict(s) for s in pend if not (db.jload(s["meta"], {}) or {}).get("ai_profile")][:8]
        if need and llm.agent_enabled("scout"):
            try:
                profs, used = ai.profile_sources(need)
                ctx.tokens += used
                for sid, pr in profs.items():
                    row = db.q1("SELECT meta FROM sources WHERE id=?", (sid,))
                    meta = db.jload(row["meta"], {}) or {}
                    meta["ai_profile"] = pr
                    with db.tx() as c:
                        c.execute("UPDATE sources SET meta=? WHERE id=?", (db.jdump(meta), sid))
                    prof_n += 1
            except Exception as e:
                ctx.log(f"پروفایل هوش مصنوعی منبع: {e}", "warn")
        out["ai_profiled"] = prof_n
        db.kv_set("scout_report", out)
        ok = [v for v in out["validated"] if v["verdict"] == "ok"]
        return {"summary": f"{len(out['health'])} منبع فعال پایش شد؛ {len(ok)} از {len(pend)} منبع کاندید معتبر و منتظر تأیید انسانی",
                "output": out, "input_summary": f"{len(pend)} منبع کاندید",
                "reasoning": "منبع جدید هرگز خودکار فعال نمی‌شود؛ فقط پس از تأیید انسانی در نمای «منابع». سلامت = نرخ خطای دریافت." + (f" مدل زبانی برای {prof_n} منبع کاندید پروفایل مالکیت/گرایش/اعتبار پیشنهادی ساخت (فقط پیشنهاد؛ تصمیم با انسان)." if prof_n else "")}


def _ts(entry):
    for k in ("published_parsed", "updated_parsed"):
        v = entry.get(k)
        if v:
            return float(calendar.timegm(v))
    return None


class Ingestion(Agent):
    name, title_fa = "ingestion", "تجمیع‌گر"
    role_fa = "دریافت زمان‌بندی‌شده RSS/Atom و GDELT با درخواست شرطی، مدیریت نرخ و تلاش مجدد"

    def _fetch(self, s):
        meta = db.jload(s["meta"], {}) or {}
        headers = {"User-Agent": settings.user_agent}
        if s["etag"]:
            headers["If-None-Match"] = s["etag"]
        if s["modified"]:
            headers["If-Modified-Since"] = s["modified"]
        items = []
        if meta.get("kind") == "gdelt":
            r = httpx.get(s["url"], timeout=25, params={"query": meta["query"], "mode": "artlist", "maxrecords": 75,
                                                        "format": "json", "timespan": "12h", "sort": "datedesc"})
            try:
                arts = r.json().get("articles", [])
            except Exception:
                raise RuntimeError("GDELT rate-limited/non-JSON")
            for a in arts:
                t = a.get("seendate")
                ts = calendar.timegm(time.strptime(t, "%Y%m%dT%H%M%SZ")) if t else None
                items.append({"url": a["url"], "title": a.get("title", ""), "summary": "", "ts": ts,
                              "lang": {"English": "en", "Arabic": "ar", "Persian": "fa"}.get(a.get("language"), None),
                              "domain": a.get("domain")})
            return items, 200, None, None
        for attempt in range(3):
            try:
                r = httpx.get(s["url"], timeout=20, follow_redirects=True, headers=headers)
                break
            except httpx.HTTPError:
                if attempt == 2:
                    raise
                time.sleep(1.5 * (attempt + 1))
        if r.status_code == 304:
            return [], 304, s["etag"], s["modified"]
        r.raise_for_status()
        d = feedparser.parse(r.content)
        for e in d.entries:
            link = e.get("link")
            if not link:
                continue
            summary = strip_html(e.get("summary") or e.get("description") or "")
            items.append({"url": link, "title": strip_html(e.get("title", "")), "summary": summary[:1500], "ts": _ts(e),
                          "authors": [a.get("name") for a in e.get("authors", []) if a.get("name")]})
        return items, r.status_code, r.headers.get("etag"), r.headers.get("last-modified")

    def run(self, ctx):
        sources = db.q("SELECT * FROM sources WHERE status='active'")
        new_ids, report, now = [], [], time.time()
        done = 0
        with cf.ThreadPoolExecutor(settings.fetch_concurrency) as ex:
            futs = {ex.submit(self._fetch, s): s for s in sources}
            for f in cf.as_completed(futs):
                s = futs[f]
                ctx.checkpoint()
                done += 1
                try:
                    items, code, etag, mod = f.result()
                    added = 0
                    with db.tx() as c:
                        for it in items:
                            cu = canonical_url(it["url"])
                            aid = sha(cu)
                            if c.execute("SELECT 1 FROM articles WHERE id=?", (aid,)).fetchone():
                                continue
                            ts = it["ts"] or now
                            ts = min(ts, now)  # guard against future-dated feeds
                            c.execute("""INSERT INTO articles(id,source_id,url,canonical_url,title,lead,text,authors,lang,published_at,
                                       fetched_at,content_hash,stage) VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'raw')""",
                                      (aid, s["id"], it["url"], cu, it["title"], it["summary"], it["summary"],
                                       db.jdump(it.get("authors", [])), it.get("lang") or s["lang"], ts, now,
                                       sha(normalize(it["title"] + it["summary"])), ))
                            new_ids.append(aid)
                            added += 1
                        c.execute("""UPDATE sources SET fail_count=0,last_fetch=?,last_ok=?,last_error=NULL,etag=?,modified=?,
                                  item_count=item_count+? WHERE id=?""", (now, now, etag, mod, added, s["id"]))
                    report.append({"source": s["id"], "status": code, "new": added, "seen": len(items)})
                except Exception as e:
                    fc = s["fail_count"] + 1
                    with db.tx() as c:
                        c.execute("UPDATE sources SET fail_count=?,last_fetch=?,last_error=?,status=? WHERE id=?",
                                  (fc, now, str(e)[:200], "quarantine" if fc >= 5 else "active", s["id"]))
                    report.append({"source": s["id"], "status": "error", "error": str(e)[:120]})
                    ctx.log(f"خطا در دریافت {s['name']}: {str(e)[:80]}", "warn")
                ctx.progress(done / max(1, len(sources)), s["name"])
        ctx.state["new_ids"] = new_ids
        errs = sum(1 for r in report if r["status"] == "error")
        return {"summary": f"{len(new_ids)} خبر جدید از {len(sources)} منبع ({errs} خطا)",
                "input_summary": f"{len(sources)} منبع فعال", "output": {"per_source": report},
                "reasoning": "درخواست شرطی با ETag/Last-Modified؛ شناسه هر خبر = sha256(URL متعارف) تا تکرار درج نشود (Idempotency)؛ قرنطینه پس از ۵ خطای پیاپی."}


class Extractor(Agent):
    name, title_fa = "extractor", "استخراج و نرمال‌سازی"
    role_fa = "استخراج متن کامل (trafilatura) با رعایت robots.txt، تشخیص زبان و نرمال‌سازی فارسی/عربی"

    def _extract(self, a):
        if not robots_ok(a["url"]):
            return None, "robots_disallow"
        r = httpx.get(a["url"], timeout=20, follow_redirects=True, headers={"User-Agent": settings.user_agent})
        if r.status_code != 200:
            return None, f"http_{r.status_code}"
        txt = trafilatura.extract(r.text, include_comments=False, include_tables=False, favor_precision=True)
        meta = trafilatura.extract_metadata(r.text)
        return {"text": txt, "author": getattr(meta, "author", None) if meta else None,
                "date": getattr(meta, "date", None) if meta else None}, "trafilatura"

    def run(self, ctx):
        raw = db.q("SELECT id,url,title,lead,lang,source_id FROM articles WHERE stage='raw' ORDER BY published_at DESC")
        full_budget = settings.fulltext_per_run if settings.fetch_fulltext else 0
        targets = {a["id"] for a in raw[:full_budget]}
        results, methods = {}, {}
        if targets:
            with cf.ThreadPoolExecutor(settings.fetch_concurrency) as ex:
                futs = {ex.submit(self._extract, a): a for a in raw if a["id"] in targets}
                for i, f in enumerate(cf.as_completed(futs)):
                    ctx.checkpoint()
                    a = futs[f]
                    try:
                        results[a["id"]], methods[a["id"]] = f.result()
                    except Exception as e:
                        results[a["id"]], methods[a["id"]] = None, f"error:{e.__class__.__name__}"
                    ctx.progress(0.9 * (i + 1) / len(futs), a["title"][:40])
        langs, ok = {}, 0
        with db.tx() as c:
            for a in raw:
                res = results.get(a["id"])
                text = (res or {}).get("text") or a["lead"] or ""
                method = "trafilatura" if res and res.get("text") else ("feed_summary" if a["id"] not in targets else f"feed_summary({methods.get(a['id'])})")
                lang = detect_lang(a["title"] + " " + text[:400]) or a["lang"]
                quality = min(1.0, len(text) / 2500) if res and res.get("text") else min(0.4, len(text) / 1500)
                ok += 1 if res and res.get("text") else 0
                langs[lang] = langs.get(lang, 0) + 1
                c.execute("""UPDATE articles SET text=?,lang=?,extracted_at=?,extraction_method=?,extraction_quality=?,stage='extracted' WHERE id=?""",
                          (text[:20000], lang, time.time(), method, round(quality, 2), a["id"]))
                c.execute("INSERT INTO articles_fts(id,title,lead,text,title_fa) VALUES(?,?,?,?,?)",
                          (a["id"], normalize(a["title"]), normalize(a["lead"] or ""), normalize(text[:8000]), ""))
        ctx.progress(1)
        return {"summary": f"{len(raw)} خبر پردازش شد؛ متن کامل برای {ok} خبر استخراج شد",
                "input_summary": f"{len(raw)} خبر خام", "output": {"languages": langs, "fulltext_ok": ok, "fulltext_attempted": len(targets)},
                "reasoning": "trafilatura با favor_precision؛ در صورت منع robots.txt یا خطا، خلاصه فید استفاده می‌شود و کیفیت پایین‌تر ثبت می‌شود."}
