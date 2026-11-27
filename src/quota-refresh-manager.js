"use strict";

const MINUTE = 60_000;
const TICK_MS = 15_000;
const DEFAULT_WAKE_SETTLE_MS = 4_000;
const DEFAULT_STARTUP_DELAY_MS = 1_500;

// Centralized dynamic refresh policy — single place to tune all cadences,
// guardrails, and staleness thresholds across all quota sources.
const QUOTA_REFRESH_POLICY = Object.freeze({
  codex: Object.freeze({
    activeMs: 60_000,            // ~60s while Codex is active or recently used
    idleMs: 300_000,             // ~5m while idle
    nearResetMs: 45_000,         // ~45s approaching/past resetAt until new reading confirms
    nearResetLeadMs: 3 * MINUTE, // accelerate 3m before scheduled reset
    nearResetTrailMs: 5 * MINUTE,// keep checking up to 5m after resetAt until confirmed
    minIntervalMs: 15_000,       // hard floor between completed queries
    manualMinIntervalMs: 5_000,  // manual refresh anti-double-click floor
    hoverFreshnessMs: 45_000,    // refresh on pet hover / Workspace open if older than 45s
    activeGraceMs: 5 * MINUTE,   // stay in active cadence 5m after last session activity
    completionDelayMs: 2_500,    // immediate refresh shortly after a task finishes
    maxBackoffMs: 10 * MINUTE,
  }),
  antigravity: Object.freeze({
    // Both Antigravity Gemini & Claude/GPT groups share ONE single `agy -p /usage` query.
    activeMs: 60_000,
    idleMs: 300_000,
    nearResetMs: 45_000,
    nearResetLeadMs: 3 * MINUTE,
    nearResetTrailMs: 5 * MINUTE,
    minIntervalMs: 20_000,       // respects ~3-6s CLI startup overhead
    manualMinIntervalMs: 5_000,
    hoverFreshnessMs: 60_000,
    activeGraceMs: 5 * MINUTE,
    completionDelayMs: 3_000,
    maxBackoffMs: 10 * MINUTE,
  }),
  geminiChat: Object.freeze({
    // Driven via Chrome extension background sync with lightweight local policy check.
    activeMs: 120_000,           // ~2m when actively inspecting or recently active
    idleMs: 600_000,             // ~10m when idle (zero background tabs opened between checks)
    nearResetMs: 120_000,        // ~2m near reset (respects Chrome alarm floor & avoids tab churn)
    nearResetLeadMs: 5 * MINUTE,
    nearResetTrailMs: 5 * MINUTE,
    minIntervalMs: 60_000,       // never trigger Chrome tab read more often than every 60s
    manualMinIntervalMs: 60_000,
    hoverFreshnessMs: 120_000,
    activeGraceMs: 10 * MINUTE,
    completionDelayMs: 0,
    maxBackoffMs: 10 * MINUTE,
  }),
});

function resolvePolicy(id, overrides = {}) {
  const base = QUOTA_REFRESH_POLICY[id] || QUOTA_REFRESH_POLICY.codex;
  return { ...base, ...overrides };
}

function collectResetTimestampsForSource(accountQuota, id) {
  const resets = [];
  if (!Array.isArray(accountQuota)) return resets;
  for (const src of accountQuota) {
    if (!src || typeof src !== "object") continue;
    const groups = [];
    if (id === "codex" && src.codexQuota?.group) {
      groups.push(src.codexQuota.group);
    } else if (id === "antigravity") {
      if (src.antigravityCliQuota?.group) groups.push(src.antigravityCliQuota.group);
      else if (src.antigravityQuota?.group) groups.push(src.antigravityQuota.group);
    } else if (id === "geminiChat" && src.geminiChatQuota?.group) {
      groups.push(src.geminiChatQuota.group);
    }
    for (const group of groups) {
      for (const bucket of Object.values(group)) {
        if (!bucket || bucket.disabled === true) continue;
        const resetAt = Number(bucket.resetAt);
        if (Number.isFinite(resetAt) && resetAt > 0) {
          resets.push({
            resetAt,
            lastSeenAt: Number(bucket.lastSeenAt) || 0,
          });
        }
      }
    }
  }
  return resets;
}

