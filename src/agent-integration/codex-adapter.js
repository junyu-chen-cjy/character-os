"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { findCodexBinary } = require("../codex-app-server-quota");

const CODEX_CLIENT_ID = "codex";
const CODEX_BUNDLE_ID = "com.openai.codex";
const CODEX_APP_PATHS = Object.freeze([
  "/Applications/Codex.app",
  "/Applications/ChatGPT.app",
  path.join(os.homedir(), "Applications/Codex.app"),
  path.join(os.homedir(), "Applications/ChatGPT.app"),
]);
const THREAD_LIST_CACHE_MS = 15_000;

function projectNameFromPath(cwd) {
  if (typeof cwd !== "string" || !cwd.trim()) return "";
  return path.basename(cwd.replace(/[\\/]+$/, "")) || cwd;
}

function readCodexLocalProjects(homeDir = os.homedir()) {
  const out = [];
  try {
    const filePath = path.join(homeDir, ".codex", ".codex-global-state.json");
    if (!fs.existsSync(filePath)) return out;
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const localProjects = raw && raw["local-projects"];
    if (localProjects && typeof localProjects === "object") {
      for (const proj of Object.values(localProjects)) {
        if (!proj || typeof proj !== "object") continue;
        const cwd = Array.isArray(proj.rootPaths) && proj.rootPaths[0] ? String(proj.rootPaths[0]) : "";
        if (!cwd && !proj.name) continue;
        out.push({
          id: proj.id || cwd || proj.name,
          name: proj.name || projectNameFromPath(cwd),
          cwd,
        });
      }
    }
  } catch {}
  return out;
}

// Queries official `codex app-server` `thread/list` (read-only, zero inference tokens).
function queryCodexAppServerThreads({
  binaryPath,
  limit = 20,
  timeoutMs = 7000,
  spawnFn = spawn,
} = {}) {
  const bin = binaryPath || findCodexBinary();
  if (!bin) return Promise.resolve({ status: "cli-unavailable", threads: [] });

  return new Promise((resolve) => {
    let settled = false;
    let buf = "";
    let child;
    const finish = (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child?.stdin?.end(); } catch {}
      try { if (child && !child.killed) child.kill("SIGTERM"); } catch {}
      resolve(res);
    };
    const timer = setTimeout(() => finish({ status: "timeout", threads: [] }), timeoutMs);
    if (typeof timer.unref === "function") timer.unref();

    try {
      child = spawnFn(bin, ["app-server"], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: { ...process.env, CI: "true", NO_COLOR: "1" },
      });
    } catch {
      finish({ status: "cli-unavailable", threads: [] });
      return;
    }

    const handleLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) return;
      let msg;
      try { msg = JSON.parse(trimmed); } catch { return; }
      if (msg.id === 1) {
        if (msg.error) { finish({ status: "error", threads: [] }); return; }
        try {
          child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
          child.stdin.write(JSON.stringify({
            method: "thread/list",
            id: 2,
            params: { limit, sortKey: "updated_at" },
          }) + "\n");
        } catch {
          finish({ status: "error", threads: [] });
        }
        return;
      }
      if (msg.id === 2) {
        const list = Array.isArray(msg.result?.data) ? msg.result.data : [];
        const threads = list
          .filter((t) => t && typeof t.id === "string")
          .map((t) => ({
            id: t.id,
            title: String(t.name || t.preview || "").replace(/\s+/g, " ").trim().slice(0, 120),
            cwd: typeof t.cwd === "string" ? t.cwd : "",
            projectName: projectNameFromPath(t.cwd),
            originator: String(t.originator || ""),
            kind: /desktop/i.test(String(t.originator || "")) || String(t.source || "") === "vscode"
              ? "desktop"
              : "cli",
            model: typeof t.model === "string" ? t.model : "",
            updatedAt: Number(t.updatedAt) > 0 ? (Number(t.updatedAt) < 1e12 ? Number(t.updatedAt) * 1000 : Number(t.updatedAt)) : 0,
            loadedStatus: t.status?.type || "notLoaded",
          }));
        finish({ status: "ok", threads });
      }
    };

    child.stdout?.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      if (buf.length > 1024 * 1024) { finish({ status: "error", threads: [] }); return; }
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() || "";
      for (const line of lines) handleLine(line);
    });
    child.on("error", () => finish({ status: "cli-unavailable", threads: [] }));
    child.on("exit", () => {
      if (buf.trim()) handleLine(buf);
      finish({ status: "error", threads: [] });
    });

    try {
      child.stdin.write(JSON.stringify({
        method: "initialize",
        id: 1,
        params: { clientInfo: { name: "character-os", version: "1.0.0" } },
      }) + "\n");
    } catch {
      finish({ status: "error", threads: [] });
    }
  });
}

