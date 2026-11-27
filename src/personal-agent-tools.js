"use strict";

const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { buildUnifiedQuotaRows } = require("./quota-view-model");

const execFileAsync = promisify(execFile);

const CLIENT_CONFIG = Object.freeze({
  codex: {
    id: "codex",
    label: "Codex",
    agentIds: new Set(["codex"]),
    bundleId: "com.openai.codex",
    processNames: ["Codex", "ChatGPT"],
  },
  antigravity: {
    id: "antigravity",
    label: "Antigravity (Gemini App)",
    agentIds: new Set(["antigravity-cli", "antigravity", "gemini-cli"]),
    bundleId: "com.google.GeminiMacOS",
    processNames: ["Gemini"],
  },
});

const SERVICE_NAMES = Object.freeze({
  codex: "Codex Agent",
  "antigravity-gemini": "Antigravity · Gemini",
  "antigravity-claude-gpt": "Antigravity · Claude / GPT",
  "gemini-chat": "Gemini Chat",
});

function normalizeClientKey(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "";
  if (s === "codex" || s.includes("codex") || s === "openai") return "codex";
  if (s === "antigravity" || s.includes("antigravity") || s.includes("agy") || s === "gemini") return "antigravity";
  return "";
}

function clientForAgentId(agentId) {
  const id = String(agentId || "").toLowerCase();
  if (CLIENT_CONFIG.codex.agentIds.has(id)) return "codex";
  if (CLIENT_CONFIG.antigravity.agentIds.has(id)) return "antigravity";
  return id || "unknown";
}

function projectNameFromCwd(cwd) {
  if (typeof cwd !== "string" || !cwd.trim()) return "";
  return path.basename(cwd.replace(/[\\/]+$/, "")) || cwd;
}

function mapLiveSession(session, pendingApprovals = []) {
  const approvalsForSession = pendingApprovals.filter(
    (p) => p && (p.sessionId === session.id || (session.rawSessionId && p.sessionId === session.rawSessionId))
  );
  const status = approvalsForSession.length > 0
    ? "awaiting_approval"
    : (session.badge || "idle");
  return {
    id: session.id,
    rawSessionId: session.rawSessionId || session.id,
    agentId: session.agentId || "",
    client: clientForAgentId(session.agentId),
    agentName: session.agentName || session.agentId || "",
    title: session.displayTitle || session.sessionTitle || projectNameFromCwd(session.cwd) || session.id,
    cwd: session.cwd || "",
    projectName: projectNameFromCwd(session.cwd),
    status,
    badge: session.badge || "idle",
    lastEvent: session.lastEvent || "",
    lastEventAt: Number(session.lastEventAt || session.updatedAt || 0) || null,
    canFocus: Boolean(session.canFocus),
    isLive: true,
    pendingApprovals: approvalsForSession.map((p) => ({
      toolName: p.toolName || "",
      summary: p.summary || p.command || "",
    })),
  };
}

function mapRecentSession(item) {
  return {
    id: item.historyKey || item.sessionId || "",
    rawSessionId: item.sessionId || "",
    agentId: item.agentId || "",
    client: clientForAgentId(item.agentId),
    agentName: item.agentName || item.agentId || "",
    title: item.title || projectNameFromCwd(item.cwd) || item.sessionId || "",
    cwd: item.cwd || "",
    projectName: projectNameFromCwd(item.cwd),
    status: "recent",
    badge: "recent",
    lastEvent: "",
    lastEventAt: Number(item.updatedAt || item.mtimeMs || 0) || null,
    canFocus: false,
    isLive: false,
    pendingApprovals: [],
  };
}

function formatSlotForAgent(slot) {
  if (!slot) return null;
  if (slot.kind === "disabled") {
    return {
      status: "disabled",
      note: "This window is currently disabled / not applicable.",
      windowMinutes: slot.windowMinutes || null,
    };
  }
  return {
    status: slot.expired ? "expired" : slot.stale ? "stale" : "ok",
    remainingPercent: slot.remaining,
    usedPercent: Math.round(slot.usedPercent),
    windowMinutes: slot.windowMinutes || null,
    resetAt: Number.isFinite(slot.resetAt) ? new Date(slot.resetAt).toISOString() : null,
    lastSeenAt: slot.lastSeenAt ? new Date(slot.lastSeenAt).toISOString() : null,
  };
}

