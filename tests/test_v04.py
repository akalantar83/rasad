import time

from fastapi.testclient import TestClient

from rasad import auth, db, notify, triage
from rasad.api import app
from rasad.config import settings


def _signal(label="جهش آزمایشی", sev="critical"):
    with db.tx() as c:
        return c.execute("""INSERT INTO signals(type,key,label,score,baseline,observed,window,severity,story_ids,explanation,status,created)
                            VALUES('spike',?,?,5,1,5,'1h',?,'[]','{}','new',?)""", (f"k{time.time()}", label, sev, time.time())).lastrowid


def test_alert_triage_lifecycle():
    with TestClient(app) as c:
        gid = _signal()
        r = c.get("/api/alerts?status=open").json()
        assert any(x["id"] == gid for x in r["items"]) and r["open"] >= 1
        assert c.post(f"/api/alerts/{gid}", json={"status": "bogus"}).status_code == 400
        assert c.post(f"/api/alerts/{gid}", json={}).status_code == 400
        d = c.post(f"/api/alerts/{gid}", json={"status": "investigating", "note": "در حال بررسی منابع"}).json()
        assert d["status"] == "investigating" and d["note"] and d["events"][0]["action"] == "status"
        assert c.post("/api/alerts/bulk", json={"ids": [gid], "status": "resolved"}).json()["updated"] == 1
        d = c.get(f"/api/alerts/{gid}").json()
        assert d["status"] == "resolved" and not d["open"] and len(d["events"]) == 2
        assert c.get("/api/alerts/999999").status_code == 404


def test_api_tokens_and_rbac(monkeypatch):
    monkeypatch.setattr(settings, "auth_enabled", True)
    with TestClient(app) as c:
        with db.tx() as x:
            x.execute("DELETE FROM users"); x.execute("DELETE FROM sessions"); x.execute("DELETE FROM api_tokens")
        auth.create_user("viewer9", "viewer-pass-9", "viewer")
        assert c.post("/api/auth/login", json={"username": "viewer9", "password": "viewer-pass-9"}).status_code == 200
        t = c.post("/api/me/tokens", json={"name": "ci", "days": 30}).json()
        assert t["token"].startswith("rsd_")
        lst = c.get("/api/me/tokens").json()
        assert lst[0]["name"] == "ci" and "token_hash" not in lst[0]
        gid = _signal()
        assert c.post(f"/api/alerts/{gid}", json={"status": "ack"}).status_code == 403  # viewer can't triage
        c.cookies.clear()
        h = {"Authorization": "Bearer " + t["token"]}
        assert c.get("/api/stories", headers=h).status_code == 200
        assert c.get("/api/stories", headers={"Authorization": "Bearer rsd_wrong"}).status_code == 401
        assert c.delete(f"/api/me/tokens/{t['id']}", headers=h).status_code == 200
        assert c.get("/api/stories", headers=h).status_code == 401
        assert c.get("/api/people").status_code == 401


def test_explore_search_and_csv():
    with TestClient(app) as c:
        r = c.get("/api/explore?hours=100000&size=5").json()
        assert {"total", "items", "facets", "histogram", "pages"} <= r.keys()
        assert len(r["items"]) <= 5 and set(r["facets"]) == {"lang", "category", "source"}
        with db.tx() as x:
            x.execute("INSERT OR IGNORE INTO sources(id,name,url,lang,status) VALUES('xsrc','X Source','http://x/rss','en','active')")
            x.execute("""INSERT OR IGNORE INTO articles(id,source_id,url,title,lead,lang,published_at,fetched_at,category)
                         VALUES('xart1','xsrc','http://x/1','Zebracorn tanker seized near strait','lead','en',?,?,'security')""", (time.time(), time.time()))
            x.execute("INSERT INTO articles_fts(id,title,lead,text,title_fa) VALUES('xart1','Zebracorn tanker seized near strait','lead','', '')")
        q = c.get("/api/explore", params={"q": "zebracorn", "hours": 24, "lang": "en"}).json()
        assert q["total"] == 1 and "snip" in q["items"][0] and q["facets"]["source"][0]["label"] == "X Source"
        assert c.get("/api/explore", params={"q": "zebracorn", "lang": "fa"}).json()["total"] == 0
        assert c.get("/api/explore.csv?hours=100000").text.startswith("\ufeffpublished_utc")


def test_digest_config_and_send():
    with TestClient(app) as c:
        assert c.post("/api/notify/digest", json={"hour": 30}).status_code == 400
        cfg = c.post("/api/notify/digest", json={"enabled": True, "hour": 0, "top": 5}).json()
        assert cfg["enabled"] and cfg["top"] == 5
        g = c.get("/api/notify/digest").json()
        assert "خبر یکتا" in g["preview"]
        r = c.post("/api/notify/digest/send").json()
        assert "sent" in r and r["title"].startswith("خلاصه روزانه")
        notify.set_digest_cfg({"enabled": False})
