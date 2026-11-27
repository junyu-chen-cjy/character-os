"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { resolveMacAppBundleFromExecPath, createPlatformAdapter } = require("../src/agent-integration/platform-adapter");
const { CODEX_BUNDLE_ID, createCodexAdapter } = require("../src/agent-integration/codex-adapter");
const { ANTIGRAVITY_BUNDLE_ID, createAntigravityAdapter } = require("../src/agent-integration/antigravity-adapter");
const { createAgentRegistry } = require("../src/agent-integration/agent-registry");

function makeStubPlatformAdapter({
  trusted = true,
  installedPaths = {},
  desktopByBundle = {},
  deliverResult = { status: "ok", deliveryStatus: "delivered", verifiedInConversation: true, composerCleared: true },
  focusResult = { status: "ok", focused: true },
  launchCalls = [],
} = {}) {
  return {
    platform: "darwin",
    isMac: true,
    getAccessibilityStatus: () => ({
      platform: "darwin",
      supported: true,
      trusted,
      processPath: "/Applications/Character OS.app/Contents/MacOS/Character OS",
      appBundlePath: "/Applications/Character OS.app",
      appDisplayName: "Character OS",
      isDevElectron: false,
      settingsUrl: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    }),
    openAccessibilitySettings: async () => ({ status: "ok" }),
    revealAuthorizedAppInFinder: () => ({ status: "ok" }),
    findInstalledAppPath: (paths) => paths.find((p) => installedPaths[p]) || null,
    launchApp: async (opts) => {
      launchCalls.push(opts);
      return { status: "ok", ...opts };
    },
    openUrl: async (url) => ({ status: "ok", url }),
    inspectDesktopApp: async ({ bundleId }) => desktopByBundle[bundleId] || { status: "ok", running: false },
    focusDesktopSession: async (opts) => ({ ...focusResult, ...opts }),
    deliverDesktopMessage: async (opts) => ({ ...deliverResult, ...opts }),
  };
}

