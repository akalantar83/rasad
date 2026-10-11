import math
import pickle
import time
from collections import Counter

from datasketch import MinHash, MinHashLSH

from .. import db, llm, ai
from ..taxonomy import ENTITY, TOPICS, classify, find_entities
from ..text import shingles, tokens
from .base import Agent
import re

SRC_NOISE = re.compile(r"(france\s?24|فرانس\s?(24|۲۴)|فرانس 24|BBC (Persian|Arabic|News)|بي بي سي|بی‌بی‌سی|DW|دویچه وله|Sky News Arabia|سكاي نيوز عربية|Al Jazeera|الجزيرة|Euronews|UN News)", re.I)


class Classifier(Agent):
    name, title_fa = "classifier", "طبقه‌بند"
    role_fa = "طبقه‌بندی چندبرچسبی موضوع، منطقه، فوریت و احساسات"

    def run(self, ctx):
        rows = db.q("SELECT id,title,lead,text FROM articles WHERE stage='extracted'")
        dist, unl = Counter(), 0
        llm_used = 0
        with db.tx() as c:
            for i, a in enumerate(rows):
                r = classify(f"{a['title']} {a['title']} {a['lead'] or ''} {(a['text'] or '')[:2500]}")
                if not r["topics"]:
                    unl += 1
                dist[r["category"]] += 1
                c.execute("UPDATE articles SET topics=?,urgency=?,sentiment=?,category=?,stage='classified' WHERE id=?",
                          (db.jdump(r["topics"]), r["urgency"], r["sentiment"], r["category"], a["id"]))
                if i % 50 == 0:
                    ctx.checkpoint()
                    ctx.progress((i + 1) / max(1, len(rows)))
        # LLM pass: unlabeled or ambiguous items (top topic share < 0.5), batched 20 per call, max 2 calls per run
        if llm.agent_enabled("classifier") and rows:
            ids = [a["id"] for a in rows]
            cand = []
            for a in db.q("SELECT id,title,lead,topics FROM articles WHERE id IN (%s)" % ",".join("?" * len(ids)), ids):
                t = db.jload(a["topics"], []) or []
                if not t or t[0]["p"] < 0.5:
                    cand.append(a)
            cand = cand[:40]
            for k in range(0, len(cand), 20):
                ctx.checkpoint()
                try:
                    res, used = ai.classify_batch(cand[k:k + 20])
                    ctx.tokens += used
                    with db.tx() as c:
                        for aid, r in res.items():
                            c.execute("UPDATE articles SET topics=?,category=?,urgency=COALESCE(?,urgency),sentiment=? WHERE id=?",
                                      (db.jdump([{"label": x, "p": round(1 / len(r["topics"]), 2)} for x in r["topics"]]), r["topics"][0],
                                       r["urgency"], r["sentiment"], aid))
                    llm_used += len(res)
                except Exception as e:
                    ctx.log(f"LLM classifier: {e}", "warn")
                    break
        return {"summary": f"{len(rows)} خبر طبقه‌بندی شد؛ {unl} بدون برچسب واژگانی" + (f"، {llm_used} با LLM" if llm_used else ""),
                "input_summary": f"{len(rows)} خبر استخراج‌شده", "output": {"by_category": dict(dist), "unlabeled": unl},
                "reasoning": "واژه‌نامه چندزبانه (فا/عر/ان) پس از نرمال‌سازی با وزن دوبرابر عنوان؛ سپس مدل زبانی خبرهای بدون برچسب یا مبهم (سهم موضوع غالب < ۵۰٪) را دسته‌ای (۲۰ خبر در هر فراخوانی) صفر-نمونه طبقه‌بندی و فوریت/احساس را بازبینی می‌کند."}


