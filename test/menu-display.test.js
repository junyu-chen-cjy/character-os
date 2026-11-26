const assert = require("node:assert");
const Module = require("node:module");
const { describe, it } = require("node:test");

const MENU_MODULE_PATH = require.resolve("../src/menu");

function loadMenuWithElectron(fakeElectron, fakeTaskbar = null, platform = "win32", fakeExecFile = null) {
  delete require.cache[MENU_MODULE_PATH];
  const originalLoad = Module._load;
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { ...originalPlatform, value: platform });
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "electron") return fakeElectron;
    if (fakeTaskbar && request === "./taskbar") return fakeTaskbar;
    if (request === "node:child_process" && fakeExecFile) return { execFile: fakeExecFile };
    return originalLoad.apply(this, arguments);
  };
  try {
    return require("../src/menu");
  } finally {
    Module._load = originalLoad;
    Object.defineProperty(process, "platform", originalPlatform);
  }
}

function buildBaseCtx(overrides = {}) {
  const ctx = {
    win: { isDestroyed: () => false },
    sessions: new Map(),
    currentSize: "P:15",
    doNotDisturb: false,
    lang: "en",
    showTray: true,
    showDock: true,
    openAtLogin: false,
    bubbleFollowPet: false,
    hideBubbles: false,
    soundMuted: false,
    menuOpen: false,
    tray: null,
    contextMenuOwner: null,
    contextMenu: null,
    isQuitting: false,
    getMiniMode: () => false,
    getMiniTransitioning: () => false,
    getDisableMiniMode: () => false,
    getActiveThemeCapabilities: () => ({ miniMode: true }),
    openDashboard: () => {},
    openSettingsWindow: () => {},
    togglePetVisibility: () => {},
    bringPetToPrimaryDisplay: () => {},
    enableDoNotDisturb: () => {},
    disableDoNotDisturb: () => {},
    enterMiniViaMenu: () => {},
    exitMiniMode: () => {},
    miniHandleResize: () => false,
    getPetWindowBounds: () => ({ x: 10, y: 20, width: 120, height: 120 }),
    applyPetWindowBounds: () => {},
    getCurrentPixelSize: () => ({ width: 200, height: 200 }),
    isProportionalMode: () => true,
    repositionBubbles: () => {},
    syncHitWin: () => {},
    flushRuntimeStateToPrefs: () => {},
    reapplyMacVisibility: () => {},
    clampToScreenVisual: (x, y) => ({ x, y }),
    ...overrides,
  };
  return ctx;
}

describe("menu taskbar recovery", () => {
  it("reasserts taskbar-hidden state for the context-menu owner and restored pet window", () => {
    let ownerWindow = null;
    const fakeElectron = {
      app: { quit: () => {}, setActivationPolicy: () => {}, dock: { show: () => {}, hide: () => {} } },
      BrowserWindow: function BrowserWindow() {
        ownerWindow = {
          isDestroyed: () => false,
          loadURL: () => {},
          on: () => {},
          setBounds: () => {},
          show: () => {},
          focus: () => {},
          hide: () => {},
        };
        return ownerWindow;
      },
      Menu: {
        buildFromTemplate(template) {
          return { template };
        },
      },
      Tray: function Tray() {},
      nativeImage: {
        createFromPath() {
          return {
            resize() { return this; },
            setTemplateImage() {},
          };
        },
      },
      screen: {
        getAllDisplays: () => [],
        getCursorScreenPoint: () => ({ x: 0, y: 0 }),
        getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1280, height: 720 } }),
      },
    };
    const keepCalls = [];
    const initMenu = loadMenuWithElectron(fakeElectron, {
      keepOutOfTaskbar: (win) => keepCalls.push(win),
    });

    let restoredPet = false;
    const ctx = buildBaseCtx({
      win: {
        isDestroyed: () => false,
        showInactive: () => { restoredPet = true; },
        setAlwaysOnTop: () => {},
      },
    });

    initMenu(ctx).popupMenuAt({
      popup({ callback }) {
        callback();
      },
    });

    assert.strictEqual(restoredPet, true);
    assert.deepStrictEqual(keepCalls, [ownerWindow, ctx.win]);
  });
});

