"use strict";

const { app, BrowserWindow, dialog, screen, Menu, Tray, nativeImage } = require("electron");
const { execFile } = require("node:child_process");
const path = require("path");
const { keepOutOfTaskbar } = require("./taskbar");
const { loadTrayNormalIcon } = require("./tray-flash-icon");
const { createMacDockVisibilityCoordinator } = require("./mac-dock-visibility");
const { resolveRuntimeDockIconPolicy } = require("./mac-dock-icon-runtime");

const platform = process.platform;
const isMac = platform === "darwin";
const isWin = platform === "win32";
const isLinux = platform === "linux";
const MENU_FOCUS_WAIT_MS = 200;
const MENU_OWNER_HIDE_DELAY_MS = 500;
const TRAY_TOOLTIP = "Character OS";

// Login-item / autostart helpers and the openAtLogin write path live in
// src/login-item.js + main.js's settings-actions effect. menu.js used to
// inline them but now just renders a checkbox bound to ctx.openAtLogin.

const WIN_TOPMOST_LEVEL = "pop-up-menu"; // above taskbar-level UI

// ── Window size presets (mirrored from main.js for resizeWindow) ──
const SIZES = {
  S: { width: 200, height: 200 },
  M: { width: 280, height: 280 },
  L: { width: 360, height: 360 },
};

// i18n string pool + translator factory live in src/i18n.js so the future
// settings panel can share them. menu.js binds the translator to ctx.lang.
const { createTranslator } = require("./i18n");

// Concatenate menu groups into one Electron template, inserting exactly one
// separator between non-empty groups. Empty groups are dropped entirely so no
// phantom/doubled separator is ever rendered (Electron leaves a visible gap for
// a stray separator). Doing the grouping here — instead of hand-placing a
// separator around almost every item — is what lets the menu read as a few
// labelled clusters (state / work / display / app) rather than one slice per
// row.
function joinGroups(groups) {
  const template = [];
  for (const group of groups) {
    if (!group || group.length === 0) continue;
    if (template.length > 0) template.push({ type: "separator" });
    template.push(...group);
  }
  return template;
}