class EntityRelation(Agent):
    name, title_fa = "entities", "استخراج موجودیت و رابطه"
    role_fa = "NER مبتنی بر فهرست مرجع چندزبانه، پیوند به شناسه یکتا و ساخت لبه‌های گراف دانش"

    def run(self, ctx):
        rows = db.q("SELECT id,title,lead,text,published_at FROM articles WHERE stage='classified'")
        with db.tx() as c:
            for e in ENTITY.values():
                c.execute("""INSERT OR IGNORE INTO entities(id,type,name_fa,name_en,name_ar,lat,lon,iso) VALUES(?,?,?,?,?,?,?,?)""",
                          (e["id"], e["type"], e["name_fa"], e["name_en"], e["name_ar"], e["lat"], e["lon"], e["iso"]))
        n_m, edges = 0, Counter()
        with db.tx() as c:
            for i, a in enumerate(rows):
                ents = find_entities(SRC_NOISE.sub(" ", f"{a['title']} {a['lead'] or ''} {(a['text'] or '')[:4000]}"))
                regions = [k for k in ents if len(k) == 2]
                for eid, surf in ents.items():
                    c.execute("INSERT OR IGNORE INTO mentions(article_id,entity_id,surface) VALUES(?,?,?)", (a["id"], eid, surf))
                    c.execute("UPDATE entities SET mention_count=mention_count+1 WHERE id=?", (eid,))
                    n_m += 1
                ids = sorted(ents)[:12]
                for x in range(len(ids)):
                    for y in range(x + 1, len(ids)):
                        edges[(ids[x], ids[y])] += 1
                        ev = c.execute("SELECT evidence FROM relations WHERE subject_id=? AND predicate='co_mentioned' AND object_id=?",
                                       (ids[x], ids[y])).fetchone()
                        evl = (db.jload(ev["evidence"], []) if ev else [])[-4:] + [a["id"]]
                        c.execute("""INSERT INTO relations(subject_id,predicate,object_id,weight,first_seen,last_seen,evidence)
                                  VALUES(?,?,?,1,?,?,?) ON CONFLICT(subject_id,predicate,object_id) DO UPDATE SET
                                  weight=weight+1,last_seen=excluded.last_seen,evidence=excluded.evidence""",
                                  (ids[x], "co_mentioned", ids[y], a["published_at"], a["published_at"], db.jdump(evl)))
                c.execute("UPDATE articles SET regions=?,stage='enriched' WHERE id=?", (db.jdump(regions), a["id"]))
                if i % 50 == 0:
                    ctx.checkpoint()
                    ctx.progress((i + 1) / max(1, len(rows)))
        top = [{"pair": f"{ENTITY[a]['name_fa']} ↔ {ENTITY[b]['name_fa']}", "n": n} for (a, b), n in edges.most_common(8)]
        llm_ents, llm_rels = self._llm_pass(ctx) if llm.agent_enabled("entities") else (0, 0)
        return {"summary": f"{n_m} اشاره به موجودیت و {len(edges)} رابطه در {len(rows)} خبر" + (f"؛ مدل زبانی: {llm_ents} موجودیت و {llm_rels} رابطه نوع‌دار" if llm_ents or llm_rels else ""),
                "input_summary": f"{len(rows)} خبر", "output": {"top_edges": top, "llm_entities": llm_ents, "llm_relations": llm_rels},
                "reasoning": "پیوند موجودیت با شناسه مستقل از زبان (ISO/ORG/LOC) انجام می‌شود تا خبرهای فارسی، عربی و انگلیسی یک رویداد به هم وصل شوند. هم‌آیی قطعی است؛ مدل زبانی برای داستان‌های برتر موجودیت‌های خارج از فهرست مرجع (افراد، سازمان‌ها، رویدادها) و روابط نوع‌دار صریح (تحریم، حمله، مذاکره، …) را با نقل‌قول شاهد استخراج می‌کند."}

    def _llm_pass(self, ctx):
        from ..text import normalize
        stories = [s for s in db.q("SELECT id,title,ai,article_count FROM stories WHERE last_update>? ORDER BY score DESC LIMIT 30", (time.time() - 24 * 3600,))
                   if (db.jload(s["ai"], {}) or {}).get("ner_n") != s["article_count"]][:8]
        if not stories:
            return 0, 0
        try:
            items, used = ai.ner_batch(stories)
            ctx.tokens += used
        except Exception as e:
            ctx.log(f"LLM NER: {e}", "warn")
            return 0, 0
        n_e, n_r = 0, 0
        for it in items:
            try:
                st = stories[int(it.get("i"))]
            except (TypeError, ValueError, IndexError):
                continue
            arts = db.q("SELECT id,title,lead,published_at FROM articles WHERE story_id=? AND duplicate_of IS NULL", (st["id"],))
            name2id = {}
            with db.tx() as c:
                for e in (it.get("entities") or [])[:10]:
                    if not (e.get("name_fa") or e.get("name_en")) or e.get("type") not in ai.ETYPES:
                        continue
                    eid, known = ai.resolve_entity(e)
                    if not known:
                        lat = e.get("lat") if e.get("type") in ("GPE", "LOC") and isinstance(e.get("lat"), (int, float)) else None
                        lon = e.get("lon") if lat is not None and isinstance(e.get("lon"), (int, float)) else None
                        c.execute("""INSERT OR IGNORE INTO entities(id,type,name_fa,name_en,name_ar,lat,lon,iso) VALUES(?,?,?,?,?,?,?,NULL)""",
                                  (eid, e["type"], e.get("name_fa") or e.get("name_en"), e.get("name_en") or e.get("name_fa"), e.get("name_ar"), lat, lon))
                        n_e += 1
                    for k in (e.get("name_en"), e.get("name_fa")):
                        if k:
                            name2id[normalize(k)] = eid
                    forms = [normalize(x) for x in (e.get("name_fa"), e.get("name_en"), e.get("name_ar")) if x]
                    hit = [a for a in arts if any(f and f in normalize(a["title"] + " " + (a["lead"] or "")) for f in forms)] or arts[:1]
                    for a in hit:
                        cur = c.execute("INSERT OR IGNORE INTO mentions(article_id,entity_id,surface) VALUES(?,?,?)", (a["id"], eid, e.get("name_fa") or e.get("name_en")))
                        if cur.rowcount:
                            c.execute("UPDATE entities SET mention_count=mention_count+1 WHERE id=?", (eid,))
                for r in (it.get("relations") or [])[:12]:
                    sid_, oid = name2id.get(normalize(r.get("s") or "")), name2id.get(normalize(r.get("o") or ""))
                    if not sid_ or not oid or sid_ == oid or r.get("p") not in ai.PREDICATES:
                        continue
                    t = max(a["published_at"] for a in arts) if arts else time.time()
                    c.execute("""INSERT INTO relations(subject_id,predicate,object_id,weight,first_seen,last_seen,evidence) VALUES(?,?,?,1,?,?,?)
                              ON CONFLICT(subject_id,predicate,object_id) DO UPDATE SET weight=weight+1,last_seen=excluded.last_seen,evidence=excluded.evidence""",
                              (sid_, r["p"], oid, t, t, db.jdump([{"story_id": st["id"], "quote": (r.get("quote") or "")[:200], "by": "llm"}] + [a["id"] for a in arts[:3]])))
                    n_r += 1
            db.merge_json("stories", "id", st["id"], "ai", {"ner_n": st["article_count"]})
        return n_e, n_r


