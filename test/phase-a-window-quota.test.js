"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { buildUnifiedQuotaRows } = require("../src/quota-view-model");
const { computeHaloBounds } = require("../src/pet-halo").__test;
const createSettingsWindowRuntime = require("../src/settings-window");
const { createChatWindow } = require("../src/chat-window");

describe("Phase A: unified 5-row quota view model", () => {
  it("returns all 5 services in canonical order, preserves disabled 5h (not 0%), and marks ChatGPT unknown", () => {
    const now = Date.parse("2026-11-27T12:00:00Z");
    const sources = [
      {
        sourceKey: "",
        host: null,
        codexQuota: {
          updatedAt: now - 60000,
          lastSeenAt: now - 60000,
          group: {
            codexFiveHour: { usedPercent: 28, windowMinutes: 300, resetAt: now + 3600000, lastSeenAt: now - 60000 },
            codexWeekly: { usedPercent: 41, windowMinutes: 10080, resetAt: now + 86400000 * 3, lastSeenAt: now - 60000 },
          },
        },
      },
      {
        sourceKey: "antigravity-cli-usage",
        host: "Antigravity CLI",
        antigravityCliQuota: {
          updatedAt: now - 120000,
          lastSeenAt: now - 120000,
          group: {
            group0_0: { groupLabel: "Gemini", bucketLabel: "5h", usedPercent: 15, windowMinutes: 300, resetAt: now + 7200000, disabled: false, lastSeenAt: now - 120000 },
            group0_1: { groupLabel: "Gemini", bucketLabel: "Weekly", usedPercent: 30, windowMinutes: 10080, resetAt: now + 86400000 * 4, disabled: false, lastSeenAt: now - 120000 },
            group1_0: { groupLabel: "Claude / GPT", bucketLabel: "5h", usedPercent: 100, windowMinutes: 300, disabled: true, lastSeenAt: now - 120000 },
            group1_1: { groupLabel: "Claude / GPT", bucketLabel: "Weekly", usedPercent: 100, windowMinutes: 10080, resetAt: now + 86400000 * 2, disabled: false, lastSeenAt: now - 120000 },
          },
        },
      },
      {
        sourceKey: "gemini-web-usage",
        host: "Gemini · Chrome background",
        geminiChatQuota: {
          updatedAt: now - 30000,
          lastSeenAt: now - 30000,
          group: {
            geminiChatFiveHour: { usedPercent: 20, windowMinutes: 300, resetAt: now + 3600000, lastSeenAt: now - 30000 },
            geminiChatWeekly: { usedPercent: 10, windowMinutes: 10080, resetAt: now + 86400000 * 5, lastSeenAt: now - 30000 },
          },
        },
      },
    ];

    const rows = buildUnifiedQuotaRows(sources, now);
    assert.deepEqual(rows.map((r) => r.id), [
      "codex",
      "antigravity-gemini",
      "antigravity-claude-gpt",
      "gemini-chat",
    ]);

    assert.equal(rows[0].shortWindow.remaining, 72);
    assert.equal(rows[0].weeklyWindow.remaining, 59);

    assert.equal(rows[1].shortWindow.remaining, 85);
    assert.equal(rows[1].weeklyWindow.remaining, 70);

    // Disabled 5h slot MUST be flagged disabled, never displayed as 0% value
    assert.equal(rows[2].shortWindow.kind, "disabled");
    assert.equal(rows[2].shortWindow.disabled, true);
    assert.equal(rows[2].weeklyWindow.kind, "value");
    assert.equal(rows[2].weeklyWindow.remaining, 0);

    assert.equal(rows[3].shortWindow.remaining, 80);
    assert.equal(rows[3].weeklyWindow.remaining, 90);
  });
});