// Controlled macOS Accessibility delivery into an already-open desktop app.
// Never spawns a fake CLI session and never sends Return unless an editable
// text field/area is verified focused inside the target application.
async function deliverMessageViaMacAccessibility({
  bundleId,
  processNames,
  message,
  execFileFn = execFileAsync,
  signal,
}) {
  // 1. Activate the target app cleanly via LaunchServices.
  await execFileFn("/usr/bin/open", ["-b", bundleId], { timeout: 5000, signal });

  // Wait briefly for window activation before inspecting focused element.
  const processListExpr = processNames.map((n) => `"${n.replace(/"/g, '\\"')}"`).join(", ");
  const script = [
    "on run argv",
    "  set msgText to item 1 of argv",
    "  set prevClip to missing value",
    "  try",
    "    set prevClip to the clipboard",
    "  end try",
    "  delay 0.35",
    '  tell application "System Events"',
    "    set targetProc to missing value",
    `    repeat with pname in {${processListExpr}}`,
    "      if exists process pname then",
    "        set targetProc to process pname",
    "        exit repeat",
    "      end if",
    "    end repeat",
    "    if targetProc is missing value then",
    '      return "APP_NOT_RUNNING"',
    "    end if",
    "    set frontmost of targetProc to true",
    "    delay 0.15",
    "    set focusedRole to \"\"",
    "    try",
    "      set focusedEl to value of attribute \"AXFocusedUIElement\" of targetProc",
    "      set focusedRole to value of attribute \"AXRole\" of focusedEl",
    "    end try",
    '    if focusedRole is not "AXTextArea" and focusedRole is not "AXTextField" and focusedRole is not "AXWebArea" then',
    "      set the clipboard to msgText",
    '      return "COMPOSER_NOT_FOCUSED:" & focusedRole',
    "    end if",
    "    set the clipboard to msgText",
    "    delay 0.08",
    '    keystroke "v" using command down',
    "    delay 0.12",
    "    key code 36",
    "  end tell",
    "  delay 0.2",
    "  if prevClip is not missing value then",
    "    try",
    "      set the clipboard to prevClip",
    "    end try",
    "  end if",
    '  return "SENT"',
    "end run",
  ].join("\n");

  const { stdout } = await execFileFn("/usr/bin/osascript", ["-e", script, "--", message], {
    timeout: 10_000,
    signal,
  });
  const token = String(stdout || "").trim();
  if (token === "SENT") {
    return { deliveryStatus: "sent", detail: "Message pasted and submitted to the focused composer." };
  }
  if (token.startsWith("COMPOSER_NOT_FOCUSED")) {
    return {
      deliveryStatus: "composer_not_focused",
      detail: "Activated the desktop app and copied your message to the clipboard, but the chat input box was not focused so Return was not pressed.",
    };
  }
  return {
    deliveryStatus: "app_not_running",
    detail: `Target desktop app process was not found (${token || "unknown"}).`,
  };
}