function createCodexAdapter({
  platformAdapter,
  queryThreadsFn = queryCodexAppServerThreads,
  readLocalProjectsFn = readCodexLocalProjects,
  focusHookSessionFn = null,
  now = Date.now,
} = {}) {
  let cachedThreads = [];
  let cachedThreadsAt = 0;

  function resolveAppPath() {
    return platformAdapter.findInstalledAppPath(CODEX_APP_PATHS);
  }

  async function getThreads({ force = false } = {}) {
    const current = now();
    if (!force && cachedThreads.length && current - cachedThreadsAt < THREAD_LIST_CACHE_MS) {
      return cachedThreads;
    }
    const res = await queryThreadsFn({ limit: 20 });
    if (res && res.status === "ok" && Array.isArray(res.threads)) {
      cachedThreads = res.threads;
      cachedThreadsAt = current;
    }
    return cachedThreads;
  }

  async function discover({ hookSessions = [], pendingApprovals = [], force = false } = {}) {
    const appPath = resolveAppPath();
    const installed = Boolean(appPath || findCodexBinary());
    const [desktop, threads] = await Promise.all([
      platformAdapter.inspectDesktopApp({ bundleId: CODEX_BUNDLE_ID, clientType: "codex" }),
      getThreads({ force }),
    ]);

    const localProjects = readLocalProjectsFn();
    const projectByName = new Map();
    for (const p of localProjects) {
      if (p.name) projectByName.set(p.name.toLowerCase(), p);
      if (p.cwd) projectByName.set(projectNameFromPath(p.cwd).toLowerCase(), p);
    }

    const stripCodexPrefix = (id) => String(id || "").replace(/^codex:/i, "");
    const codexHooks = (hookSessions || []).filter((s) => s && !s.headless && s.agentId === "codex");
    const hookById = new Map();
    for (const h of codexHooks) {
      if (h.id) {
        hookById.set(h.id, h);
        hookById.set(stripCodexPrefix(h.id), h);
      }
      if (h.rawSessionId) {
        hookById.set(h.rawSessionId, h);
        hookById.set(stripCodexPrefix(h.rawSessionId), h);
      }
    }

    const approvalsFor = (sessionId, rawId) => {
      const bareA = stripCodexPrefix(sessionId);
      const bareB = stripCodexPrefix(rawId);
      return (pendingApprovals || []).filter((p) => {
        if (!p) return false;
        const pBare = stripCodexPrefix(p.sessionId);
        return p.sessionId === sessionId || (rawId && p.sessionId === rawId) || (bareA && pBare === bareA) || (bareB && pBare === bareB);
      });
    };

    const sessions = [];
    const matchedHookIds = new Set();
    const desktopRunning = Boolean(desktop?.running);

    // 1. Explicit blank draft representation (NEVER forge a formal session ID!)
    if (desktopRunning && desktop.isBlankDraft) {
      const matchedProj = desktop.activeProjectName
        ? projectByName.get(desktop.activeProjectName.toLowerCase())
        : null;
      sessions.push({
        key: "codex:active-draft",
        sessionId: null,
        rawSessionId: null,
        clientId: CODEX_CLIENT_ID,
        clientName: "Codex",
        agentId: "codex",
        kind: "desktop",
        isBlankDraft: true,
        isCurrentVisible: true,
        title: "",
        cwd: matchedProj?.cwd || "",
        projectName: desktop.activeProjectName || matchedProj?.name || "",
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

    // 2. Merge official app-server threads with live hook status & desktop sidebar visibility
    const activeTitleLower = String(desktop?.activeConversationTitle || "").trim().toLowerCase();
    const sidebarSet = new Set((desktop?.sidebarSessions || []).map((s) => s.title.toLowerCase()));

    for (const thread of threads) {
      const bareThreadId = stripCodexPrefix(thread.id);
      const hook = hookById.get(bareThreadId) || hookById.get(thread.id) || null;
      if (hook) {
        matchedHookIds.add(hook.id);
        matchedHookIds.add(stripCodexPrefix(hook.id));
        if (hook.rawSessionId) {
          matchedHookIds.add(hook.rawSessionId);
          matchedHookIds.add(stripCodexPrefix(hook.rawSessionId));
        }
      }
      const approvals = hook ? approvalsFor(hook.id, hook.rawSessionId) : [];
      const isVisible = Boolean(
        desktopRunning
        && !desktop.isBlankDraft
        && activeTitleLower
        && thread.title
        && (thread.title.toLowerCase() === activeTitleLower
          || thread.title.toLowerCase().includes(activeTitleLower)
          || activeTitleLower.includes(thread.title.toLowerCase()))
      );
      const inSidebar = Boolean(desktopRunning && thread.title && sidebarSet.has(thread.title.toLowerCase()));

      let status = "resumable";
      if (approvals.length > 0) status = "awaiting_approval";
      else if (hook?.badge === "running" || thread.loadedStatus === "active" || (isVisible && desktop?.isGenerating)) status = "running";
      else if (hook?.badge === "done") status = "done";
      else if (hook?.badge === "interrupted") status = "interrupted";
      else if (isVisible || inSidebar || hook) status = "idle";

      sessions.push({
        key: `codex:${thread.id}`,
        sessionId: hook?.id || thread.id,
        rawSessionId: thread.id,
        clientId: CODEX_CLIENT_ID,
        clientName: "Codex",
        agentId: "codex",
        kind: thread.kind,
        isBlankDraft: false,
        isCurrentVisible: isVisible,
        inSidebar,
        title: hook?.displayTitle || thread.title || thread.projectName || thread.id,
        cwd: hook?.cwd || thread.cwd,
        projectName: projectNameFromPath(hook?.cwd || thread.cwd) || thread.projectName,
        status,
        badge: hook?.badge || (status === "running" ? "running" : status === "done" ? "done" : "idle"),
        lastEvent: hook?.lastEvent || "",
        updatedAt: Math.max(Number(hook?.lastEventAt || 0), Number(thread.updatedAt || 0)),
        canFocus: Boolean(hook?.canFocus || desktopRunning || thread.kind === "desktop"),
        canDelegate: Boolean(desktopRunning && thread.kind === "desktop" && (isVisible || inSidebar)),
        source: hook ? "app-server+hook" : "app-server",
        pendingApprovals: approvals.map((p) => ({ toolName: p.toolName || "", summary: p.summary || p.command || "" })),
      });
    }

    // 3. Include any live hook/JSONL sessions not present in thread/list (e.g., fresh CLI sessions)
    for (const hook of codexHooks) {
      const bareHookId = stripCodexPrefix(hook.rawSessionId || hook.id);
      if (matchedHookIds.has(hook.id) || matchedHookIds.has(bareHookId) || (hook.rawSessionId && matchedHookIds.has(hook.rawSessionId))) continue;
      const approvals = approvalsFor(hook.id, hook.rawSessionId);
      const status = approvals.length > 0 ? "awaiting_approval" : (hook.badge || "idle");
      sessions.push({
        key: `codex:${bareHookId}`,
        sessionId: bareHookId,
        rawSessionId: bareHookId,
        clientId: CODEX_CLIENT_ID,
        clientName: "Codex",
        agentId: "codex",
        kind: hook.canFocus ? "cli" : "desktop",
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
        canDelegate: Boolean(desktopRunning),
        source: "hook",
        pendingApprovals: approvals.map((p) => ({ toolName: p.toolName || "", summary: p.summary || p.command || "" })),
      });
    }

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

    const mergedProjects = [];
    const seenProj = new Set();
    for (const name of desktop?.sidebarProjects || []) {
      const low = name.toLowerCase();
      if (seenProj.has(low)) continue;
      seenProj.add(low);
      const known = projectByName.get(low);
      mergedProjects.push({ name, cwd: known?.cwd || "" });
    }
    for (const p of localProjects) {
      const low = (p.name || "").toLowerCase();
      if (!low || seenProj.has(low)) continue;
      seenProj.add(low);
      mergedProjects.push({ name: p.name, cwd: p.cwd });
    }

    return {
      client: {
        id: CODEX_CLIENT_ID,
        name: "Codex",
        bundleId: CODEX_BUNDLE_ID,
        appPath,
        installed,
        running: desktopRunning,
        pid: desktop?.pid || null,
        status: clientStatus,
        hasComposer: Boolean(desktop?.hasComposer),
        isBlankDraft: Boolean(desktop?.isBlankDraft),
        activeSessionTitle: desktop?.activeConversationTitle || "",
        activeProjectName: desktop?.activeProjectName || "",
        projects: mergedProjects,
        sessionCount: sessions.length,
      },
      sessions,
    };
  }

  async function launchClient() {
    return platformAdapter.launchApp({ bundleId: CODEX_BUNDLE_ID, appPath: resolveAppPath() });
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
      bundleId: CODEX_BUNDLE_ID,
      clientType: "codex",
      targetTitle: session.isBlankDraft ? "" : session.title,
      isBlankDraft: Boolean(session.isBlankDraft),
    });
    if (axRes && axRes.status === "ok") return axRes;
    if (session.rawSessionId && !session.isBlankDraft) {
      const urlRes = await platformAdapter.openUrl(`codex://threads/${encodeURIComponent(session.rawSessionId)}`);
      if (urlRes && urlRes.status === "ok") return urlRes;
    }
    return launchClient();
  }

  async function deliverMessage({ session, message }) {
    return platformAdapter.deliverDesktopMessage({
      bundleId: CODEX_BUNDLE_ID,
      clientType: "codex",
      targetTitle: session?.isBlankDraft ? "" : (session?.title || ""),
      isBlankDraft: Boolean(session?.isBlankDraft),
      message,
    });
  }

  return {
    id: CODEX_CLIENT_ID,
    name: "Codex",
    bundleId: CODEX_BUNDLE_ID,
    discover,
    launchClient,
    focusSession,
    deliverMessage,
  };
}

module.exports = {
  CODEX_CLIENT_ID,
  CODEX_BUNDLE_ID,
  CODEX_APP_PATHS,
  queryCodexAppServerThreads,
  readCodexLocalProjects,
  createCodexAdapter,
};
