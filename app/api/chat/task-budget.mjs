export const TOOL_LIMIT = 16;
export const TASK_TIMEOUT_MS = 60000;
export const TOOL_TIMEOUT_MS = 10000;

/** @param {{signal?: AbortSignal, timeoutMs?: number, now?: () => number}} [options] */
export function createTaskBudget({ signal, timeoutMs = TASK_TIMEOUT_MS, now = () => performance.now() } = {}) {
  const started = now();
  const controller = new AbortController();
  const state = { calls: 0, steps: 0, reason: "", failure: "", signal: AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]) };
  const timer = setTimeout(() => {
    state.reason = "timeout";
    controller.abort(new DOMException("Task timeout", "TimeoutError"));
  }, timeoutMs);
  timer.unref?.();
  return Object.assign(state, {
    elapsedMs: () => Math.max(0, Math.round(now() - started)),
    dispose: () => clearTimeout(timer),
    admit() {
      if (state.signal.aborted || state.reason === "error" || state.calls >= TOOL_LIMIT) return false;
      state.calls++;
      if (state.calls === TOOL_LIMIT) state.reason = "tools";
      return true;
    },
    fail(message) {
      if (state.reason !== "timeout") state.reason = "error";
      state.failure ||= message;
    },
  });
}

// Race as well as abort: a stalled body or non-cooperating source cannot hold the task open.
export async function withinSignal(operation, signal) {
  signal.throwIfAborted();
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try { return await Promise.race([Promise.resolve().then(operation), aborted]); }
  finally { signal.removeEventListener("abort", onAbort); }
}