describe("Agent Integration v2: Platform, Adapters & Unified Registry", () => {
  it("resolves macOS .app bundle identity accurately for dev Electron and packaged builds", () => {
    const dev = resolveMacAppBundleFromExecPath(
      "/Users/cjy/projects/character-os/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
    );
    assert.equal(dev.appBundlePath, "/Users/cjy/projects/character-os/node_modules/electron/dist/Electron.app");
    assert.equal(dev.appDisplayName, "Electron");
    assert.equal(dev.isDevElectron, true);

    const pkg = resolveMacAppBundleFromExecPath("/Applications/Character OS.app/Contents/MacOS/Character OS");
    assert.equal(pkg.appBundlePath, "/Applications/Character OS.app");
    assert.equal(pkg.appDisplayName, "Character OS");
    assert.equal(pkg.isDevElectron, false);
  });

  it("discovers running idle Codex Desktop with explicit blank draft (never forging a session ID) and app-server threads", async () => {
    const now = Date.parse("2026-11-28T03:00:00Z");
    const platformAdapter = makeStubPlatformAdapter({
      installedPaths: { "/Applications/ChatGPT.app": true },
      desktopByBundle: {
        [CODEX_BUNDLE_ID]: {
          status: "ok",
          running: true,
          pid: 86011,
          isBlankDraft: true,
          hasComposer: true,
          activeConversationTitle: "",
          activeProjectName: "character-os",
          sidebarProjects: ["character-os", "alohamini"],
          sidebarSessions: [{ title: "初始化 character-os 桌宠仓库", label: "初始化 character-os 桌宠仓库" }],
        },
      },
    });

    const codex = createCodexAdapter({
      platformAdapter,
      queryThreadsFn: async () => ({
        status: "ok",
        threads: [
          {
            id: "019d63f1-0468-7a21-b867-5d0e1a6fc0cc",
            title: "初始化 character-os 桌宠仓库",
            cwd: "/Users/cjy/projects/character-os",
            projectName: "character-os",
            originator: "Codex Desktop",
            kind: "desktop",
            updatedAt: now - 60_000,
          },
          {
            id: "cli-thread-1",
            title: "CLI quick task",
            cwd: "/Users/cjy/projects/alohamini",
            projectName: "alohamini",
            originator: "codex-cli",
            kind: "cli",
            updatedAt: now - 120_000,
          },
        ],
      }),
      readLocalProjectsFn: () => [
        { id: "p1", name: "character-os", cwd: "/Users/cjy/projects/character-os" },
      ],
      now: () => now,
    });

    const res = await codex.discover({ hookSessions: [], pendingApprovals: [], force: true });
    assert.equal(res.client.id, "codex");
    assert.equal(res.client.bundleId, "com.openai.codex");
    assert.equal(res.client.running, true);
    assert.equal(res.client.status, "online");
    assert.equal(res.client.isBlankDraft, true);
    assert.equal(res.client.hasComposer, true);

    const draft = res.sessions.find((s) => s.isBlankDraft);
    assert.ok(draft, "blank draft must be explicitly represented");
    assert.equal(draft.key, "codex:active-draft");
    assert.equal(draft.sessionId, null, "blank draft MUST NOT forge a formal session ID");
    assert.equal(draft.isCurrentVisible, true);
    assert.equal(draft.projectName, "character-os");
    assert.equal(draft.cwd, "/Users/cjy/projects/character-os");
    assert.equal(draft.canDelegate, true);

    const desktopThread = res.sessions.find((s) => s.rawSessionId === "019d63f1-0468-7a21-b867-5d0e1a6fc0cc");
    assert.equal(desktopThread.kind, "desktop");
    assert.equal(desktopThread.status, "idle");
    assert.equal(desktopThread.inSidebar, true);

    const cliThread = res.sessions.find((s) => s.rawSessionId === "cli-thread-1");
    assert.equal(cliThread.kind, "cli");
    assert.equal(cliThread.status, "resumable");
  });

  it("targets standalone Antigravity App (com.google.antigravity) strictly and NEVER launches Google Gemini App", async () => {
    const launchCalls = [];
    const platformAdapter = makeStubPlatformAdapter({
      installedPaths: { "/Applications/Antigravity.app": true },
      desktopByBundle: {
        [ANTIGRAVITY_BUNDLE_ID]: {
          status: "ok",
          running: true,
          pid: 37274,
          isBlankDraft: false,
          hasComposer: true,
          activeConversationTitle: "Character OS UI/UX Redesign",
          activeProjectName: "character-os",
          sidebarProjects: ["character-os"],
          sidebarSessions: [
            { title: "Character OS UI/UX Redesign", label: "Conversation: Character OS UI/UX Redesign" },
          ],
        },
      },
      launchCalls,
    });

    const agy = createAntigravityAdapter({
      platformAdapter,
      readLocalConversationsFn: () => [{ id: "conv-1", updatedAt: Date.now() }],
    });

    assert.equal(agy.bundleId, "com.google.antigravity");
    assert.notEqual(agy.bundleId, "com.google.GeminiMacOS");

    const res = await agy.discover({ hookSessions: [], pendingApprovals: [] });
    assert.equal(res.client.running, true);
    assert.equal(res.client.status, "online");
    assert.equal(res.client.bundleId, "com.google.antigravity");
    assert.equal(res.sessions.length, 1);
    assert.equal(res.sessions[0].title, "Character OS UI/UX Redesign");
    assert.equal(res.sessions[0].projectName, "character-os");
    assert.equal(res.sessions[0].isCurrentVisible, true);
    assert.equal(res.sessions[0].kind, "desktop");

    await agy.launchClient();
    assert.equal(launchCalls.length, 1);
    assert.equal(launchCalls[0].bundleId, "com.google.antigravity");
    assert.equal(launchCalls[0].appPath, "/Applications/Antigravity.app");
  });

  it("enforces disambiguation, Accessibility checks, and strict delegation lifecycle (located -> confirmed -> delivered -> started -> completed)", async () => {
    let clock = Date.parse("2026-11-28T03:00:00Z");
    const hookSessions = [
      {
        id: "agy-hook-1",
        rawSessionId: "agy-hook-1",
        agentId: "antigravity-cli",
        displayTitle: "Character OS UI/UX Redesign",
        cwd: "/Users/cjy/projects/character-os",
        badge: "idle",
        lastEvent: "Stop",
        lastEventAt: clock - 5000,
        canFocus: false,
      },
    ];
    let pendingApprovals = [];
    let trusted = false;

    const platformAdapter = makeStubPlatformAdapter({
      trusted: true,
      installedPaths: {
        "/Applications/ChatGPT.app": true,
        "/Applications/Antigravity.app": true,
      },
      desktopByBundle: {
        [CODEX_BUNDLE_ID]: {
          status: "ok",
          running: true,
          pid: 86011,
          isBlankDraft: true,
          hasComposer: true,
          activeProjectName: "character-os",
          sidebarProjects: ["character-os"],
          sidebarSessions: [{ title: "Existing thread", label: "Existing thread" }],
        },
        [ANTIGRAVITY_BUNDLE_ID]: {
          status: "ok",
          running: true,
          pid: 37274,
          isBlankDraft: false,
          hasComposer: true,
          activeConversationTitle: "Character OS UI/UX Redesign",
          activeProjectName: "character-os",
          sidebarProjects: ["character-os"],
          sidebarSessions: [{ title: "Character OS UI/UX Redesign", label: "Conversation: Character OS UI/UX Redesign" }],
        },
      },
    });
    platformAdapter.getAccessibilityStatus = () => ({
      platform: "darwin",
      supported: true,
      trusted,
      appBundlePath: "/Applications/Character OS.app",
      appDisplayName: "Character OS",
    });

    const codex = createCodexAdapter({
      platformAdapter,
      queryThreadsFn: async () => ({
        status: "ok",
        threads: [
          {
            id: "codex-thread-1",
            title: "Existing thread",
            cwd: "/Users/cjy/projects/character-os",
            projectName: "character-os",
            originator: "Codex Desktop",
            kind: "desktop",
            updatedAt: clock - 10_000,
          },
        ],
      }),
      readLocalProjectsFn: () => [{ id: "p1", name: "character-os", cwd: "/Users/cjy/projects/character-os" }],
      now: () => clock,
    });
    const agy = createAntigravityAdapter({
      platformAdapter,
      readLocalConversationsFn: () => [],
      now: () => clock,
    });

    const registry = createAgentRegistry({
      platformAdapter,
      adapters: [codex, agy],
      getHookSnapshot: () => ({ sessions: hookSessions }),
      getPendingPermissions: () => pendingApprovals,
      now: () => clock,
    });

    const snap = await registry.refresh({ force: true });
    assert.equal(snap.clients.length, 2);
    assert.equal(snap.clients.every((c) => c.running && c.status === "online"), true);

    // 1. Multiple Codex desktop candidates (blank draft + existing thread) must disambiguate
    const ambig = await registry.prepareDelegation({ client: "codex", message: "Ping" });
    assert.equal(ambig.needsDisambiguation, true);
    assert.equal(ambig.candidates.length, 2);

    // 2. Single Antigravity desktop session produces confirmation with stage = located
    const prep = await registry.prepareDelegation({ client: "antigravity", message: "Run check" });
    assert.ok(prep.confirm);
    assert.equal(prep.confirm.bundleId, "com.google.antigravity");
    assert.equal(prep.confirm.sessionKey, "antigravity:agy-hook-1");

    // 3. Untrusted Accessibility blocks delivery honestly without faking success
    const blocked = await registry.delegateMessage({
      client: "antigravity",
      sessionKey: "antigravity:agy-hook-1",
      message: "Run check",
    });
    assert.equal(blocked.status, "error");
    assert.equal(blocked.stage, "failed");
    assert.equal(blocked.deliveryStatus, "needs_accessibility");

    // 4. Once trusted, delivery enters stage = delivered (NOT started/completed!)
    trusted = true;
    const delivered = await registry.delegateMessage({
      client: "antigravity",
      sessionKey: "antigravity:agy-hook-1",
      message: "Run check",
    });
    assert.equal(delivered.status, "ok");
    assert.equal(delivered.stage, "delivered");
    assert.equal(delivered.executionStatus, "pending_observation");
    assert.equal(delivered.verifiedInConversation, true);

    // 5. Real hook observes running -> stage transitions to started
    clock += 2000;
    hookSessions[0].badge = "running";
    hookSessions[0].lastEventAt = clock;
    const snapStarted = await registry.refresh({ force: true });
    assert.equal(snapStarted.sessions.find((s) => s.key === "antigravity:agy-hook-1").lastDelegation.stage, "started");

    // 6. Real pending approval -> stage transitions to awaiting_approval
    pendingApprovals = [{ sessionId: "agy-hook-1", toolName: "Bash", command: "npm test" }];
    const snapApproval = await registry.refresh({ force: true });
    assert.equal(snapApproval.sessions.find((s) => s.key === "antigravity:agy-hook-1").lastDelegation.stage, "awaiting_approval");

    // 7. Real hook observes done -> stage transitions to completed
    clock += 5000;
    pendingApprovals = [];
    hookSessions[0].badge = "done";
    hookSessions[0].lastEventAt = clock;
    const snapDone = await registry.refresh({ force: true });
    assert.equal(snapDone.sessions.find((s) => s.key === "antigravity:agy-hook-1").lastDelegation.stage, "completed");
  });

  it("refuses delegation cleanly when the target desktop app is offline", async () => {
    const platformAdapter = makeStubPlatformAdapter({
      installedPaths: { "/Applications/ChatGPT.app": true },
      desktopByBundle: {
        [CODEX_BUNDLE_ID]: { status: "ok", running: false },
      },
    });
    const codex = createCodexAdapter({
      platformAdapter,
      queryThreadsFn: async () => ({ status: "ok", threads: [] }),
      readLocalProjectsFn: () => [],
    });
    const registry = createAgentRegistry({ platformAdapter, adapters: [codex] });
    const res = await registry.delegateMessage({ client: "codex", message: "Hello" });
    assert.equal(res.status, "error");
    assert.equal(res.stage, "failed");
    assert.match(res.error, /offline/i);
  });

  it("normalizes codex: hook IDs without double prefix and promotes blank-draft delegations through started -> completed", async () => {
    let clock = Date.parse("2026-11-28T03:43:00Z");
    let isBlank = true;
    let threads = [];
    let hookSessions = [];

    const platformAdapter = makeStubPlatformAdapter({
      trusted: true,
      installedPaths: { "/Applications/ChatGPT.app": true },
      desktopByBundle: {},
    });
    platformAdapter.inspectDesktopApp = async () => ({
      status: "ok",
      running: true,
      pid: 86011,
      isBlankDraft: isBlank,
      hasComposer: true,
      activeConversationTitle: isBlank ? "" : "确认连通性测试",
      sidebarProjects: ["character-os"],
      sidebarSessions: isBlank ? [] : [{ title: "确认连通性测试", label: "确认连通性测试" }],
    });

    const codex = createCodexAdapter({
      platformAdapter,
      queryThreadsFn: async () => ({ status: "ok", threads }),
      readLocalProjectsFn: () => [],
      now: () => clock,
    });
    const registry = createAgentRegistry({
      platformAdapter,
      adapters: [codex],
      getHookSnapshot: () => ({ sessions: hookSessions }),
      now: () => clock,
    });

    await registry.refresh({ force: true });
    const delivered = await registry.delegateMessage({
      client: "codex",
      sessionKey: "codex:active-draft",
      message: "[Character OS 连通性测试] 请仅回复收到，不执行任何任务。",
    });
    assert.equal(delivered.status, "ok");
    assert.equal(delivered.stage, "delivered");

    // Codex turns blank draft into a real thread and emits prefixed hook id "codex:<uuid>"
    clock += 1500;
    isBlank = false;
    threads = [{
      id: "01a21e88-a9d3-7043-9c8e-3fe140bda814",
      title: "确认连通性测试",
      cwd: "",
      projectName: "",
      originator: "Codex Desktop",
      kind: "desktop",
      updatedAt: clock,
      loadedStatus: "active",
    }];
    hookSessions = [{
      id: "codex:01a21e88-a9d3-7043-9c8e-3fe140bda814",
      rawSessionId: "codex:01a21e88-a9d3-7043-9c8e-3fe140bda814",
      agentId: "codex",
      badge: "running",
      lastEvent: "UserPromptSubmit",
      lastEventAt: clock,
      headless: false,
    }];

    const runningSnap = await registry.refresh({ force: true });
    const promoted = runningSnap.sessions.find((s) => s.key === "codex:01a21e88-a9d3-7043-9c8e-3fe140bda814");
    assert.ok(promoted, "must merge hook + thread under single non-duplicated key");
    assert.equal(runningSnap.sessions.some((s) => s.key.startsWith("codex:codex:")), false);
    assert.equal(promoted.lastDelegation.stage, "started");

    // Codex finishes replying "收到"
    clock += 4000;
    threads[0].loadedStatus = "idle";
    hookSessions[0].badge = "done";
    hookSessions[0].lastEvent = "Stop";
    hookSessions[0].lastEventAt = clock;

    const doneSnap = await registry.refresh({ force: true });
    const finished = doneSnap.sessions.find((s) => s.key === "codex:01a21e88-a9d3-7043-9c8e-3fe140bda814");
    assert.equal(finished.lastDelegation.stage, "completed");
  });

  it("exports createPlatformAdapter cleanly on non-darwin platforms without throwing", () => {
    const p = createPlatformAdapter({ platform: "linux" });
    const ax = p.getAccessibilityStatus();
    assert.equal(ax.supported, false);
    assert.equal(ax.trusted, false);
  });
});
