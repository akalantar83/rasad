"""CLI:  python -m rasad serve [--host 0.0.0.0 --port 8080]   |   python -m rasad run-once"""
import argparse
import asyncio
import time


def main():
    ap = argparse.ArgumentParser(prog="rasad")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve"); s.add_argument("--host", default="0.0.0.0"); s.add_argument("--port", type=int, default=8080)
    sub.add_parser("run-once")
    a = ap.parse_args()
    if a.cmd == "serve":
        import uvicorn
        uvicorn.run("rasad.api:app", host=a.host, port=a.port, log_level="info")
    else:
        from . import db
        from .agents import PIPELINE
        from .agents.base import Ctx
        db.init()
        state = {}
        for A in PIPELINE:
            t = time.time()
            ctx = Ctx("cli", A.name, lambda p, n: None, lambda: None, lambda m, l: print("   ", l, m), state)
            r = A().run(ctx)
            print(f"[{A.name:10s}] {time.time()-t:6.1f}s  {r.get('status','ok'):8s} {r['summary']}")


if __name__ == "__main__":
    main()
