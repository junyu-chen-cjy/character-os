"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ANTIGRAVITY_CLIENT_ID = "antigravity";
// Standalone Antigravity desktop app — NEVER Google Gemini App (com.google.GeminiMacOS).
const ANTIGRAVITY_BUNDLE_ID = "com.google.antigravity";
const ANTIGRAVITY_APP_PATHS = Object.freeze([
  "/Applications/Antigravity.app",
  path.join(os.homedir(), "Applications/Antigravity.app"),
]);

function projectNameFromPath(cwd) {
  if (typeof cwd !== "string" || !cwd.trim()) return "";
  return path.basename(cwd.replace(/[\\/]+$/, "")) || cwd;
}

// Read-only scan of ~/.gemini/antigravity/conversations/*.db mtime for resumable metadata.
// Does NOT open locked SQLite databases or probe undocumented local servers.
function readAntigravityLocalConversationIds(homeDir = os.homedir()) {
  const dir = path.join(homeDir, ".gemini", "antigravity", "conversations");
  const out = [];
  try {
    if (!fs.existsSync(dir)) return out;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".db")) continue;
      const id = name.slice(0, -3);
      if (!id) continue;
      try {
        const stat = fs.statSync(path.join(dir, name));
        out.push({ id, updatedAt: stat.mtimeMs });
      } catch {}
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {}
  return out.slice(0, 12);
}

