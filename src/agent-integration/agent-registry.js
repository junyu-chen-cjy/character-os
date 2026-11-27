"use strict";

const DEFAULT_CACHE_TTL_MS = 4_000;

function normalizeClientId(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "";
  if (s === "codex" || s.includes("codex") || s === "openai") return "codex";
  if (s === "antigravity" || s.includes("antigravity") || s.includes("agy")) return "antigravity";
  return "";
}

// Unified Agent Registry v2:
// Single source of truth for Workspace, Pet Halo, and Personal Agent Core.
// Combines active desktop discovery (Codex + standalone Antigravity), official
// protocol metadata (codex app-server thread/list), hook/log execution states,
// Accessibility permission status, and strict delegation lifecycle tracking.
function createAgentRegistry({
  platformAdapter,
  adapters = [],
  getHookSnapshot = () => ({ sessions: [] }),
  getPendingPermissions = () => [],
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  now = Date.now,
} = {}) {
  const adapterMap = new Map();
  for (const adapter of adapters) {
    if (adapter && adapter.id) adapterMap.set(adapter.id, adapter);
  }

  let latestSnapshot = {
    updatedAt: 0,
    accessibility: platformAdapter ? platformAdapter.getAccessibilityStatus() : { trusted: false },
    clients: [],
    sessions: [],
    projects: [],
  };
  let inFlightRefresh = null;

  // Delegation lifecycle tracker:
  //   located -> confirmed -> delivered -> started -> awaiting_approval -> completed | failed
  const delegations = new Map();

  function observeDelegation(sessionKey, liveSession) {
    const rec = delegations.get(sessionKey);
    if (!rec) return null;
    if (liveSession && (rec.stage === "delivered" || rec.stage === "started" || rec.stage === "awaiting_approval")) {
      if (liveSession.status === "awaiting_approval") {
        rec.stage = "awaiting_approval";
      } else if (liveSession.status === "running" && (!liveSession.updatedAt || liveSession.updatedAt >= rec.deliveredAt - 3000)) {
        rec.stage = "started";
        rec.startedAt = rec.startedAt || now();
      } else if (liveSession.status === "done" && liveSession.updatedAt && liveSession.updatedAt > rec.deliveredAt) {
        rec.stage = "completed";
        rec.completedAt = rec.completedAt || liveSession.updatedAt;
      } else if (rec.stage === "started" && (liveSession.status === "idle" || liveSession.status === "done")) {
        rec.stage = "completed";
        rec.completedAt = rec.completedAt || now();
      }
    }
    return {
      stage: rec.stage,
      deliveredAt: rec.deliveredAt ? new Date(rec.deliveredAt).toISOString() : null,
      startedAt: rec.startedAt ? new Date(rec.startedAt).toISOString() : null,
      completedAt: rec.completedAt ? new Date(rec.completedAt).toISOString() : null,
      verifiedInConversation: Boolean(rec.verifiedInConversation),
      messagePreview: rec.messagePreview || "",
      error: rec.error || "",
    };
  }

  // When a blank draft receives a message (e.g., codex:active-draft), the client
  // promotes it into a brand-new real session. Re-bind the active blank-draft
  // delegation record to that newly created/active session so lifecycle tracking
  // continues uninterrupted through started -> completed.
  function rebindBlankDraftDelegations(sessions) {
    for (const [key, rec] of Array.from(delegations.entries())) {
      if (!rec.wasBlankDraft || (rec.stage !== "delivered" && rec.stage !== "started" && rec.stage !== "awaiting_approval")) {
        continue;
      }
      const draftStillPresent = sessions.some((s) => s.key === key);
      // Prefer a brand-new session on the same client that received activity right after delivery!
      const candidate = sessions.find((s) =>
        s.clientId === rec.clientId
        && !s.isBlankDraft
        && (s.status === "running"
          || s.status === "done"
          || s.status === "awaiting_approval"
          || (s.updatedAt && s.updatedAt >= rec.deliveredAt - 4000)
          || (!draftStillPresent && s.isCurrentVisible))
      );
      if (candidate && !delegations.has(candidate.key)) {
        delegations.set(candidate.key, { ...rec, wasBlankDraft: false, promotedFromKey: key });
        delegations.delete(key);
      }
    }
  }

  function mergeProjects(clients, sessions) {
    const byKey = new Map();
    const byName = new Map();
    const findOrCreate = (name, cwd, clientId) => {
      const cleanCwd = typeof cwd === "string" ? cwd.trim() : "";
      const cleanName = typeof name === "string" ? name.trim() : "";
      if (!cleanName && !cleanCwd) return null;
      const cwdKey = cleanCwd ? cleanCwd.toLowerCase() : "";
      const nameKey = cleanName ? cleanName.toLowerCase() : "";
      const baseKey = cleanCwd ? cleanCwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop().toLowerCase() : "";

      let entry = (cwdKey && byKey.get(cwdKey))
        || (nameKey && byName.get(nameKey))
        || (baseKey && byName.get(baseKey))
        || null;

      if (!entry) {
        entry = { name: cleanName || baseKey || cleanCwd, cwd: cleanCwd, clients: new Set(), activeCount: 0, sessionCount: 0 };
        if (cwdKey) byKey.set(cwdKey, entry);
        if (nameKey) byName.set(nameKey, entry);
        if (baseKey) byName.set(baseKey, entry);
      } else {
        if (!entry.cwd && cleanCwd) {
          entry.cwd = cleanCwd;
          byKey.set(cwdKey, entry);
        }
        if (!entry.name && cleanName) entry.name = cleanName;
        if (nameKey && !byName.has(nameKey)) byName.set(nameKey, entry);
        if (baseKey && !byName.has(baseKey)) byName.set(baseKey, entry);
      }
      if (clientId) entry.clients.add(clientId);
      return entry;
    };

    for (const c of clients) {
      for (const p of c.projects || []) findOrCreate(p.name, p.cwd, c.id);
    }
    for (const s of sessions) {
      if (!s.projectName && !s.cwd) continue;
      const entry = findOrCreate(s.projectName, s.cwd, s.clientId);
      if (entry) {
        entry.sessionCount += 1;
        if (s.status === "running" || s.status === "awaiting_approval" || s.isCurrentVisible) {
          entry.activeCount += 1;
        }
      }
    }
    const unique = Array.from(new Set([...byKey.values(), ...byName.values()]));
    return unique.map((e) => ({
      name: e.name,
      cwd: e.cwd,
      clients: Array.from(e.clients),
      activeCount: e.activeCount,
      sessionCount: e.sessionCount,
    }));
  }

  async function refresh({ force = false } = {}) {
    const current = now();
    if (!force && latestSnapshot.updatedAt > 0 && current - latestSnapshot.updatedAt < cacheTtlMs) {
      return latestSnapshot;
    }
    if (inFlightRefresh) return inFlightRefresh;

    inFlightRefresh = (async () => {
      const hookSnap = getHookSnapshot() || { sessions: [] };
      const hookSessions = Array.isArray(hookSnap.sessions) ? hookSnap.sessions : [];
      const pendingApprovals = Array.isArray(getPendingPermissions()) ? getPendingPermissions() : [];
      const accessibility = platformAdapter ? platformAdapter.getAccessibilityStatus() : { trusted: false };

      const results = await Promise.all(
        Array.from(adapterMap.values()).map(async (adapter) => {
          try {
            return await adapter.discover({ hookSessions, pendingApprovals, force });
          } catch (err) {
            return {
              client: {
                id: adapter.id,
                name: adapter.name,
                bundleId: adapter.bundleId,
                installed: false,
                running: false,
                status: "error",
                error: err?.message || "Discovery failed",
                projects: [],
                sessionCount: 0,
              },
              sessions: [],
            };
          }
        })
      );

      const clients = results.map((r) => r.client);
      const rawSessions = results.flatMap((r) => r.sessions);
      rebindBlankDraftDelegations(rawSessions);
      const sessions = rawSessions.map((s) => ({
        ...s,
        lastDelegation: observeDelegation(s.key, s),
      }));
      const projects = mergeProjects(clients, sessions);

      latestSnapshot = {
        updatedAt: now(),
        accessibility,
        clients,
        sessions,
        projects,
      };
      return latestSnapshot;
    })().finally(() => {
      inFlightRefresh = null;
    });

    return inFlightRefresh;
  }

  function getSnapshot() {
    return {
      ...latestSnapshot,
      accessibility: platformAdapter ? platformAdapter.getAccessibilityStatus() : latestSnapshot.accessibility,
      sessions: latestSnapshot.sessions.map((s) => ({
        ...s,
        lastDelegation: observeDelegation(s.key, s),
      })),
    };
  }

  async function launchClient(clientId) {
    const id = normalizeClientId(clientId);
    const adapter = adapterMap.get(id);
    if (!adapter) return { status: "error", error: `Unknown client: ${clientId}` };
    return adapter.launchClient();
  }

  async function focusTarget({ clientId, sessionKey, sessionId } = {}) {
    const snap = latestSnapshot.updatedAt ? latestSnapshot : await refresh();
    let session = null;
    if (sessionKey) session = snap.sessions.find((s) => s.key === sessionKey) || null;
    if (!session && sessionId) {
      session = snap.sessions.find((s) => s.sessionId === sessionId || s.rawSessionId === sessionId) || null;
    }
    const targetClientId = session?.clientId || normalizeClientId(clientId);
    const adapter = adapterMap.get(targetClientId);
    if (!adapter) return { status: "error", error: `Unknown target client: ${clientId || sessionKey}` };
    return adapter.focusSession(session);
  }

  function resolveSessionTarget(snap, { client, sessionId, sessionKey, project, message }) {
    const cleanMsg = typeof message === "string" ? message.trim() : "";
    if (!cleanMsg) return { error: "Message content cannot be empty." };
    if (cleanMsg.length > 8000) return { error: "Message exceeds the 8,000 character safety limit." };

    const clientId = normalizeClientId(client);
    const projectNeedle = typeof project === "string" ? project.trim().toLowerCase() : "";

    // 1. Exact session key or sessionId match
    if (sessionKey || sessionId) {
      const exact = snap.sessions.find((s) =>
        (sessionKey && s.key === sessionKey)
        || (sessionId && (s.sessionId === sessionId || s.rawSessionId === sessionId || s.key === sessionId))
      );
      if (!exact) {
        return { error: `Target session "${sessionKey || sessionId}" was not found. Call list_agent_sessions first.` };
      }
      const clientInfo = snap.clients.find((c) => c.id === exact.clientId);
      if (!clientInfo?.running) {
        return { error: `${exact.clientName} desktop app is not running. Open it first before delegating.` };
      }
      return { client: clientInfo, session: exact, message: cleanMsg };
    }

    // 2. Filter discoverable desktop sessions (including current visible blank draft!)
    const candidates = snap.sessions.filter((s) => {
      if (s.kind !== "desktop") return false;
      if (clientId && s.clientId !== clientId) return false;
      if (projectNeedle) {
        const hay = `${s.projectName} ${s.cwd} ${s.title}`.toLowerCase();
        if (!hay.includes(projectNeedle)) return false;
      }
      return true;
    });

    if (candidates.length === 1) {
      const only = candidates[0];
      const clientInfo = snap.clients.find((c) => c.id === only.clientId);
      if (!clientInfo?.running) {
        return { error: `${only.clientName} desktop app is not running. Open it first.` };
      }
      return { client: clientInfo, session: only, message: cleanMsg };
    }

    // If a single client was specified and one candidate is the currently visible active session
    // matching the project (or no project filter and it's the only active visible session in a client with 1 visible session),
    // still ask user to disambiguate when multiple distinct sessions match so we NEVER guess!
    if (candidates.length > 1) {
      return {
        needsDisambiguation: true,
        status: "ambiguous",
        reason: "Multiple desktop sessions match. Ask the user to choose the exact target session (or specify session_id / session_key).",
        candidates: candidates.slice(0, 8).map((s) => ({
          sessionKey: s.key,
          sessionId: s.sessionId,
          client: s.clientId,
          title: s.isBlankDraft ? "(Current blank chat)" : s.title,
          isBlankDraft: s.isBlankDraft,
          isCurrentVisible: s.isCurrentVisible,
          project: s.projectName,
          cwd: s.cwd,
          status: s.status,
        })),
      };
    }

    // 3. No matching session: check whether the specified client is online or offline
    if (clientId) {
      const clientInfo = snap.clients.find((c) => c.id === clientId);
      if (!clientInfo?.installed) {
        return { error: `${clientId} desktop app is not installed on this machine.` };
      }
      if (!clientInfo.running) {
        return { error: `${clientInfo.name} desktop app is currently offline. Please launch it before sending a task.` };
      }
      // Client is running, no project match — list all available sessions of that client so user can choose.
      const allForClient = snap.sessions.filter((s) => s.clientId === clientId && s.kind === "desktop");
      if (allForClient.length > 0) {
        return {
          needsDisambiguation: true,
          status: "ambiguous",
          reason: `No ${clientInfo.name} session matched project "${project}". Choose from available sessions:`,
          candidates: allForClient.slice(0, 8).map((s) => ({
            sessionKey: s.key,
            sessionId: s.sessionId,
            client: s.clientId,
            title: s.isBlankDraft ? "(Current blank chat)" : s.title,
            isBlankDraft: s.isBlankDraft,
            isCurrentVisible: s.isCurrentVisible,
            project: s.projectName,
            cwd: s.cwd,
            status: s.status,
          })),
        };
      }
    }

    return {
      needsDisambiguation: true,
      status: "ambiguous",
      reason: "Could not identify a unique target desktop session. Specify client ('codex' or 'antigravity') and session.",
      candidates: snap.sessions.filter((s) => s.kind === "desktop").slice(0, 8).map((s) => ({
        sessionKey: s.key,
        sessionId: s.sessionId,
        client: s.clientId,
        title: s.isBlankDraft ? "(Current blank chat)" : s.title,
        isBlankDraft: s.isBlankDraft,
        isCurrentVisible: s.isCurrentVisible,
        project: s.projectName,
        cwd: s.cwd,
        status: s.status,
      })),
    };
  }

  async function prepareDelegation(args = {}) {
    const snap = await refresh({ force: true });
    const resolved = resolveSessionTarget(snap, args);
    if (resolved.error) return null; // execute() will return the structured error cleanly
    if (resolved.needsDisambiguation) return resolved;

    delegations.set(resolved.session.key, {
      stage: "located",
      locatedAt: now(),
      deliveredAt: 0,
      startedAt: 0,
      completedAt: 0,
      verifiedInConversation: false,
      messagePreview: resolved.message.slice(0, 120),
      error: "",
    });

    return {
      confirm: {
        action: "send_agent_message",
        client: resolved.client.id,
        clientLabel: resolved.client.name,
        bundleId: resolved.client.bundleId,
        sessionKey: resolved.session.key,
        sessionId: resolved.session.sessionId,
        sessionTitle: resolved.session.isBlankDraft ? "" : resolved.session.title,
        isBlankDraft: resolved.session.isBlankDraft,
        project: resolved.session.projectName || "",
        cwd: resolved.session.cwd || "",
        message: resolved.message,
        deliveryMethod: platformAdapter?.isMac ? "macOS Accessibility (verified desktop session)" : "unsupported",
      },
    };
  }

  async function delegateMessage(args = {}) {
    const snap = await refresh({ force: true });
    const resolved = resolveSessionTarget(snap, args);
    if (resolved.error) return { status: "error", stage: "failed", error: resolved.error };
    if (resolved.needsDisambiguation) return resolved;

    const ax = platformAdapter ? platformAdapter.getAccessibilityStatus() : { trusted: false };
    if (!ax.trusted) {
      return {
        status: "error",
        stage: "failed",
        deliveryStatus: "needs_accessibility",
        executionStatus: "not_started",
        accessibility: ax,
        error: `macOS Accessibility permission is required for ${ax.appDisplayName || "Character OS"} (${ax.appBundlePath}). Open Workspace → Connections to grant access.`,
      };
    }

    const adapter = adapterMap.get(resolved.client.id);
    if (!adapter) return { status: "error", stage: "failed", error: `No adapter registered for ${resolved.client.id}` };

    delegations.set(resolved.session.key, {
      stage: "confirmed",
      locatedAt: now(),
      deliveredAt: 0,
      startedAt: 0,
      completedAt: 0,
      verifiedInConversation: false,
      messagePreview: resolved.message.slice(0, 120),
      error: "",
    });

    const outcome = await adapter.deliverMessage({
      session: resolved.session,
      message: resolved.message,
    });

    const ts = now();
    if (outcome && outcome.status === "ok" && outcome.deliveryStatus === "delivered") {
      delegations.set(resolved.session.key, {
        stage: "delivered",
        clientId: resolved.client.id,
        wasBlankDraft: Boolean(resolved.session.isBlankDraft),
        deliveredAt: ts,
        startedAt: 0,
        completedAt: 0,
        verifiedInConversation: Boolean(outcome.verifiedInConversation),
        messagePreview: resolved.message.slice(0, 120),
        error: "",
      });
      return {
        status: "ok",
        stage: "delivered",
        deliveryStatus: "delivered",
        executionStatus: "pending_observation",
        verifiedInConversation: Boolean(outcome.verifiedInConversation),
        composerCleared: Boolean(outcome.composerCleared),
        deliveredAt: new Date(ts).toISOString(),
        client: resolved.client.id,
        clientLabel: resolved.client.name,
        sessionKey: resolved.session.key,
        sessionId: resolved.session.sessionId,
        sessionTitle: resolved.session.isBlankDraft ? "(Current blank chat)" : resolved.session.title,
        isBlankDraft: resolved.session.isBlankDraft,
        project: resolved.session.projectName || "",
        note: "Message delivered into the verified desktop session. Task start and completion are observed separately via live hooks/logs; call get_agent_status to monitor progress.",
      };
    }

    delegations.set(resolved.session.key, {
      stage: "failed",
      deliveredAt: 0,
      startedAt: 0,
      completedAt: 0,
      verifiedInConversation: false,
      messagePreview: resolved.message.slice(0, 120),
      error: outcome?.error || outcome?.deliveryStatus || "Delivery failed",
    });

    return {
      status: "error",
      stage: "failed",
      deliveryStatus: outcome?.deliveryStatus || "failed",
      executionStatus: "not_started",
      client: resolved.client.id,
      clientLabel: resolved.client.name,
      sessionKey: resolved.session.key,
      error: outcome?.error || "Failed to deliver message to desktop session.",
    };
  }

  return {
    refresh,
    getSnapshot,
    launchClient,
    focusTarget,
    prepareDelegation,
    delegateMessage,
    getAccessibilityStatus: (opts) => platformAdapter?.getAccessibilityStatus(opts),
    openAccessibilitySettings: () => platformAdapter?.openAccessibilitySettings(),
    revealAuthorizedAppInFinder: () => platformAdapter?.revealAuthorizedAppInFinder(),
  };
}

module.exports = {
  normalizeClientId,
  createAgentRegistry,
};
