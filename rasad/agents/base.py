import time


class Paused(Exception):
    pass


class Ctx:
    """Execution context passed to agents (thread side). Supervisor injects callbacks."""

    def __init__(self, run_id, step_id, progress_cb, checkpoint_cb, log_cb, state):
        self.run_id, self.step_id = run_id, step_id
        self._progress, self._checkpoint, self._log = progress_cb, checkpoint_cb, log_cb
        self.state = state  # shared dict across steps of a run (e.g. new article ids)
        self.tokens = 0

    def progress(self, p, note=""):
        self._progress(max(0.0, min(1.0, p)), note)

    def checkpoint(self):
        """Blocks while paused; raises if killed. Call inside long loops."""
        self._checkpoint()

    def log(self, msg, level="info"):
        self._log(msg, level)


class Agent:
    name = "agent"
    title_fa = ""
    role_fa = ""
    gate = None  # approval gate key used in supervised mode (post-step)

    def run(self, ctx: Ctx) -> dict:
        """Return {summary, output(json-able), reasoning, input_summary}."""
        raise NotImplementedError

    @staticmethod
    def now():
        return time.time()