describe("menu dashboard action", () => {
  it("adds a context menu item that opens the Dashboard", () => {
    const fakeElectron = {
      app: { quit: () => {}, setActivationPolicy: () => {}, dock: { show: () => {}, hide: () => {} } },
      BrowserWindow: function BrowserWindow() {},
      Menu: {
        buildFromTemplate(template) {
          return { template };
        },
      },
      Tray: function Tray() {},
      nativeImage: {
        createFromPath() {
          return {
            resize() { return this; },
            setTemplateImage() {},
          };
        },
      },
      screen: {
        getAllDisplays: () => [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }],
        getCursorScreenPoint: () => ({ x: 0, y: 0 }),
        getDisplayNearestPoint: () => ({ id: 1 }),
      },
    };
    const initMenu = loadMenuWithElectron(fakeElectron);

    let called = 0;
    const ctx = buildBaseCtx({
      openDashboard: () => { called += 1; },
    });

    const menu = initMenu(ctx);
    menu.buildContextMenu();

    const openDashboard = ctx.contextMenu.template.find((item) => item.label === "Open Workbench");
    assert.ok(openDashboard, "context menu should expose dashboard entry");
    openDashboard.click();
    assert.strictEqual(called, 1);
  });

  it("adds a tray menu item that opens the Dashboard", () => {
    const fakeElectron = {
      app: { quit: () => {}, setActivationPolicy: () => {}, dock: { show: () => {}, hide: () => {} } },
      BrowserWindow: function BrowserWindow() {},
      Menu: {
        buildFromTemplate(template) {
          return { template };
        },
      },
      Tray: function Tray() {
        this.setToolTip = () => {};
        this.setContextMenu = (menu) => { this.contextMenu = menu; };
        this.destroy = () => {};
      },
      nativeImage: {
        createFromPath() {
          return {
            resize() { return this; },
            setTemplateImage() {},
          };
        },
      },
      screen: {
        getAllDisplays: () => [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }],
        getCursorScreenPoint: () => ({ x: 0, y: 0 }),
        getDisplayNearestPoint: () => ({ id: 1 }),
      },
    };
    const initMenu = loadMenuWithElectron(fakeElectron);

    let called = 0;
    const ctx = buildBaseCtx({
      openDashboard: () => { called += 1; },
    });

    const menu = initMenu(ctx);
    menu.createTray();

    const openDashboard = ctx.tray.contextMenu.template.find((item) => item.label === "Open Workbench");
    assert.ok(openDashboard, "tray menu should expose dashboard entry");
    openDashboard.click();
    assert.strictEqual(called, 1);
  });
});

it("opens the chat window from the pet context menu", () => {
  const initMenu = loadMenuWithElectron({
    app: {},
    Menu: { buildFromTemplate: template => ({ template }) },
    screen: { getAllDisplays: () => [] },
  });
  let calls = 0;
  const ctx = buildBaseCtx({ openChat: () => { calls += 1; } });
  initMenu(ctx).buildContextMenu();
  ctx.contextMenu.template.find(item => item.label === "Open Chat").click();
  assert.equal(calls, 1);
});

it("opens macOS Agent apps from the pet menu and reports a launch failure", () => {
  const calls = [];
  const errors = [];
  const fakeElectron = {
    app: { dock: {} },
    dialog: { showErrorBox: (...args) => errors.push(args) },
    Menu: { buildFromTemplate: (template) => ({ template }) },
    screen: { getAllDisplays: () => [] },
  };
  const execFile = (file, args, callback) => {
    calls.push([file, ...args]);
    callback(args.includes("Antigravity IDE.app") ? new Error("not found") : null);
  };
  const initMenu = loadMenuWithElectron(fakeElectron, null, "darwin", execFile);
  let trayTemplate;
  const ctx = buildBaseCtx({ openChat() {}, tray: { setContextMenu: menu => { trayTemplate = menu.template; } } });
  const menu = initMenu(ctx);
  menu.buildContextMenu();
  menu.buildTrayMenu();
  assert.deepEqual(trayTemplate.map(entry => entry.label), ctx.contextMenu.template.map(entry => entry.label));

  const items = ctx.contextMenu.template.filter(entry => entry.type !== "separator");
  assert.deepEqual(items.map(entry => entry.label), [
    "Open Chat", "Open Workbench", "Agent Clients", "Sleep (Do Not Disturb)", "Hide Pet", "Settings…", "Quit",
  ]);
  const item = items.find(({ label }) => label === "Agent Clients");
  for (const client of item.submenu) client.click();
  assert.deepEqual(calls, [
    ["/usr/bin/open", "-b", "com.openai.codex"],
    ["/usr/bin/open", "-b", "com.google.GeminiMacOS"],
    ["/usr/bin/open", "-a", "Antigravity.app"],
    ["/usr/bin/open", "-a", "Antigravity IDE.app"],
  ]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0][0], "Could not open Antigravity IDE");
});
