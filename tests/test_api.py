from fastapi.testclient import TestClient
from rasad.api import app


def test_read_endpoints_and_controls():
    with TestClient(app) as c:
        assert c.get("/healthz").json()["ok"]
        for p in ["/api/meta", "/api/stats", "/api/stories", "/api/graph", "/api/geo", "/api/trends",
                  "/api/sources", "/api/signals", "/api/briefs", "/api/qa", "/api/runs", "/api/audit", "/api/state"]:
            assert c.get(p).status_code == 200, p
        st = c.get("/api/state").json()
        assert st["mode"] == "manual" and len(st["pipeline"]) == 13
        # kill switch blocks starts until re-armed with explicit confirmation
        assert c.post("/api/control", json={"action": "kill"}).json()["ok"]
        assert c.post("/api/control", json={"action": "start"}).json()["ok"] is False
        assert c.post("/api/control", json={"action": "arm", "confirm": "nope"}).json()["ok"] is False
        assert c.post("/api/control", json={"action": "arm", "confirm": "ARM"}).json()["ok"]
        assert c.post("/api/steps/x:writer/decision", json={"decision": "approve"}).json()["ok"] is False
        assert c.get("/").status_code == 200
        actions = [a["action"] for a in c.get("/api/audit").json()]
        assert "control:kill" in actions and "control:arm" in actions