def _cos(a: Counter, b: Counter):
    if not a or not b:
        return 0.0
    dot = sum(v * b.get(k, 0) for k, v in a.items())
    na, nb = math.sqrt(sum(v * v for v in a.values())), math.sqrt(sum(v * v for v in b.values()))
    return dot / (na * nb) if na and nb else 0.0


class DedupCluster(Agent):
    name, title_fa = "dedup", "حذف تکرار و خوشه‌بندی"
    role_fa = "تشخیص نسخه تکراری با MinHash/LSH و ادغام خبرهای یک رویداد در «داستان»"

    def run(self, ctx):
        horizon = time.time() - 72 * 3600
        lsh = MinHashLSH(threshold=0.8, num_perm=128)
        for r in db.q("SELECT article_id,sig FROM minhash WHERE created>?", (horizon,)):
            try:
                lsh.insert(r["article_id"], pickle.loads(r["sig"]))
            except ValueError:
                pass
        rows = db.q("SELECT * FROM articles WHERE stage='enriched' ORDER BY published_at ASC")
        ments = {}
        for r in db.q("SELECT article_id,entity_id FROM mentions WHERE article_id IN (SELECT id FROM articles WHERE stage='enriched' OR published_at>?)", (time.time() - 48 * 3600,)):
            ments.setdefault(r["article_id"], set()).add(r["entity_id"])
        # candidate stories: active in last 48h
        stories = {}
        for s in db.q("SELECT id,centroid,entities,topics,last_update,category FROM stories WHERE last_update>?", (time.time() - 48 * 3600,)):
            cen = db.jload(s["centroid"], {}) or {}
            stories[s["id"]] = {"tok": Counter(cen.get("tok", {})), "ent": set(db.jload(s["entities"], [])),
                                "cat": s["category"], "t": s["last_update"], "langs": set(cen.get("langs", []))}
        # entity document-frequency over 48h: generic actors (e.g. US, Iran) must not glue unrelated stories together
        df = Counter()
        for es in ments.values():
            df.update(es)
        generic = {e for e, _ in df.most_common(10)}
        dups, created, joined, touched = 0, 0, 0, set()
        with db.tx() as c:
            for i, a in enumerate(rows):
                m = MinHash(num_perm=128)
                for sh in shingles(f"{a['title']} {a['lead'] or ''}"):
                    m.update(sh.encode("utf8"))
                hits = [h for h in lsh.query(m) if h != a["id"]]
                dup_of = None
                if hits:
                    dup_of = hits[0]
                try:
                    lsh.insert(a["id"], m)
                except ValueError:
                    pass
                c.execute("INSERT OR REPLACE INTO minhash(article_id,sig,created) VALUES(?,?,?)", (a["id"], pickle.dumps(m), time.time()))
                tok = Counter(tokens(f"{a['title']} {a['title']} {a['lead'] or ''}"))
                ent = ments.get(a["id"], set())
                story_id = None
                if dup_of:
                    r = c.execute("SELECT story_id FROM articles WHERE id=?", (dup_of,)).fetchone()
                    story_id = r["story_id"] if r else None
                    dups += 1
                if not story_id:
                    best, best_s = None, 0.0
                    for sid, st in stories.items():
                        if abs(a["published_at"] - st["t"]) > 36 * 3600:
                            continue
                        shared_set = ent & st["ent"]
                        shared = len(shared_set)
                        specific = len(shared_set - generic)
                        jac = shared / len(ent | st["ent"]) if ent and st["ent"] else 0.0
                        cos = _cos(tok, st["tok"])
                        same_lang = a["lang"] in st["langs"]
                        if same_lang:
                            s_ = 0.7 * cos + 0.3 * jac
                            ok = cos >= 0.38 or (cos >= 0.22 and shared >= 2 and specific >= 1)
                        else:  # cross-lingual: rely on language-independent entity IDs + topic + time
                            s_ = 0.5 * jac + 0.2 * cos + (0.1 if st["cat"] == a["category"] else 0)
                            ok = (shared >= 2 and specific >= 1 and jac >= 0.5 and st["cat"] == a["category"]
                                  and abs(a["published_at"] - st["t"]) < 18 * 3600) or (specific >= 2 and jac >= 0.6)
                        if ok and s_ > best_s:
                            best, best_s = sid, s_
                    if best:
                        story_id = best
                        joined += 1
                    else:
                        story_id = "s_" + a["id"]
                        stories[story_id] = {"tok": Counter(), "ent": set(), "cat": a["category"], "t": a["published_at"], "langs": set()}
                        created += 1
                st = stories.setdefault(story_id, {"tok": Counter(), "ent": set(), "cat": a["category"], "t": a["published_at"], "langs": set()})
                st["tok"].update(tok)
                st["tok"] = Counter(dict(st["tok"].most_common(80)))
                st["ent"] |= ent
                st["langs"].add(a["lang"])
                st["t"] = max(st["t"], a["published_at"])
                touched.add(story_id)
                c.execute("UPDATE articles SET duplicate_of=?,story_id=?,stage='clustered' WHERE id=?", (dup_of, story_id, a["id"]))
                if i % 40 == 0:
                    ctx.checkpoint()
                    ctx.progress(0.85 * (i + 1) / max(1, len(rows)))
            for sid in touched:
                self._refresh_story(c, sid, stories[sid])
        merged = self._llm_merge(ctx, touched, generic) if llm.agent_enabled("dedup") else 0
        ctx.state["touched_stories"] = sorted(touched)
        ctx.progress(1)
        return {"summary": f"{dups} تکراری حذف شد؛ {created} داستان جدید؛ {joined} خبر به داستان‌های موجود پیوست" + (f"؛ {merged} ادغام بین‌زبانی با داوری مدل زبانی" if merged else ""),
                "input_summary": f"{len(rows)} خبر غنی‌شده", "output": {"duplicates": dups, "new_stories": created, "joined": joined, "touched": len(touched), "llm_merged": merged},
                "reasoning": "موجودیت‌های پرتکرار (۱۰ مورد برتر ۴۸ ساعت، مثل آمریکا/ایران) به‌تنهایی برای ادغام کافی نیستند. تکراری: Jaccard شینگل‌های ۵ حرفی ≥ ۰.۸ (MinHash/LSH، ۱۲۸ جایگشت). هم‌زبان: شباهت کسینوسی واژگانی + موجودیت مشترک. بین‌زبانی: حداقل ۲ موجودیت مشترک با Jaccard ≥ ۰.۵، موضوع یکسان و فاصله زمانی کمتر از ۱۸ ساعت. جفت‌های مرزی (زبان متفاوت، موجودیت خاص مشترک) به داوری مدل زبانی سپرده می‌شوند و فقط با اطمینان ≥ ۰.۸ ادغام می‌شوند."}

    def _llm_merge(self, ctx, touched, generic):
        cand = db.q("SELECT id,title,summary,entities,centroid,score,first_seen,last_update FROM stories WHERE last_update>? ORDER BY score DESC LIMIT 120",
                    (time.time() - 24 * 3600,))
        judged = set(db.kv_get("dedup_judged", []) or [])
        pairs = []
        for i, a in enumerate(cand):
            ea, la = set(db.jload(a["entities"], [])) - generic, set((db.jload(a["centroid"], {}) or {}).get("langs", []))
            if not ea:
                continue
            for b in cand[i + 1:]:
                key = "|".join(sorted((a["id"], b["id"])))
                if key in judged or abs(a["last_update"] - b["last_update"]) > 24 * 3600:
                    continue
                eb, lb = set(db.jload(b["entities"], [])) - generic, set((db.jload(b["centroid"], {}) or {}).get("langs", []))
                if len(ea & eb) >= 1 and not (la & lb) and len(ea & eb) / max(1, len(ea | eb)) >= 0.25:
                    pairs.append((a, b, key))
            if len(pairs) >= 12:
                break
        if not pairs:
            return 0
        try:
            items, used = ai.same_event([(a, b) for a, b, _ in pairs])
            ctx.tokens += used
        except Exception as e:
            ctx.log(f"LLM dedup: {e}", "warn")
            return 0
        merged, gone = 0, set()
        for it in items:
            try:
                a, b, key = pairs[int(it.get("i"))]
            except (TypeError, ValueError, IndexError):
                continue
            judged.add(key)
            if not it.get("same") or float(it.get("confidence") or 0) < 0.8 or a["id"] in gone or b["id"] in gone:
                continue
            keep, drop = (a, b) if a["score"] >= b["score"] else (b, a)
            with db.tx() as c:
                c.execute("UPDATE articles SET story_id=? WHERE story_id=?", (keep["id"], drop["id"]))
                c.execute("UPDATE storyline_events SET story_id=? WHERE story_id=?", (keep["id"], drop["id"]))
                c.execute("DELETE FROM claims WHERE story_id IN (?,?)", (keep["id"], drop["id"]))
                c.execute("DELETE FROM stories WHERE id=?", (drop["id"],))
                ck, cd = db.jload(keep["centroid"], {}) or {}, db.jload(drop["centroid"], {}) or {}
                tok = Counter(ck.get("tok", {})); tok.update(cd.get("tok", {}))
                st = {"tok": Counter(dict(tok.most_common(80))), "ent": set(db.jload(keep["entities"], [])) | set(db.jload(drop["entities"], [])),
                      "langs": set(ck.get("langs", [])) | set(cd.get("langs", []))}
                self._refresh_story(c, keep["id"], st)
            db.merge_json("stories", "id", keep["id"], "ai", {"merged_from": drop["id"], "merge_why": (it.get("why") or "")[:200]})
            touched.discard(drop["id"]); touched.add(keep["id"]); gone.add(drop["id"])
            merged += 1
        db.kv_set("dedup_judged", sorted(judged)[-3000:])
        return merged

    @staticmethod
    def _refresh_story(c, sid, st):
        arts = [dict(r) for r in c.execute("""SELECT a.*, s.credibility, s.ownership_group FROM articles a JOIN sources s ON s.id=a.source_id
                                             WHERE a.story_id=? ORDER BY a.published_at""", (sid,)).fetchall()]
        if not arts:
            return
        uniq = [a for a in arts if not a["duplicate_of"]] or arts
        fa = [a for a in uniq if a["lang"] == "fa"]
        lead_art = max(uniq, key=lambda a: (a["credibility"] or 0.5) + (0.3 if a["lang"] == "fa" else 0) + min(0.2, (a["extraction_quality"] or 0) / 5))
        srcs = {a["source_id"] for a in arts}
        langs = {a["lang"] for a in arts}
        cats = Counter(a["category"] for a in uniq)
        urg_rank = {"flash": 3, "high": 2, "normal": 1, "low": 0}
        urg = max((a["urgency"] or "normal" for a in uniq), key=lambda u: urg_rank.get(u, 1))
        regions = Counter(r for a in uniq for r in (db.jload(a["regions"], []) or []))
        last = max(a["published_at"] for a in arts)
        first = min(a["published_at"] for a in arts)
        sent = sum((a["sentiment"] or 0) for a in uniq) / len(uniq)
        age_h = max(0.0, (time.time() - last) / 3600)
        score = (2.2 * math.log1p(len(srcs)) + 0.8 * len(langs) + {"flash": 2.5, "high": 1.2}.get(urg, 0)
                 + 0.3 * math.log1p(len(uniq))) * math.exp(-age_h / 18)
        topics = Counter()
        for a in uniq:
            for t in db.jload(a["topics"], []) or []:
                topics[t["label"]] += t["p"]
        existing = c.execute("SELECT title_fa FROM stories WHERE id=?", (sid,)).fetchone()
        title_fa = fa[0]["title"] if fa else (existing["title_fa"] if existing and existing["title_fa"] else None)
        c.execute("""INSERT INTO stories(id,title,title_fa,summary,first_seen,last_update,article_count,source_count,lang_count,topics,regions,
                  entities,urgency,category,score,sentiment,centroid) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                  ON CONFLICT(id) DO UPDATE SET title=excluded.title,title_fa=COALESCE(excluded.title_fa,stories.title_fa),summary=excluded.summary,
                  last_update=excluded.last_update,article_count=excluded.article_count,source_count=excluded.source_count,lang_count=excluded.lang_count,
                  topics=excluded.topics,regions=excluded.regions,entities=excluded.entities,urgency=excluded.urgency,category=excluded.category,
                  score=excluded.score,sentiment=excluded.sentiment,centroid=excluded.centroid""",
                  (sid, lead_art["title"], title_fa, (lead_art["lead"] or "")[:600], first, last, len(arts), len(srcs), len(langs),
                   db.jdump([k for k, _ in topics.most_common(3)]), db.jdump([k for k, _ in regions.most_common(6)]),
                   db.jdump(sorted(st["ent"])), urg, cats.most_common(1)[0][0], round(score, 3), round(sent, 2),
                   db.jdump({"tok": dict(st["tok"]), "langs": sorted(st["langs"])})))