module.exports = function initMenu(ctx) {
  // ── Translation helper (bound to ctx.lang via the shared i18n module) ──
  const t = createTranslator(() => ctx.lang);
  const macDockVisibility = isMac ? createMacDockVisibilityCoordinator({
    app,
    dock: app.dock,
    dockIconPath: path.join(__dirname, "../assets/dock-icon.png"),
    shouldInstallDockIcon: () => resolveRuntimeDockIconPolicy({
      platform,
      isPackaged: app.isPackaged === true,
      getSystemVersion: () => {
        if (typeof ctx.getSystemVersion === "function") return ctx.getSystemVersion();
        if (typeof process.getSystemVersion === "function") return process.getSystemVersion();
        return "";
      },
    }),
    getSettingsWindow: ctx.getSettingsWindow,
    reapplyMacVisibility: ctx.reapplyMacVisibility,
  }) : null;

  // ── System tray ──
  function createTray() {
    if (ctx.tray) return;
    // Shared with the completion flash so both frames keep the same size (#722).
    const icon = loadTrayNormalIcon({
      nativeImage,
      platform: process.platform,
      templatePath: path.join(__dirname, "../assets/tray-iconTemplate.png"),
      iconPath: path.join(__dirname, "../assets/icon.png"),
    });
    ctx.tray = new Tray(icon);
    ctx.tray.setToolTip(TRAY_TOOLTIP);
    buildTrayMenu();
  }

  function destroyTray() {
    if (!ctx.tray) return;
    ctx.tray.destroy();
    ctx.tray = null;
  }

  function applyDockVisibility() {
    if (!isMac) return;
    return macDockVisibility.apply(ctx.showDock);
  }

  function buildTrayMenu() {
    if (!ctx.tray) return;
    ctx.tray.setContextMenu(Menu.buildFromTemplate(buildPetMenuTemplate()));
  }

  function buildAgentClientsMenuItem() {
    const clients = [
      { label: "Codex", args: ["-b", "com.openai.codex"] },
      { label: "Gemini", args: ["-b", "com.google.GeminiMacOS"] },
      { label: "Antigravity", args: ["-a", "Antigravity.app"] },
      { label: "Antigravity IDE", args: ["-a", "Antigravity IDE.app"] },
    ];
    return {
      label: t("openAgentClient"),
      submenu: clients.map(({ label, args }) => ({
        label,
        click: () => {
          execFile("/usr/bin/open", args, (error) => {
            if (error) {
              dialog.showErrorBox(
                t("openAgentClientFailed").replace("{app}", label),
                t("openAgentClientCheckInstallation"),
              );
            }
          });
        },
      })),
    };
  }

  function rebuildAllMenus() {
    buildTrayMenu();
    buildContextMenu();
  }

  function requestAppQuit() {
    ctx.isQuitting = true;
    app.quit();
  }

  function ensureContextMenuOwner() {
    if (ctx.contextMenuOwner && !ctx.contextMenuOwner.isDestroyed()) return ctx.contextMenuOwner;
    if (!ctx.win || ctx.win.isDestroyed()) return null;

    ctx.contextMenuOwner = new BrowserWindow({
      parent: ctx.win,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      show: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      focusable: true,
      closable: false,
      minimizable: false,
      maximizable: false,
      hasShadow: false,
    });

    // Chromium reclaims empty (about:blank) hidden renderers, which defeats
    // the "persistent helper window" design — every right-click ends up
    // re-spawning a renderer process. Load a minimal data: URL so the
    // renderer has a real document and stays alive across menu invocations.
    ctx.contextMenuOwner.loadURL("data:text/html,%3C!doctype%20html%3E");

    // macOS: ensure owner can appear on fullscreen Spaces
    ctx.reapplyMacVisibility();

    ctx.contextMenuOwner.on("close", (event) => {
      if (!ctx.isQuitting) {
        event.preventDefault();
        ctx.contextMenuOwner.hide();
      }
    });

    ctx.contextMenuOwner.on("closed", () => {
      ctx.contextMenuOwner = null;
    });

    return ctx.contextMenuOwner;
  }

  let ownerHideTimer = null;

  // A menu opened before the owner window has focus closes within milliseconds
  // under XWayland, so every other right-click looked like nothing happened.
  // Wait for the focus just requested; the timeout keeps the menu working if
  // it never arrives.
  function whenOwnerFocused(owner, open) {
    if (!isLinux || typeof owner.isFocused !== "function" || owner.isFocused()) {
      open();
      return;
    }
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      owner.removeListener("focus", settle);
      if (owner.isDestroyed() || ctx.isQuitting) {
        ctx.menuOpen = false;
        return;
      }
      open();
    };
    const timer = setTimeout(settle, MENU_FOCUS_WAIT_MS);
    owner.once("focus", settle);
  }

  // Under XWayland, hiding the owner in the same moment a focused menu closes
  // can block the main process for 20 s or more, until the GPU process exits.
  // The 500 ms delay is an empirical value measured on Ubuntu GNOME 50.1
  // under XWayland; why it freezes is still unknown (#1336 / #1350). A new
  // menu reuses the owner that is still up.
  function cancelOwnerHide() {
    if (ownerHideTimer === null) return;
    clearTimeout(ownerHideTimer);
    ownerHideTimer = null;
  }

  function hideOwnerAfterMenu(owner) {
    if (!isLinux) {
      owner.hide();
      return;
    }
    cancelOwnerHide();
    ownerHideTimer = setTimeout(() => {
      ownerHideTimer = null;
      if (!owner.isDestroyed()) owner.hide();
    }, MENU_OWNER_HIDE_DELAY_MS);
  }

  function popupMenuAt(menu) {
    if (ctx.menuOpen) return;
    cancelOwnerHide();
    const owner = ensureContextMenuOwner();
    if (!owner) return;

    const cursor = screen.getCursorScreenPoint();
    owner.setBounds({ x: cursor.x, y: cursor.y, width: 1, height: 1 });
    owner.show();
    keepOutOfTaskbar(owner);
    owner.focus();

    ctx.menuOpen = true;
    whenOwnerFocused(owner, () => menu.popup({
      window: owner,
      callback: () => {
        ctx.menuOpen = false;
        if (owner && !owner.isDestroyed()) hideOwnerAfterMenu(owner);
        // #1260 backstop: the normal renderer path ends any active drag
        // before asking for this menu, so a lock still held at close time
        // was stranded by the menu's modal loop swallowing the closing
        // pointerup. Release through the shared recovery entry — it also
        // pushes force-drag-release so the renderer unwinds its gesture
        // state and the input window re-syncs.
        if (ctx.dragLocked && typeof ctx.releaseStrandedDragLock === "function") {
          ctx.releaseStrandedDragLock();
        }
        // ctx.petHidden guard: the menu's own Hide item may have just hidden
        // the pet, and the click handler can fire on either side of this close
        // callback — an unconditional showInactive() would resurrect a window
        // setPetHidden() just hid. Skipping is safe: showPetWindows() re-asserts
        // taskbar/mac flags on the next show, and Windows topmost is held by
        // the window's alwaysOnTop flag plus the topmost-runtime watchdog, not
        // by this callback.
        if (ctx.win && !ctx.win.isDestroyed() && !ctx.petHidden) {
          ctx.win.showInactive();
          keepOutOfTaskbar(ctx.win);
          if (isMac) {
            ctx.reapplyMacVisibility();
          } else if (isWin) {
            if (ctx.petAlwaysOnTop === false) {
              ctx.raisePetWindows();
            } else {
              ctx.win.setAlwaysOnTop(true, WIN_TOPMOST_LEVEL);
            }
          }
        }
      },
    }));
  }

  function buildWorkGroup() {
    return [
      ...(typeof ctx.openChat === "function" ? [{ label: t("openChat"), click: ctx.openChat }] : []),
      { label: t("openDashboard"), click: () => ctx.openDashboard?.() },
      ...(isMac ? [buildAgentClientsMenuItem()] : []),
    ];
  }

  function buildSleepItem() {
    return {
      label: ctx.doNotDisturb ? t("wake") : t("sleep"),
      click: () => ctx.doNotDisturb ? ctx.disableDoNotDisturb() : ctx.enableDoNotDisturb(),
    };
  }

  function buildPetVisibilityItem() {
    // A fullscreen poll can change visibility while the menu is open. Apply
    // the action shown at build time so an intervening change is idempotent.
    const petHiddenAtBuild = ctx.petHidden;
    return {
      label: petHiddenAtBuild ? t("showPet") : t("hidePet"),
      click: () => ctx.setPetVisibility(petHiddenAtBuild),
    };
  }

  function buildPetMenuTemplate() {
    return joinGroups([
      buildWorkGroup(),
      [buildSleepItem(), buildPetVisibilityItem()],
      [{ label: t("settings"), click: () => ctx.openSettingsWindow() }],
      [{ label: t("quit"), click: () => requestAppQuit() }],
    ]);
  }

  function buildContextMenu() {
    ctx.contextMenu = Menu.buildFromTemplate(buildPetMenuTemplate());
  }

  function showPetContextMenu() {
    if (!ctx.win || ctx.win.isDestroyed()) return;
    buildContextMenu();
    popupMenuAt(ctx.contextMenu);
  }

  function resizeWindow(sizeKey, options = {}) {
    // Some size commits have no preview protection (for example the displayed
    // percentage reset), so stop any walk before it can restore its old size.
    if (typeof ctx.cancelRoam === "function") ctx.cancelRoam();
    const mode = options.mode || (options.persist === false ? "preview" : "commit");
    const persist = mode !== "preview";
    // Setter routes through controller.applyUpdate("size", ...) — subscriber
    // rebuilds menus on commit. We still need to physically resize the
    // window and capture the new bounds at the end.
    if (persist) {
      ctx.currentSize = sizeKey;
      // A same-value update is a controller noop, but the preview may already
      // have resized the window on a different display.
      if (typeof ctx.resetKeepSizeFrozen === "function") ctx.resetKeepSizeFrozen();
    }
    const size = (typeof ctx.getPixelSizeFor === "function")
      ? ctx.getPixelSizeFor(sizeKey)
      : (SIZES[sizeKey] || ctx.getCurrentPixelSize());
    if (!ctx.miniHandleResize(sizeKey)) {
      if (ctx.win && !ctx.win.isDestroyed()) {
        const { x, y } = ctx.getPetWindowBounds();
        const clamped = ctx.clampToScreenVisual(x, y, size.width, size.height);
        ctx.applyPetWindowBounds({ ...clamped, width: size.width, height: size.height });
      }
    }
    if (mode !== "preview") {
      ctx.syncHitWin();
      ctx.repositionBubbles();
      if (persist) ctx.flushRuntimeStateToPrefs();
    }
  }

  return {
    t,
    buildContextMenu,
    buildTrayMenu,
    rebuildAllMenus,
    createTray,
    destroyTray,
    getTray: () => ctx.tray,
    applyDockVisibility,
    ensureContextMenuOwner,
    popupMenuAt,
    showPetContextMenu,
    resizeWindow,
    requestAppQuit,
  };
};
