"use strict";

const MINUTE = 60_000;
const TICK_MS = 30_000;
const DEFAULT_WAKE_SETTLE_MS = 4_000;
const DEFAULT_STARTUP_DELAY_MS = 1_500;
const MAX_BACKOFF_MIN = 10;

// Unified scheduler and status owner for all active & passive quota sources.
// Coordinates startup refresh, steady periodic polling, sleep/wake recovery,
// exponential failure backoff (capped), concurrency deduplication, and manual
// "Refresh All Quotas" requests without faking unsupported refreshes.
function createQuotaRefreshManager({
  sources = {},
  systemIdleState = () => "active",
  powerMonitor = null,
  now = Date.now,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  startupDelayMs = DEFAULT_STARTUP_DELAY_MS,
  wakeSettleMs = DEFAULT_WAKE_SETTLE_MS,
  onStatusChange = () => {},
} = {}) {
  let tickTimer = null;
  let wakeTimer = null;
  let startupTimer = null;
  let started = false;
  const powerListeners = [];

  // Per-source runtime state
  const entries = new Map();
  for (const [id, cfg] of Object.entries(sources)) {
    if (!cfg || typeof cfg !== "object") continue;
    entries.set(id, {
      id,
      kind: cfg.kind || "active", // "active" | "passive"
      intervalMs: Math.max(MINUTE, Number(cfg.intervalMs) || 5 * MINUTE),
      refreshFn: typeof cfg.refresh === "function" ? cfg.refresh : null,
      inFlight: null,
      state: cfg.kind === "passive" ? "passive" : "idle", // idle | refreshing | ok | error | auth-required | passive
      lastAttemptAt: 0,
      lastSuccessAt: 0,
      lastStatus: cfg.kind === "passive" ? "extension-managed" : "waiting",
      lastError: "",
      failureCount: 0,
      nextAttemptAt: 0,
    });
  }

  function notify() {
    try { onStatusChange(getStatusSnapshot()); } catch {}
  }

  function computeBackoffMs(status, failureCount, intervalMs) {
    if (status === "ok" || status === "unchanged") return intervalMs;
    if (status === "auth-required") return Math.min(MAX_BACKOFF_MIN, 10) * MINUTE;
    if (status === "network-error" || status === "timeout") {
      // Quick retry after transient network/timeout hiccup: 1m, 2m, 4m, 8m, max 10m.
      const mins = Math.min(MAX_BACKOFF_MIN, Math.pow(2, Math.max(0, Math.min(failureCount - 1, 3))));
      return mins * MINUTE;
    }
    const mins = Math.min(MAX_BACKOFF_MIN, Math.pow(2, Math.min(failureCount, 4)));
    return mins * MINUTE;
  }

  async function refreshSource(id, { force = false, reason = "auto" } = {}) {
    const entry = entries.get(id);
    if (!entry) return { id, status: "unknown-source" };

    if (entry.kind === "passive" || !entry.refreshFn) {
      return {
        id,
        status: entry.lastStatus || "extension-managed",
        passive: true,
      };
    }

    if (entry.inFlight) {
      return entry.inFlight;
    }

    const current = now();
    if (!force && current < entry.nextAttemptAt) {
      return { id, status: entry.lastStatus, skipped: true };
    }

    if (!force) {
      const idle = systemIdleState();
      if (idle !== "active" && idle !== "idle") {
        return { id, status: "deferred-locked", skipped: true };
      }
    }

    entry.state = "refreshing";
    entry.lastAttemptAt = current;
    notify();

    const run = (async () => {
      let result;
      try {
        result = await entry.refreshFn({ force, reason });
      } catch (err) {
        result = { status: "error", error: err?.message || "Refresh failed" };
      }
      const status = typeof result?.status === "string" ? result.status : "error";
      const ok = status === "ok" || status === "unchanged";
      const finishTime = now();

      entry.lastStatus = status;
      if (ok) {
        entry.state = "ok";
        entry.lastSuccessAt = Number(result?.capturedAt) || finishTime;
        entry.lastError = "";
        entry.failureCount = 0;
      } else {
        entry.failureCount += 1;
        entry.state = status === "auth-required" ? "auth-required" : "error";
        entry.lastError = typeof result?.error === "string" ? result.error : "";
      }

      entry.nextAttemptAt = finishTime + computeBackoffMs(status, entry.failureCount, entry.intervalMs);
      notify();
      return { id, status, error: entry.lastError, capturedAt: entry.lastSuccessAt };
    })().finally(() => {
      entry.inFlight = null;
    });

    entry.inFlight = run;
    return run;
  }

  async function pollDue({ force = false, reason = "scheduled" } = {}) {
    const tasks = [];
    for (const entry of entries.values()) {
      if (entry.kind !== "active") continue;
      if (force || now() >= entry.nextAttemptAt) {
        tasks.push(refreshSource(entry.id, { force, reason }));
      }
    }
    if (!tasks.length) return [];
    return Promise.all(tasks);
  }

  async function refreshAll({ reason = "manual" } = {}) {
    const results = {};
    const tasks = [];
    for (const entry of entries.values()) {
      if (entry.kind === "passive") {
        results[entry.id] = { id: entry.id, status: "extension-managed", passive: true };
        continue;
      }
      tasks.push(
        refreshSource(entry.id, { force: true, reason }).then((res) => {
          results[entry.id] = res;
        })
      );
    }
    await Promise.all(tasks);
    return { status: "ok", results, snapshot: getStatusSnapshot() };
  }

  function handleSystemWake(reason = "wake") {
    // Reset backoff immediately so stale data refreshes cleanly once network settles.
    for (const entry of entries.values()) {
      if (entry.kind === "active") {
        entry.failureCount = 0;
        entry.nextAttemptAt = 0;
      }
    }
    if (wakeTimer) {
      clearTimeoutFn(wakeTimer);
      wakeTimer = null;
    }
    if (wakeSettleMs <= 0) {
      void pollDue({ force: true, reason });
      return;
    }
    wakeTimer = setTimeoutFn(() => {
      wakeTimer = null;
      void pollDue({ force: true, reason });
    }, wakeSettleMs);
    if (wakeTimer && typeof wakeTimer.unref === "function") wakeTimer.unref();
  }

  function nudgeSource(id, delayMs = 15_000) {
    const entry = entries.get(id);
    if (!entry || entry.kind !== "active") return;
    entry.nextAttemptAt = Math.min(entry.nextAttemptAt || Infinity, now() + Math.max(0, delayMs));
  }

  function noteExternalObservation(id, observedAt = now()) {
    const entry = entries.get(id);
    if (!entry) return;
    entry.lastSuccessAt = Math.max(entry.lastSuccessAt, Number(observedAt) || now());
    entry.lastStatus = "ok";
    if (entry.kind === "passive") entry.state = "ok";
    notify();
  }

  function getStatusSnapshot() {
    const out = {};
    for (const [id, entry] of entries.entries()) {
      out[id] = {
        kind: entry.kind,
        state: entry.state,
        lastStatus: entry.lastStatus,
        lastAttemptAt: entry.lastAttemptAt,
        lastSuccessAt: entry.lastSuccessAt,
        lastError: entry.lastError,
        nextAttemptAt: entry.nextAttemptAt,
        failureCount: entry.failureCount,
      };
    }
    return out;
  }

  function start() {
    if (started) return;
    started = true;
    tickTimer = setIntervalFn(() => {
      void pollDue({ reason: "scheduled" });
    }, TICK_MS);
    if (tickTimer && typeof tickTimer.unref === "function") tickTimer.unref();

    if (powerMonitor && typeof powerMonitor.on === "function") {
      for (const evt of ["resume", "unlock-screen"]) {
        const listener = () => handleSystemWake(evt);
        powerMonitor.on(evt, listener);
        powerListeners.push([evt, listener]);
      }
    }

    if (startupDelayMs <= 0) {
      void pollDue({ force: true, reason: "startup" });
    } else {
      startupTimer = setTimeoutFn(() => {
        startupTimer = null;
        void pollDue({ force: true, reason: "startup" });
      }, startupDelayMs);
      if (startupTimer && typeof startupTimer.unref === "function") startupTimer.unref();
    }
  }

  function stop() {
    started = false;
    if (tickTimer) { clearIntervalFn(tickTimer); tickTimer = null; }
    if (wakeTimer) { clearTimeoutFn(wakeTimer); wakeTimer = null; }
    if (startupTimer) { clearTimeoutFn(startupTimer); startupTimer = null; }
    if (powerMonitor && typeof powerMonitor.removeListener === "function") {
      for (const [evt, listener] of powerListeners) {
        try { powerMonitor.removeListener(evt, listener); } catch {}
      }
    }
    powerListeners.length = 0;
  }

  return {
    start,
    stop,
    pollDue,
    refreshSource,
    refreshAll,
    handleSystemWake,
    nudgeSource,
    noteExternalObservation,
    getStatusSnapshot,
  };
}

module.exports = {
  createQuotaRefreshManager,
};