describe("Phase A: halo proximity and macOS window lifecycle", () => {
  it("anchors pet halo tightly against hitRect instead of inflated canvas anchorRect", () => {
    const hitRect = { left: 600, top: 420, right: 700, bottom: 510 };
    const inflatedAnchorRect = { left: 560, top: 380, right: 740, bottom: 560 };
    const layout = computeHaloBounds({
      hitRect,
      anchorRect: inflatedAnchorRect,
      workArea: { x: 0, y: 25, width: 1440, height: 875 },
      width: 304,
      height: 216,
      scale: 1,
    });
    assert.equal(layout.flippedAbove, false);
    assert.ok(layout.bounds.y - hitRect.bottom <= 2, `expected halo within 2px of hitRect, got ${layout.bounds.y - hitRect.bottom}`);
  });

  it("hides Settings on minimize and close on macOS instead of destroying or leaving Dock tile", () => {
    let quitting = false;
    let hiddenCount = 0;
    let beforeShowCount = 0;
    let createdWin = null;
    class FakeWindow extends EventEmitter {
      constructor() {
        super();
        createdWin = this;
        this._destroyed = false;
        this._visible = true;
        this.webContents = new EventEmitter();
        this.webContents.send = () => {};
        this.webContents.isDestroyed = () => false;
      }
      isDestroyed() { return this._destroyed; }
      isVisible() { return this._visible; }
      isMinimized() { return false; }
      show() { this._visible = true; }
      hide() { this._visible = false; hiddenCount += 1; }
      focus() {}
      moveTop() {}
      setTitle() {}
      setMenuBarVisibility() {}
      loadFile() { return Promise.resolve(); }
      getBounds() { return { x: 100, y: 100, width: 800, height: 660 }; }
      getNormalBounds() { return { x: 100, y: 100, width: 800, height: 660 }; }
    }
    const rt = createSettingsWindowRuntime({
      app: { isPackaged: false, isReady: () => true, getAppPath: () => "/tmp" },
      BrowserWindow: FakeWindow,
      nativeTheme: { shouldUseDarkColors: true },
      platform: "darwin",
      isMac: true,
      isWin: false,
      isAppQuitting: () => quitting,
      hideOnMinimize: true,
      hideOnClose: true,
      onBeforeShow: () => { beforeShowCount += 1; },
    });
    rt.open();
    createdWin.emit("ready-to-show");
    assert.equal(beforeShowCount, 1);

    let minPrevented = false;
    createdWin.emit("minimize", { preventDefault() { minPrevented = true; } });
    assert.equal(minPrevented, true);
    assert.equal(hiddenCount, 1);

    let closePrevented = false;
    createdWin.emit("close", { preventDefault() { closePrevented = true; } });
    assert.equal(closePrevented, true);
    assert.equal(hiddenCount, 2);

    quitting = true;
    let quitClosePrevented = false;
    createdWin.emit("close", { preventDefault() { quitClosePrevented = true; } });
    assert.equal(quitClosePrevented, false);
  });

  it("hides Command window on blur and close without stopping or closing when not quitting", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "char-cmd-"));
    let createdWin = null;
    let hidden = 0;
    const handlers = new Map();
    class FakeWin extends EventEmitter {
      constructor(opts) {
        super();
        this.opts = opts;
        this._visible = true;
        createdWin = this;
        this.webContents = new EventEmitter();
        this.webContents.send = () => {};
        this.webContents.setWindowOpenHandler = () => {};
        this.webContents.isLoading = () => false;
      }
      isDestroyed() { return false; }
      isVisible() { return this._visible; }
      isMinimized() { return false; }
      show() { this._visible = true; }
      hide() { this._visible = false; hidden += 1; }
      focus() {}
      setTitle() {}
      setAlwaysOnTop() {}
      getSize() { return [520, 60]; }
      setPosition() {}
      getContentSize() { return [520, 60]; }
      setContentSize() {}
      loadFile() { return Promise.resolve(); }
    }
    const cmd = createChatWindow({
      app: { getPath: () => tmp },
      BrowserWindow: FakeWin,
      ipcMain: { handle: (c, fn) => handlers.set(c, fn), on: () => {} },
      nativeTheme: { shouldUseDarkColors: true },
      safeStorage: { isEncryptionAvailable: () => false },
      shell: { openExternal: () => Promise.resolve() },
      getLang: () => "zh",
      isAppQuitting: () => false,
    });
    cmd.open();
    let prevented = false;
    createdWin.emit("close", { preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(hidden, 1);

    createdWin.show();
    cmd.hide();
    assert.equal(hidden, 2);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("hides Settings on blur ONLY in fullscreen Spaces when app loses focus, and keeps it open on ordinary Desktop Spaces", async () => {
    let inFullscreen = false;
    let appActive = false;
    let hiddenCount = 0;
    let createdWin = null;
    class FakeWindow extends EventEmitter {
      constructor() {
        super();
        createdWin = this;
        this._visible = false;
        this._focused = false;
        this.webContents = new EventEmitter();
        this.webContents.send = () => {};
        this.webContents.isDestroyed = () => false;
      }
      isDestroyed() { return false; }
      isVisible() { return this._visible; }
      isFocused() { return this._focused; }
      isMinimized() { return false; }
      show() { this._visible = true; this._focused = true; }
      hide() { this._visible = false; this._focused = false; hiddenCount += 1; }
      focus() { this._focused = true; }
      moveTop() {}
      setTitle() {}
      setMenuBarVisibility() {}
      loadFile() { return Promise.resolve(); }
      getBounds() { return { x: 100, y: 100, width: 800, height: 660 }; }
      getNormalBounds() { return { x: 100, y: 100, width: 800, height: 660 }; }
    }
    const rt = createSettingsWindowRuntime({
      app: { isPackaged: false, isReady: () => true, getAppPath: () => "/tmp", focus: () => {} },
      BrowserWindow: FakeWindow,
      nativeTheme: { shouldUseDarkColors: true },
      platform: "darwin",
      isMac: true,
      isWin: false,
      isAppQuitting: () => false,
      isActiveMacSpaceFullscreen: () => inFullscreen,
      isMacAppActive: () => appActive,
    });

    // 1. Ordinary desktop Space: clicking another app must NOT hide Settings (it drops behind naturally).
    rt.open();
    createdWin.emit("ready-to-show");
    createdWin._focused = false;
    appActive = false;
    createdWin.emit("blur");
    await new Promise((r) => setTimeout(r, 90));
    assert.equal(hiddenCount, 0);
    assert.equal(createdWin.isVisible(), true);

    // 2. Fullscreen Space while focus stays inside Character OS: must NOT hide.
    inFullscreen = true;
    appActive = true;
    rt.open();
    createdWin._focused = false;
    createdWin.emit("blur");
    await new Promise((r) => setTimeout(r, 90));
    assert.equal(hiddenCount, 1); // 1 from summon detach before reshow, NOT from blur!
    assert.equal(createdWin.isVisible(), true);

    // 3. Fullscreen Space when clicking another app (appActive=false): MUST hide to avoid covering fullscreen app.
    appActive = false;
    createdWin._focused = false;
    createdWin.emit("blur");
    await new Promise((r) => setTimeout(r, 90));
    assert.equal(hiddenCount, 2);
    assert.equal(createdWin.isVisible(), false);
  });

  it("activates app, restores mouse input, and focuses webContents on repeated Command opens", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "char-cmd-focus-"));
    let createdWin = null;
    let appFocusCalls = 0;
    let wcFocusCalls = 0;
    let ignoreMouseCalls = [];
    let focusableCalls = [];
    class FakeWin extends EventEmitter {
      constructor() {
        super();
        createdWin = this;
        this._visible = false;
        this._focused = false;
        this.webContents = new EventEmitter();
        this.webContents.send = () => {};
        this.webContents.focus = () => { wcFocusCalls += 1; };
        this.webContents.isDestroyed = () => false;
        this.webContents.setWindowOpenHandler = () => {};
        this.webContents.isLoading = () => false;
      }
      isDestroyed() { return false; }
      isVisible() { return this._visible; }
      isFocused() { return this._focused; }
      isMinimized() { return false; }
      setIgnoreMouseEvents(v) { ignoreMouseCalls.push(v); }
      setFocusable(v) { focusableCalls.push(v); }
      show() { this._visible = true; }
      hide() { this._visible = false; this._focused = false; this.emit("blur"); }
      focus() { this._focused = true; }
      setTitle() {}
      setAlwaysOnTop() {}
      getSize() { return [520, 60]; }
      setPosition() {}
      getContentSize() { return [520, 60]; }
      setContentSize() {}
      loadFile() { return Promise.resolve(); }
    }
    const cmd = createChatWindow({
      app: { getPath: () => tmp, focus: () => { appFocusCalls += 1; } },
      BrowserWindow: FakeWin,
      ipcMain: { handle: () => {}, on: () => {} },
      nativeTheme: { shouldUseDarkColors: true },
      safeStorage: { isEncryptionAvailable: () => false },
      shell: { openExternal: () => Promise.resolve() },
      getLang: () => "zh",
      isAppQuitting: () => false,
    });

    cmd.open();
    createdWin.emit("ready-to-show");
    assert.ok(appFocusCalls >= 1);
    assert.ok(wcFocusCalls >= 1);
    assert.equal(createdWin.isVisible(), true);

    // Repeated open across Space (triggers internal hide->show) must NOT blur-hide itself
    cmd.open();
    assert.equal(createdWin.isVisible(), true);
    assert.equal(ignoreMouseCalls.every((v) => v === false), true);
    assert.equal(focusableCalls.every((v) => v === true), true);

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