function createAntigravityAdapter({
  platformAdapter,
  readLocalConversationsFn = readAntigravityLocalConversationIds,
  focusHookSessionFn = null,
  now = Date.now,
} = {}) {
  function resolveAppPath() {
    return platformAdapter.findInstalledAppPath(ANTIGRAVITY_APP_PATHS);
  }

  async function discover({ hookSessions = [], pendingApprovals = [] } = {}) {
    const appPath = resolveAppPath();
    const installed = Boolean(appPath);
    const desktop = await platformAdapter.inspectDesktopApp({
      bundleId: ANTIGRAVITY_BUNDLE_ID,
      clientType: "antigravity",
    });

    const agyHooks = (hookSessions || []).filter(
      (s) => s && !s.headless && (s.agentId === "antigravity-cli" || s.agentId === "antigravity")
    );
    const approvalsFor = (sessionId, rawId) => (pendingApprovals || []).filter(
      (p) => p && (p.sessionId === sessionId || (rawId && p.sessionId === rawId))
    );

    const desktopRunning = Boolean(desktop?.running);
    const sessions = [];
    const matchedHookIds = new Set();

    const findMatchingHook = (title, projectName) => {
      const tLow = String(title || "").toLowerCase();
      const pLow = String(projectName || "").toLowerCase();
      for (const h of agyHooks) {
        if (matchedHookIds.has(h.id)) continue;
        const hTitle = String(h.displayTitle || h.sessionTitle || "").toLowerCase();
        const hProj = projectNameFromPath(h.cwd).toLowerCase();
        if (tLow && hTitle && (hTitle === tLow || hTitle.includes(tLow) || tLow.includes(hTitle))) return h;
        if (pLow && hProj && hProj === pLow) return h;
      }
      // If there's exactly one active desktop conversation and one active hook session, associate them.
      const unmatched = agyHooks.filter((h) => !matchedHookIds.has(h.id));
      if (unmatched.length === 1 && (desktop?.sidebarSessions?.length || 0) <= 1) {
        return unmatched[0];
      }
      return null;
    };

    // 1. Blank new conversation in standalone Antigravity App
    if (desktopRunning && desktop.isBlankDraft) {
      sessions.push({
        key: "antigravity:active-draft",
        sessionId: null,
        rawSessionId: null,
        clientId: ANTIGRAVITY_CLIENT_ID,
        clientName: "Antigravity",
        agentId: "antigravity-cli",
        kind: "desktop",
        isBlankDraft: true,
        isCurrentVisible: true,
        title: "",
        cwd: "",
        projectName: desktop.activeProjectName || "",
        status: "blank_draft",
        badge: "idle",
        lastEvent: "",
        updatedAt: now(),
        canFocus: true,
        canDelegate: Boolean(desktop.hasComposer),
        source: "desktop-ax",
        pendingApprovals: [],
      });
    }

    // 2. Discoverable conversations inside running standalone Antigravity App
    const desktopConvs = [];
    const seenTitles = new Set();
    if (desktopRunning && desktop.activeConversationTitle && !desktop.isBlankDraft) {
      seenTitles.add(desktop.activeConversationTitle.toLowerCase());
      desktopConvs.push({
        title: desktop.activeConversationTitle,
        projectName: desktop.activeProjectName || "",
        isCurrentVisible: true,
      });
    }
    for (const s of desktop?.sidebarSessions || []) {
      const low = s.title.toLowerCase();
      if (seenTitles.has(low)) continue;
      seenTitles.add(low);
      desktopConvs.push({
        title: s.title,
        projectName: desktop.activeProjectName || desktop.sidebarProjects?.[0] || "",
        isCurrentVisible: false,
      });
    }

    for (const conv of desktopConvs) {
      const hook = findMatchingHook(conv.title, conv.projectName);
      if (hook) matchedHookIds.add(hook.id);
      const approvals = hook ? approvalsFor(hook.id, hook.rawSessionId) : [];

      let status = "idle";
      if (approvals.length > 0) status = "awaiting_approval";
      else if (hook?.badge === "running") status = "running";
      else if (hook?.badge === "done") status = "done";
      else if (hook?.badge === "interrupted") status = "interrupted";

      sessions.push({
        key: hook?.id ? `antigravity:${hook.id}` : `antigravity:ui:${conv.title}`,
        sessionId: hook?.id || null,
        rawSessionId: hook?.rawSessionId || null,
        clientId: ANTIGRAVITY_CLIENT_ID,
        clientName: "Antigravity",
        agentId: "antigravity-cli",
        kind: "desktop",
        isBlankDraft: false,
        isCurrentVisible: conv.isCurrentVisible,
        inSidebar: true,
        title: conv.title,
        cwd: hook?.cwd || "",
        projectName: conv.projectName || projectNameFromPath(hook?.cwd || ""),
        status,
        badge: hook?.badge || "idle",
        lastEvent: hook?.lastEvent || "",
        updatedAt: Number(hook?.lastEventAt || hook?.updatedAt || now()),
        canFocus: true,
        canDelegate: Boolean(desktop.hasComposer || conv.isCurrentVisible),
        source: hook ? "desktop-ax+hook" : "desktop-ax",
        pendingApprovals: approvals.map((p) => ({ toolName: p.toolName || "", summary: p.summary || p.command || "" })),
      });
    }

    // 3. Remaining hook-reported sessions (CLI or sessions whose title isn't currently visible in sidebar)
    for (const hook of agyHooks) {
      if (matchedHookIds.has(hook.id)) continue;
      const approvals = approvalsFor(hook.id, hook.rawSessionId);
      const status = approvals.length > 0 ? "awaiting_approval" : (hook.badge || "idle");
      const isCli = Boolean(hook.canFocus);
      sessions.push({
        key: `antigravity:${hook.id}`,
        sessionId: hook.id,
        rawSessionId: hook.rawSessionId || hook.id,
        clientId: ANTIGRAVITY_CLIENT_ID,
        clientName: "Antigravity",
        agentId: "antigravity-cli",
        kind: isCli ? "cli" : "desktop",
        isBlankDraft: false,
        isCurrentVisible: false,
        inSidebar: false,
        title: hook.displayTitle || hook.sessionTitle || projectNameFromPath(hook.cwd) || hook.id,
        cwd: hook.cwd || "",
        projectName: projectNameFromPath(hook.cwd),
        status,
        badge: hook.badge || "idle",
        lastEvent: hook.lastEvent || "",
        updatedAt: Number(hook.lastEventAt || hook.updatedAt || 0),
        canFocus: Boolean(hook.canFocus || desktopRunning),
        canDelegate: Boolean(!isCli && desktopRunning),
        source: "hook",
        pendingApprovals: approvals.map((p) => ({ toolName: p.toolName || "", summary: p.summary || p.command || "" })),
      });
    }

    const localConvFiles = readLocalConversationsFn();
    const hasRunningTask = sessions.some((s) => s.status === "running");
    const hasPendingApproval = sessions.some((s) => s.status === "awaiting_approval");
    const clientStatus = !installed
      ? "not_installed"
      : !desktopRunning
        ? (hasRunningTask ? "running_task" : "offline")
        : hasPendingApproval
          ? "awaiting_approval"
          : hasRunningTask
            ? "running_task"
            : "online";

    const projects = [];
    const seenProj = new Set();
    for (const name of desktop?.sidebarProjects || []) {
      const low = name.toLowerCase();
      if (seenProj.has(low)) continue;
      seenProj.add(low);
      const hookMatch = sessions.find((s) => s.projectName.toLowerCase() === low && s.cwd);
      projects.push({ name, cwd: hookMatch?.cwd || "" });
    }
    for (const s of sessions) {
      const low = (s.projectName || "").toLowerCase();
      if (!low || seenProj.has(low)) continue;
      seenProj.add(low);
      projects.push({ name: s.projectName, cwd: s.cwd || "" });
    }

    return {
      client: {
        id: ANTIGRAVITY_CLIENT_ID,
        name: "Antigravity",
        bundleId: ANTIGRAVITY_BUNDLE_ID,
        appPath,
        installed,
        running: desktopRunning,
        pid: desktop?.pid || null,
        status: clientStatus,
        hasComposer: Boolean(desktop?.hasComposer),
        isBlankDraft: Boolean(desktop?.isBlankDraft),
        activeSessionTitle: desktop?.activeConversationTitle || "",
        activeProjectName: desktop?.activeProjectName || "",
        projects,
        sessionCount: sessions.length,
        localConversationCount: localConvFiles.length,
      },
      sessions,
    };
  }

  async function launchClient() {
    // Always launches standalone /Applications/Antigravity.app, NEVER Google Gemini App!
    return platformAdapter.launchApp({ bundleId: ANTIGRAVITY_BUNDLE_ID, appPath: resolveAppPath() });
  }

  async function focusSession(session) {
    if (!session) return launchClient();
    if (session.kind === "cli" && session.sessionId && typeof focusHookSessionFn === "function") {
      try {
        const res = await focusHookSessionFn(session.sessionId, { source: "agent-registry" });
        if (res && res.status === "ok") return res;
      } catch {}
    }
    const axRes = await platformAdapter.focusDesktopSession({
      bundleId: ANTIGRAVITY_BUNDLE_ID,
      clientType: "antigravity",
      targetTitle: session.isBlankDraft ? "" : session.title,
      isBlankDraft: Boolean(session.isBlankDraft),
    });
    if (axRes && axRes.status === "ok") return axRes;
    return launchClient();
  }

  async function deliverMessage({ session, message }) {
    return platformAdapter.deliverDesktopMessage({
      bundleId: ANTIGRAVITY_BUNDLE_ID,
      clientType: "antigravity",
      targetTitle: session?.isBlankDraft ? "" : (session?.title || ""),
      isBlankDraft: Boolean(session?.isBlankDraft),
      message,
    });
  }

  return {
    id: ANTIGRAVITY_CLIENT_ID,
    name: "Antigravity",
    bundleId: ANTIGRAVITY_BUNDLE_ID,
    discover,
    launchClient,
    focusSession,
    deliverMessage,
  };
}

module.exports = {
  ANTIGRAVITY_CLIENT_ID,
  ANTIGRAVITY_BUNDLE_ID,
  ANTIGRAVITY_APP_PATHS,
  readAntigravityLocalConversationIds,
  createAntigravityAdapter,
};