class Translator(Agent):
    name, title_fa = "translator", "مترجم"
    role_fa = "ترجمه عنوان‌ها، تیتر بی‌طرف و خلاصه فارسی داستان‌ها با واژه‌نامه حوزه"
    GLOSSARY = {"Strait of Hormuz": "تنگه هرمز", "Houthis": "حوثی‌ها", "sanctions": "تحریم‌ها", "OPEC+": "اوپک‌پلاس",
                "tanker": "نفتکش", "freight rates": "نرخ کرایه حمل", "Red Sea": "دریای سرخ", "IAEA": "آژانس بین‌المللی انرژی اتمی",
                "Bab el-Mandeb": "باب‌المندب", "Brent": "برنت", "ceasefire": "آتش‌بس", "drone": "پهپاد", "UN Security Council": "شورای امنیت سازمان ملل"}

    def run(self, ctx):
        since = time.time() - 36 * 3600
        stories = [s for s in db.q("SELECT id,title,title_fa,ai,article_count,lang_count FROM stories WHERE last_update>? ORDER BY score DESC LIMIT 60", (since,))
                   if (db.jload(s["ai"], {}) or {}).get("tr_n") != s["article_count"]][:36]
        titles = db.q("""SELECT a.id,a.title,a.lang FROM articles a JOIN stories s ON s.id=a.story_id WHERE a.lang!='fa' AND a.title_fa IS NULL
                         AND a.duplicate_of IS NULL AND a.published_at>? ORDER BY s.score DESC LIMIT 90""", (since,))
        if not llm.agent_enabled("translator"):
            return {"status": "skipped", "summary": f"مدل زبانی غیرفعال است؛ {len(stories)} داستان و {len(titles)} عنوان در انتظار ترجمه",
                    "input_summary": f"{len(stories)} داستان", "output": {"pending": len(stories)},
                    "reasoning": "در تنظیمات هوش مصنوعی، مدل یا عامل مترجم غیرفعال است یا سقف توکن روزانه تمام شده است."}
        gl = "\n".join(f"{k} => {v}" for k, v in self.GLOSSARY.items())
        done_s, done_t, steps = 0, 0, max(1, (len(stories) + 11) // 12 + (len(titles) + 29) // 30)
        k = 0
        sb = [stories[b:b + 12] for b in range(0, len(stories), 12)]
        for batch, res in ai.parallel(lambda bt: ai.translate_stories(bt, gl), sb):
            ctx.checkpoint()
            if isinstance(res, Exception):
                ctx.log(f"ترجمه داستان ناموفق: {res}", "warn"); continue
            items, used = res
            ctx.tokens += used
            for it in items:
                try:
                    s = batch[int(it.get("i"))]
                except (TypeError, ValueError, IndexError):
                    continue
                patch = {"tr_n": s["article_count"], "summary_fa": (it.get("summary_fa") or "").strip(), "headline_fa": (it.get("headline_fa") or "").strip()}
                db.merge_json("stories", "id", s["id"], "ai", patch)
                if not s["title_fa"] and it.get("title_fa"):
                    with db.tx() as c:
                        c.execute("UPDATE stories SET title_fa=? WHERE id=?", (it["title_fa"].strip(), s["id"]))
                done_s += 1
            k += 1; ctx.progress(k / steps, f"{done_s} داستان")
        tb = [titles[b:b + 30] for b in range(0, len(titles), 30)]
        for batch, res in ai.parallel(lambda bt: ai.translate_titles(bt, gl), tb):
            ctx.checkpoint()
            if isinstance(res, Exception):
                ctx.log(f"ترجمه عنوان ناموفق: {res}", "warn"); continue
            items, used = res
            ctx.tokens += used
            with db.tx() as c:
                for it in items:
                    try:
                        a = batch[int(it.get("i"))]
                    except (TypeError, ValueError, IndexError):
                        continue
                    if it.get("fa"):
                        c.execute("UPDATE articles SET title_fa=?,translated_by=? WHERE id=?", (it["fa"].strip(), "llm:" + llm.cfg()["model"], a["id"]))
                        c.execute("UPDATE articles_fts SET title_fa=? WHERE id=?", (it["fa"].strip(), a["id"]))
                        done_t += 1
            k += 1; ctx.progress(k / steps, f"{done_t} عنوان")
        return {"summary": f"{done_s} داستان (عنوان، تیتر بی‌طرف، خلاصه) و {done_t} عنوان خبر به فارسی ترجمه شد",
                "input_summary": f"{len(stories)} داستان، {len(titles)} عنوان غیرفارسی", "output": {"stories": done_s, "titles": done_t},
                "reasoning": "ترجمه دسته‌ای و موازی (۱۲ داستان یا ۳۰ عنوان در هر فراخوانی، ۳ فراخوانی هم‌زمان) برای کنترل هزینه و زمان؛ داستان فقط وقتی دوباره پردازش می‌شود که خبر تازه گرفته باشد. واژه‌نامه حوزه در پرامپت تزریق و قیدهای تردید حفظ می‌شود."}
