const DEFAULT_DEADLINE_MS = 10_000;
const POLL_INTERVAL_MS = 50;

const elements = {
  binding: document.querySelector('[data-testid="stage0-binding"]'),
  ready: document.querySelector('[data-testid="stage0-ready"]'),
  event: document.querySelector('[data-testid="stage0-event"]'),
  result: document.querySelector('[data-testid="stage0-result"]'),
  error: document.querySelector('[data-testid="stage0-error"]'),
};

let lastLifecycleKey = null;
let healthRequestInFlight = false;
let monitorTimer = null;

function text(element, value) {
  if (element) element.textContent = value;
}

function codeOf(error, fallback = "host_unavailable") {
  return typeof error?.code === "string" ? error.code : fallback;
}

function setError(error) {
  const code = typeof error === "string" ? error : codeOf(error);
  text(elements.error, code);
  elements.error?.closest(".card")?.setAttribute("data-state", "error");
}

function renderBinding(state) {
  const generation = Number.isSafeInteger(state?.generationId)
    ? `generation ${state.generationId}`
    : "no generation";
  text(elements.binding, `${state?.state ?? "unknown"} / ${generation}`);
}

function renderLifecycle(frame) {
  const state = frame?.payload?.state ?? "unknown";
  const generation = frame?.generationId ?? "?";
  const sequence = frame?.sequence ?? "?";
  const key = `${generation}:${sequence}`;
  if (key === lastLifecycleKey) return false;
  lastLifecycleKey = key;
  text(
    elements.event,
    `${state} / generation ${generation} / sequence ${sequence}`,
  );
  if (state === "ready" || state === "rebound") {
    text(elements.ready, "READY");
    elements.ready?.closest(".card")?.setAttribute("data-state", "ok");
  }
  return true;
}

async function readBinding() {
  const state = await window.stage0.bindingState();
  renderBinding(state);
  if (state?.state === "unavailable" || state?.state === "failed") {
    setError("host_unavailable");
  }
  return state;
}

async function waitForBoundBinding() {
  const deadline = Date.now() + DEFAULT_DEADLINE_MS;
  while (Date.now() < deadline) {
    const state = await readBinding();
    if (state?.state === "bound") return state;
    if (state?.state === "unavailable" || state?.state === "closed") {
      throw new Error("host_unavailable");
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error("startup_timeout");
}

async function requestHealthSafe() {
  if (healthRequestInFlight) return;
  healthRequestInFlight = true;
  try {
    const response = await window.stage0.health.getDefaultRelayUrl();
    text(
      elements.result,
      `${response.relayUrl} / generation ${response.generationId}`,
    );
    elements.result?.closest(".card")?.setAttribute("data-state", "ok");
  } catch (error) {
    setError(error);
  } finally {
    healthRequestInFlight = false;
  }
}

async function bindLifecycle() {
  await window.stage0.onLifecycle((frame) => {
    const changed = renderLifecycle(frame);
    if (changed) {
      void readBinding().then((state) => {
        if (state?.state === "bound") void requestHealthSafe();
      });
    }
  });
}

function startBindingMonitor() {
  monitorTimer = window.setInterval(() => {
    void readBinding().catch((error) => setError(error));
  }, POLL_INTERVAL_MS * 4);
}

async function boot() {
  if (window.top !== window.self) return;
  if (!window.stage0) {
    setError("untrusted_origin");
    return;
  }
  try {
    await bindLifecycle();
    await waitForBoundBinding();
    await readBinding();
  } catch (error) {
    setError(error);
  }
  startBindingMonitor();
}

window.addEventListener("beforeunload", () => {
  if (monitorTimer !== null) window.clearInterval(monitorTimer);
});

void boot();
