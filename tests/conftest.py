import os, sys, tempfile
_tmp = tempfile.mkdtemp()
os.environ.setdefault("RASAD_DB", os.path.join(_tmp, "test.db"))
os.environ.setdefault("RASAD_MODE", "manual")  # no scheduled network runs during tests
os.environ.setdefault("RASAD_AUTH", "0")  # RBAC is exercised explicitly in test_ops.py
os.environ.setdefault("LLM_BASE_URL", "")
os.environ.setdefault("LLM_API_KEY", "")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