// Unified dynamic scheduler and status owner for all active & passive quota sources.
// Coordinates startup refresh, active/idle/near-reset cadences, task-completion triggers,
// pet-hover & Workspace-open staleness triggers, sleep/wake recovery, exponential failure
// backoff (capped), concurrency deduplication, and minimum request intervals.
function createQuotaRefreshManager({
  sources = {},
  systemIdleState = () => "active",
  powerMonitor = null,
  getAccountQuotaSnapshot = () => [],
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
  const completionTimers = new Map();
  let previousSessionBadges = new Map();

  // Per-source runtime state
  const entries = new Map();
  for (const [id, cfg] of Object.entries(sources)) {
    if (!cfg || typeof cfg !== "object") continue;
    const policy = resolvePolicy(id, {
      ...(Number.isFinite(cfg.intervalMs) ? { idleMs: Math.max(MINUTE, cfg.intervalMs) } : {}),
      ...(cfg.policy || {}),
    });
    entries.set(id, {
      id,
      kind: cfg.kind || "active", // "active" | "passive"
      policy,
      refreshFn: typeof cfg.refresh === "function" ? cfg.refresh : null,
      inFlight: null,
      state: cfg.kind === "passive" ? "passive" : "idle",
      mode: "idle", // "idle" | "active" | "near-reset"
      lastAttemptAt: 0,
      lastCompletedAt: 0,
      lastSuccessAt: 0,
      lastActivityAt: 0,
      runningSessionIds: new Set(),
      lastStatus: cfg.kind === "passive" ? "extension-managed" : "waiting",
      lastError: "",
      failureCount: 0,
      nextAttemptAt: 0,
    });
  }

  function notify() {
    try { onStatusChange(getStatusSnapshot()); } catch {}
  }

  function isNearReset(entry, current) {
    let accountQuota = [];
    try { accountQuota = getAccountQuotaSnapshot() || []; } catch {}
    const resets = collectResetTimestampsForSource(accountQuota, entry.id);
    const lead = entry.policy.nearResetLeadMs;
    const trail = entry.policy.nearResetTrailMs;
    for (const { resetAt, lastSeenAt } of resets) {
      const untilReset = resetAt - current;
      // Within lead window before reset OR within trail window after reset where
      // no fresh post-reset reading has been confirmed yet.
      if (untilReset <= lead && untilReset >= -trail) {
        const confirmedAfterReset = Math.max(entry.lastSuccessAt, lastSeenAt) >= resetAt;
        if (!confirmedAfterReset) return true;
      }
    }
    return false;
  }

  function isSourceActive(entry, current) {
    if (entry.runningSessionIds.size > 0) return true;
    if (entry.lastActivityAt > 0 && current - entry.lastActivityAt < entry.policy.activeGraceMs) {
      return true;
    }
    return false;
  }

  function evaluateCadence(entry, current = now()) {
    if (isNearReset(entry, current)) {
      return { mode: "near-reset", intervalMs: entry.policy.nearResetMs };
    }
    if (isSourceActive(entry, current)) {
      return { mode: "active", intervalMs: entry.policy.activeMs };
    }
    return { mode: "idle", intervalMs: entry.policy.idleMs };
  }

  function computeBackoffMs(entry, status, failureCount, baseIntervalMs) {
    if (status === "ok" || status === "unchanged") return baseIntervalMs;
    if (status === "auth-required") return entry.policy.maxBackoffMs;
    if (status === "network-error" || status === "timeout") {
      const mins = Math.min(10, Math.pow(2, Math.max(0, Math.min(failureCount - 1, 3))));
      return Math.min(entry.policy.maxBackoffMs, mins * MINUTE);
    }
    const mins = Math.min(10, Math.pow(2, Math.min(failureCount, 4)));
    return Math.min(entry.policy.maxBackoffMs, mins * MINUTE);
  }

  function clearCompletionTimer(id) {
    const timer = completionTimers.get(id);
    if (timer) {
      clearTimeoutFn(timer);
      completionTimers.delete(id);
    }
  }

  async function refreshSource(id, { force = false, reason = "auto", bypassMinInterval = false } = {}) {
    const entry = entries.get(id);
    if (!entry) return { id, status: "unknown-source" };

    if (entry.kind === "passive" || !entry.refreshFn) {
      return {
        id,
        status: entry.lastStatus || "extension-managed",
        passive: true,
      };
    }

    // Coalesce concurrent requests for the same source into one single execution.
    if (entry.inFlight) {
      return entry.inFlight;
    }

    const current = now();
    const cadence = evaluateCadence(entry, current);
    entry.mode = cadence.mode;

    // Enforce hard minimum interval between consecutive completed requests.
    const floorMs = force ? entry.policy.manualMinIntervalMs : entry.policy.minIntervalMs;
    if (!bypassMinInterval && entry.lastCompletedAt > 0 && current - entry.lastCompletedAt < floorMs) {
      return { id, status: entry.lastStatus, skipped: true, reason: "min-interval" };
    }

    if (!force) {
      const scheduledDue = entry.lastCompletedAt > 0
        ? Math.min(entry.nextAttemptAt || Infinity, entry.lastCompletedAt + cadence.intervalMs)
        : entry.nextAttemptAt;
      if (current < scheduledDue) {
        return { id, status: entry.lastStatus, skipped: true, reason: "not-due" };
      }
      const idle = systemIdleState();
      if (idle !== "active" && idle !== "idle") {
        return { id, status: "deferred-locked", skipped: true };
      }
    }

    clearCompletionTimer(id);
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

      entry.lastCompletedAt = finishTime;
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

      const nextCadence = evaluateCadence(entry, finishTime);
      entry.mode = nextCadence.mode;
      entry.nextAttemptAt = finishTime + computeBackoffMs(entry, status, entry.failureCount, nextCadence.intervalMs);
      notify();
      return { id, status, error: entry.lastError, capturedAt: entry.lastSuccessAt };
    })().finally(() => {
      entry.inFlight = null;
    });

    entry.inFlight = run;
    return run;
  }

  async function pollDue({ force = false, reason = "scheduled" } = {}) {
    const current = now();
    const tasks = [];
    for (const entry of entries.values()) {
      if (entry.kind !== "active") continue;
      const cadence = evaluateCadence(entry, current);
      entry.mode = cadence.mode;
      const effectiveDue = entry.failureCount > 0
        ? entry.nextAttemptAt
        : (entry.lastCompletedAt > 0
          ? Math.min(entry.nextAttemptAt || Infinity, entry.lastCompletedAt + cadence.intervalMs)
          : entry.nextAttemptAt);
      if (force || current >= effectiveDue) {
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
        entry.lastActivityAt = now();
        results[entry.id] = { id: entry.id, status: "extension-managed", passive: true };
        continue;
      }
      tasks.push(
        refreshSource(entry.id, { force: true, reason, bypassMinInterval: true }).then((res) => {
          results[entry.id] = res;
        })
      );
    }
    await Promise.all(tasks);
    return { status: "ok", results, snapshot: getStatusSnapshot() };
  }

  function markSourceActive(id, timestamp = now()) {
    const entry = entries.get(id);
    if (!entry) return;
    entry.lastActivityAt = Math.max(entry.lastActivityAt, timestamp);
    entry.mode = evaluateCadence(entry, timestamp).mode;
  }

  function triggerTaskCompleted(id) {
    const entry = entries.get(id);
    if (!entry || entry.kind !== "active") return;
    const current = now();
    entry.lastActivityAt = current;
    const delay = entry.policy.completionDelayMs;
    clearCompletionTimer(id);
    if (delay <= 0) {
      void refreshSource(id, { force: true, reason: "task-completed" });
      return;
    }
    const timer = setTimeoutFn(() => {
      completionTimers.delete(id);
      void refreshSource(id, { force: true, reason: "task-completed" });
    }, delay);
    if (timer && typeof timer.unref === "function") timer.unref();
    completionTimers.set(id, timer);
  }

  // Observes live agent sessions: keeps active cadence while sessions run and
  // triggers immediate post-completion refresh when a task transitions running -> done.
  function observeSessions(sessionList) {
    const current = now();
    const nextBadges = new Map();
    const codexRunning = new Set();
    const agyRunning = new Set();

    for (const s of sessionList ?? []) {
      if (!s || s.host || s.startupRecovered || s.headless) continue;
      const sourceId = s.agentId === "codex"
        ? "codex"
        : s.agentId === "antigravity-cli"
          ? "antigravity"
          : "";
      if (!sourceId) continue;

      if (s.badge === "running") {
        if (sourceId === "codex") codexRunning.add(s.id);
        else agyRunning.add(s.id);
        markSourceActive(sourceId, current);
      }

      const prev = previousSessionBadges.get(s.id);
      if (prev === "running" && s.badge === "done") {
        triggerTaskCompleted(sourceId);
      }
      nextBadges.set(s.id, s.badge);
    }

    const codexEntry = entries.get("codex");
    if (codexEntry) codexEntry.runningSessionIds = codexRunning;
    const agyEntry = entries.get("antigravity");
    if (agyEntry) agyEntry.runningSessionIds = agyRunning;
    previousSessionBadges = nextBadges;
  }

  // Non-blocking interaction hook called when the user hovers the pet or opens Workspace.
  // Immediately triggers async background refreshes for any source whose data isn't fresh enough.
  function onUserInspect(reason = "ui-inspect") {
    const current = now();
    const geminiEntry = entries.get("geminiChat");
    if (geminiEntry) {
      geminiEntry.lastActivityAt = current;
      geminiEntry.mode = evaluateCadence(geminiEntry, current).mode;
    }

    const triggered = [];
    for (const entry of entries.values()) {
      if (entry.kind !== "active") continue;
      const age = entry.lastSuccessAt > 0 ? current - entry.lastSuccessAt : Infinity;
      const needsRefresh = age >= entry.policy.hoverFreshnessMs || isNearReset(entry, current);
      if (needsRefresh) {
        triggered.push(entry.id);
        void refreshSource(entry.id, { force: true, reason });
      }
    }
    return triggered;
  }

  function handleSystemWake(reason = "wake") {
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

  function nudgeSource(id, delayMs = 3_000) {
    const entry = entries.get(id);
    if (!entry || entry.kind !== "active") return;
    entry.nextAttemptAt = Math.min(entry.nextAttemptAt || Infinity, now() + Math.max(0, delayMs));
  }

  function noteExternalObservation(id, observedAt = now()) {
    const entry = entries.get(id);
    if (!entry) return;
    const ts = Number(observedAt) || now();
    entry.lastSuccessAt = Math.max(entry.lastSuccessAt, ts);
    entry.lastCompletedAt = Math.max(entry.lastCompletedAt, ts);
    entry.lastStatus = "ok";
    if (entry.kind === "passive") entry.state = "ok";
    entry.mode = evaluateCadence(entry, now()).mode;
    notify();
  }

  // Lightweight policy handshake for the Gemini Chrome extension so it opens ZERO
  // background tabs while idle (10m) and smoothly accelerates to 2m when active or near reset.
  function getGeminiBrowserPolicy() {
    const current = now();
    const entry = entries.get("geminiChat");
    if (!entry) {
      return { shouldRefresh: true, mode: "idle", desiredIntervalMs: 600_000, nextCheckMinutes: 2 };
    }
    const cadence = evaluateCadence(entry, current);
    entry.mode = cadence.mode;
    const age = entry.lastSuccessAt > 0 ? current - entry.lastSuccessAt : Infinity;
    const shouldRefresh = age >= Math.max(entry.policy.minIntervalMs, cadence.intervalMs);
    return {
      shouldRefresh,
      mode: cadence.mode,
      desiredIntervalMs: cadence.intervalMs,
      minIntervalMs: entry.policy.minIntervalMs,
      nextCheckMinutes: Math.max(2, Math.round(entry.policy.activeMs / MINUTE)),
      lastSuccessAt: entry.lastSuccessAt || null,
    };
  }

  function getStatusSnapshot() {
    const current = now();
    const out = {};
    for (const [id, entry] of entries.entries()) {
      const cadence = evaluateCadence(entry, current);
      out[id] = {
        kind: entry.kind,
        state: entry.state,
        mode: cadence.mode,
        desiredIntervalMs: cadence.intervalMs,
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
    for (const id of Array.from(completionTimers.keys())) clearCompletionTimer(id);
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
    markSourceActive,
    triggerTaskCompleted,
    observeSessions,
    onUserInspect,
    handleSystemWake,
    nudgeSource,
    noteExternalObservation,
    getGeminiBrowserPolicy,
    getStatusSnapshot,
  };
}

module.exports = {
  QUOTA_REFRESH_POLICY,
  createQuotaRefreshManager,
};