function createAgentTools({
  getSessionSnapshot,
  getPendingPermissions,
  listResumableSessions,
  focusSession,
  isAccessibilityTrusted,
  platform = process.platform,
  execFileFn = execFileAsync,
  deliverViaAccessibilityFn = deliverMessageViaMacAccessibility,
  now = Date.now,
} = {}) {
  // Tracks dispatched messages so get_agent_status can distinguish:
  //   sent (delivered to UI) -> started (observed running) -> completed (observed done)
  const delegations = new Map();

  function getLiveSessions() {
    const snap = typeof getSessionSnapshot === "function" ? getSessionSnapshot() : { sessions: [] };
    const pending = typeof getPendingPermissions === "function" ? getPendingPermissions() : [];
    const list = Array.isArray(snap?.sessions) ? snap.sessions : [];
    return list
      .filter((s) => s && !s.headless)
      .map((s) => mapLiveSession(s, Array.isArray(pending) ? pending : []));
  }

  function observeDelegationState(sessionId, liveSession) {
    const rec = delegations.get(sessionId);
    if (!rec) return null;
    if (liveSession) {
      if (liveSession.status === "awaiting_approval") {
        rec.executionStatus = "awaiting_approval";
      } else if (liveSession.badge === "running" && (!liveSession.lastEventAt || liveSession.lastEventAt >= rec.dispatchedAt - 2000)) {
        rec.executionStatus = "started";
        rec.startedAt = rec.startedAt || now();
      } else if (liveSession.badge === "done" && liveSession.lastEventAt && liveSession.lastEventAt > rec.dispatchedAt) {
        rec.executionStatus = "completed";
        rec.completedAt = rec.completedAt || liveSession.lastEventAt;
      }
    }
    return {
      dispatchedAt: new Date(rec.dispatchedAt).toISOString(),
      deliveryStatus: rec.deliveryStatus,
      executionStatus: rec.executionStatus,
      messagePreview: rec.messagePreview,
    };
  }

  async function listAgentSessions(args = {}) {
    const agentFilter = normalizeClientKey(args.agent);
    const projectFilter = typeof args.project === "string" ? args.project.trim().toLowerCase() : "";
    const includeRecent = args.include_recent !== false;

    const live = getLiveSessions();
    let recent = [];
    if (includeRecent && typeof listResumableSessions === "function") {
      try {
        const res = await listResumableSessions();
        const items = Array.isArray(res?.sessions) ? res.sessions : (Array.isArray(res) ? res : []);
        const liveIds = new Set(live.map((s) => s.rawSessionId));
        recent = items
          .map(mapRecentSession)
          .filter((item) => item.id && !liveIds.has(item.rawSessionId))
          .slice(0, 12);
      } catch {}
    }

    const matches = (s) => {
      if (agentFilter && s.client !== agentFilter) return false;
      if (projectFilter) {
        const hay = `${s.projectName} ${s.cwd} ${s.title}`.toLowerCase();
        if (!hay.includes(projectFilter)) return false;
      }
      return true;
    };

    const filteredLive = live.filter(matches).map((s) => ({
      ...s,
      lastDelegation: observeDelegationState(s.id, s),
    }));
    const filteredRecent = recent.filter(matches);

    return {
      status: "ok",
      liveCount: filteredLive.length,
      recentCount: filteredRecent.length,
      liveSessions: filteredLive,
      recentSessions: filteredRecent,
    };
  }

  async function getAgentStatus(args = {}) {
    const sessionId = typeof args.session_id === "string" ? args.session_id.trim() : "";
    const agentFilter = normalizeClientKey(args.agent);
    const projectFilter = typeof args.project === "string" ? args.project.trim().toLowerCase() : "";

    const live = getLiveSessions();
    const matched = live.filter((s) => {
      if (sessionId && s.id !== sessionId && s.rawSessionId !== sessionId) return false;
      if (agentFilter && s.client !== agentFilter) return false;
      if (projectFilter) {
        const hay = `${s.projectName} ${s.cwd} ${s.title}`.toLowerCase();
        if (!hay.includes(projectFilter)) return false;
      }
      return true;
    });

    const pending = typeof getPendingPermissions === "function" ? getPendingPermissions() : [];
    return {
      status: "ok",
      timestamp: new Date(now()).toISOString(),
      totalLiveSessions: live.length,
      pendingApprovalsTotal: Array.isArray(pending) ? pending.length : 0,
      sessions: matched.map((s) => ({
        ...s,
        lastDelegation: observeDelegationState(s.id, s),
      })),
    };
  }

  async function getQuota(args = {}) {
    const snap = typeof getSessionSnapshot === "function" ? getSessionSnapshot() : { accountQuota: [] };
    const ts = now();
    const rows = buildUnifiedQuotaRows(snap?.accountQuota || [], ts);
    const filter = typeof args.service === "string" ? args.service.trim().toLowerCase() : "";

    const filtered = !filter || filter === "all"
      ? rows
      : rows.filter((row) => {
        if (filter === "codex") return row.id === "codex";
        if (filter === "antigravity" || filter === "agy") return row.id.startsWith("antigravity-");
        if (filter === "claude" || filter === "gpt" || filter === "thirdparty") return row.id === "antigravity-claude-gpt";
        if (filter === "gemini") return row.id === "antigravity-gemini" || row.id === "gemini-chat";
        return row.id.includes(filter);
      });

    return {
      status: "ok",
      timestamp: new Date(ts).toISOString(),
      services: filtered.map((row) => ({
        id: row.id,
        name: SERVICE_NAMES[row.id] || row.id,
        status: row.unknown ? "unknown" : row.expired ? "expired" : row.stale ? "stale" : "ok",
        shortWindow: formatSlotForAgent(row.shortWindow),
        weeklyWindow: formatSlotForAgent(row.weeklyWindow),
        lastSeenAt: row.lastSeenAt ? new Date(row.lastSeenAt).toISOString() : null,
        source: row.source || null,
      })),
    };
  }

  function resolveMessageTarget(args = {}) {
    const message = typeof args.message === "string" ? args.message.trim() : "";
    if (!message) {
      return { error: "Message content cannot be empty." };
    }
    if (message.length > 8000) {
      return { error: "Message exceeds the 8,000 character safety limit." };
    }

    const explicitClient = normalizeClientKey(args.client);
    const sessionId = typeof args.session_id === "string" ? args.session_id.trim() : "";
    const projectFilter = typeof args.project === "string" ? args.project.trim().toLowerCase() : "";
    const live = getLiveSessions();

    // 1. Exact session ID match wins immediately.
    if (sessionId) {
      const exact = live.find((s) => s.id === sessionId || s.rawSessionId === sessionId);
      if (!exact) {
        return {
          error: `Live session "${sessionId}" was not found. Call list_agent_sessions to inspect active sessions.`,
        };
      }
      const clientKey = explicitClient || (CLIENT_CONFIG[exact.client] ? exact.client : "");
      if (!clientKey || !CLIENT_CONFIG[clientKey]) {
        return { error: `Direct desktop delegation is currently supported for Codex and Antigravity, not "${exact.agentId}".` };
      }
      return { client: CLIENT_CONFIG[clientKey], session: exact, message };
    }

    // 2. Filter live sessions by client + optional project.
    const candidates = live.filter((s) => {
      if (explicitClient && s.client !== explicitClient) return false;
      if (!explicitClient && !CLIENT_CONFIG[s.client]) return false;
      if (projectFilter) {
        const hay = `${s.projectName} ${s.cwd} ${s.title}`.toLowerCase();
        if (!hay.includes(projectFilter)) return false;
      }
      return true;
    });

    if (candidates.length === 1) {
      const only = candidates[0];
      return { client: CLIENT_CONFIG[only.client], session: only, message };
    }

    if (candidates.length > 1) {
      return {
        needsDisambiguation: true,
        status: "ambiguous",
        reason: "Multiple live sessions match. Ask the user which session to send the message to.",
        candidates: candidates.map((s) => ({
          sessionId: s.id,
          client: s.client,
          title: s.title,
          project: s.projectName,
          cwd: s.cwd,
          status: s.status,
        })),
      };
    }

    // 3. No matching live session: only allow targeting an explicitly named client
    // when the user explicitly confirms sending to the currently open desktop conversation.
    if (!explicitClient || !CLIENT_CONFIG[explicitClient]) {
      return {
        needsDisambiguation: true,
        status: "ambiguous",
        reason: "No active Codex or Antigravity session matched. Specify client ('codex' or 'antigravity') or open the target session first.",
        candidates: live.map((s) => ({
          sessionId: s.id,
          client: s.client,
          title: s.title,
          project: s.projectName,
          cwd: s.cwd,
          status: s.status,
        })),
      };
    }

    return {
      client: CLIENT_CONFIG[explicitClient],
      session: null,
      projectHint: args.project || "",
      message,
    };
  }

  async function prepareSendConfirmation(args = {}) {
    const resolved = resolveMessageTarget(args);
    if (resolved.error) {
      // Let execute() return the structured error cleanly.
      return null;
    }
    if (resolved.needsDisambiguation) {
      return resolved;
    }
    return {
      confirm: {
        action: "send_agent_message",
        client: resolved.client.id,
        clientLabel: resolved.client.label,
        sessionId: resolved.session?.id || null,
        sessionTitle: resolved.session?.title || null,
        project: resolved.session?.projectName || resolved.projectHint || "",
        cwd: resolved.session?.cwd || "",
        message: resolved.message,
        deliveryMethod: platform === "darwin" ? "macOS Accessibility (desktop app)" : "unsupported",
      },
    };
  }

  async function sendAgentMessage(args = {}, { signal } = {}) {
    const resolved = resolveMessageTarget(args);
    if (resolved.error) return { status: "error", error: resolved.error };
    if (resolved.needsDisambiguation) return resolved;

    if (platform !== "darwin") {
      return {
        status: "error",
        deliveryStatus: "unsupported_platform",
        executionStatus: "not_started",
        error: "Desktop Agent message delegation currently requires macOS.",
      };
    }

    const trusted = typeof isAccessibilityTrusted === "function" ? isAccessibilityTrusted() : false;
    if (!trusted) {
      try { await execFileFn("/usr/bin/open", ["-b", resolved.client.bundleId], { timeout: 5000, signal }); } catch {}
      return {
        status: "error",
        deliveryStatus: "needs_accessibility",
        executionStatus: "not_started",
        permissionRequired: "macOS Privacy & Security → Accessibility",
        client: resolved.client.id,
        sessionId: resolved.session?.id || null,
        error: "Grant Character OS Accessibility permission in macOS System Settings → Privacy & Security → Accessibility to send messages to desktop Agent apps.",
      };
    }

    // Try focusing the exact session if focusable.
    if (resolved.session && resolved.session.canFocus && typeof focusSession === "function") {
      try { await focusSession(resolved.session.id, { source: "personal-agent" }); } catch {}
    }

    const delivery = await deliverViaAccessibilityFn({
      bundleId: resolved.client.bundleId,
      processNames: resolved.client.processNames,
      message: resolved.message,
      execFileFn,
      signal,
    });

    const dispatchedAt = now();
    if (delivery.deliveryStatus === "sent") {
      const trackKey = resolved.session?.id || `client:${resolved.client.id}`;
      delegations.set(trackKey, {
        dispatchedAt,
        deliveryStatus: "sent",
        executionStatus: "pending_observation",
        messagePreview: resolved.message.slice(0, 120),
      });
      return {
        status: "ok",
        deliveryStatus: "sent",
        executionStatus: "pending_observation",
        dispatchedAt: new Date(dispatchedAt).toISOString(),
        client: resolved.client.id,
        clientLabel: resolved.client.label,
        sessionId: resolved.session?.id || null,
        sessionTitle: resolved.session?.title || null,
        project: resolved.session?.projectName || resolved.projectHint || "",
        note: "Message was submitted to the desktop composer. Task start and completion will be observed separately via live hooks/logs; call get_agent_status to check progress.",
      };
    }

    return {
      status: "error",
      deliveryStatus: delivery.deliveryStatus,
      executionStatus: "not_started",
      client: resolved.client.id,
      clientLabel: resolved.client.label,
      sessionId: resolved.session?.id || null,
      error: delivery.detail,
    };
  }

  return {
    list_agent_sessions: {
      name: "list_agent_sessions",
      description: "List active and recent local Coding Agent sessions (Codex, Antigravity, etc.) with session IDs, project folders, titles, and current status.",
      parameters: {
        type: "object",
        properties: {
          agent: { type: "string", description: "Optional client filter: 'codex', 'antigravity', or 'all'." },
          project: { type: "string", description: "Optional project name or path substring filter." },
          include_recent: { type: "boolean", description: "Include recent resumable sessions (default true)." },
        },
      },
      timeoutMs: 8_000,
      execute: listAgentSessions,
    },
    get_agent_status: {
      name: "get_agent_status",
      description: "Inspect live execution status, pending approval requests, and delegated task progress (sent vs started vs completed) for Coding Agent sessions.",
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string", description: "Optional specific session ID." },
          agent: { type: "string", description: "Optional client filter: 'codex' or 'antigravity'." },
          project: { type: "string", description: "Optional project name filter." },
        },
      },
      timeoutMs: 6_000,
      execute: getAgentStatus,
    },
    send_agent_message: {
      name: "send_agent_message",
      description: "Deliver a task prompt to an existing desktop Codex or Antigravity (Gemini App) session after explicit user confirmation. Never starts a hidden fake CLI session and never bypasses Agent approval prompts.",
      parameters: {
        type: "object",
        required: ["message"],
        properties: {
          client: { type: "string", enum: ["codex", "antigravity"], description: "Target desktop client ('codex' or 'antigravity')." },
          session_id: { type: "string", description: "Target live session ID from list_agent_sessions (preferred when known)." },
          project: { type: "string", description: "Target project name or directory hint to narrow down sessions." },
          message: { type: "string", description: "Exact instruction text to send to the Agent." },
        },
      },
      timeoutMs: 18_000,
      prepareConfirmation: prepareSendConfirmation,
      execute: sendAgentMessage,
    },
    get_quota: {
      name: "get_quota",
      description: "Read real AI service quota data across Codex Agent, Antigravity Gemini, Antigravity Claude/GPT, and Gemini Chat (honestly reporting disabled or missing windows without fabricating percentages).",
      parameters: {
        type: "object",
        properties: {
          service: {
            type: "string",
            description: "Optional filter: 'all', 'codex', 'antigravity', 'claude', or 'gemini'.",
          },
        },
      },
      timeoutMs: 5_000,
      execute: getQuota,
    },
  };
}

module.exports = {
  createAgentTools,
  normalizeClientKey,
  deliverMessageViaMacAccessibility,
};
