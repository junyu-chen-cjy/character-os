"use strict";

const { BrowserWindow, dialog, screen } = require("electron");
const { execFile } = require("node:child_process");
const path = require("node:path");
const { keepOutOfTaskbar } = require("./taskbar");
const { clampTextScale, scaleHeight, applyZoomToWindow } = require("./text-scale");

const isLinux = process.platform === "linux";
const isMac = process.platform === "darwin";
const isWin = process.platform === "win32";

const HALO_WIDTH = 304;
const HALO_DEFAULT_HEIGHT = 186;
const HALO_MIN_HEIGHT = 96;
const HALO_MAX_HEIGHT = 270;
const HALO_PET_GAP = 1;
const EDGE_MARGIN = 8;
const BUBBLE_GAP = 6;
const HOT_ZONE_PAD = 14;
const HOVER_OPEN_DELAY_MS = 180;
const HIDE_GRACE_MS = 260;
const EXIT_ANIM_MS = 150;
const AUTO_HIDE_POLL_MS = 90;
const MAC_FLOATING_TOPMOST_DELAY_MS = 120;
const WIN_TOPMOST_LEVEL = "pop-up-menu";
const LINUX_WINDOW_TYPE = "toolbar";

const MAC_AGENT_CLIENTS = Object.freeze([
  { id: "codex", label: "Codex", kind: "agent", args: ["-b", "com.openai.codex"] },
  { id: "antigravity", label: "Antigravity", kind: "app", args: ["-b", "com.google.antigravity"] },
]);

function clamp(value, min, max) {
  if (max < min) return min;
  return Math.max(min, Math.min(value, max));
}

function isScreenRect(rect) {
  return !!rect
    && Number.isFinite(rect.left)
    && Number.isFinite(rect.top)
    && Number.isFinite(rect.right)
    && Number.isFinite(rect.bottom);
}

function toEdgesRect(rect) {
  if (!rect) return null;
  if (isScreenRect(rect)) return rect;
  if (
    Number.isFinite(rect.x)
    && Number.isFinite(rect.y)
    && Number.isFinite(rect.width)
    && Number.isFinite(rect.height)
    && rect.width > 0
    && rect.height > 0
  ) {
    return {
      left: rect.x,
      top: rect.y,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
    };
  }
  return null;
}

function pointInExpandedRect(point, rect, pad = 0) {
  const r = toEdgesRect(rect);
  if (!point || !r) return false;
  const p = Number.isFinite(pad) ? pad : 0;
  return point.x >= r.left - p
    && point.x <= r.right + p
    && point.y >= r.top - p
    && point.y <= r.bottom + p;
}

function buildBridgeRect(aRaw, bRaw) {
  const a = toEdgesRect(aRaw);
  const b = toEdgesRect(bRaw);
  if (!a || !b) return null;
  const verticalGap = Math.max(0, Math.max(a.top - b.bottom, b.top - a.bottom));
  const horizontalGap = Math.max(0, Math.max(a.left - b.right, b.left - a.right));
  if (verticalGap > 48 && horizontalGap > 48) return null;
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

function computeHaloHotZone({ petHitRect, haloBounds, pad = HOT_ZONE_PAD }) {
  const rects = [];
  const pet = toEdgesRect(petHitRect);
  const halo = toEdgesRect(haloBounds);
  if (pet) rects.push(pet);
  if (halo) {
    rects.push(halo);
    const bridge = pet ? buildBridgeRect(pet, halo) : null;
    if (bridge) rects.push(bridge);
  }
  return { rects, pad: Number.isFinite(pad) ? pad : 0 };
}

function pointInHaloHotZone(point, hotZone) {
  if (!point || !hotZone || !Array.isArray(hotZone.rects)) return false;
  for (const rect of hotZone.rects) {
    if (pointInExpandedRect(point, rect, hotZone.pad)) return true;
  }
  return false;
}

function computeHaloBounds({
  hitRect,
  anchorRect,
  workArea,
  width = HALO_WIDTH,
  height = HALO_DEFAULT_HEIGHT,
  scale = 1,
}) {
  // Anchor directly against the visible sprite hitbox so the hover panel sits
  // naturally close to the character instead of floating past empty canvas margins.
  const followRect = isScreenRect(hitRect) ? hitRect : anchorRect;
  if (!isScreenRect(followRect) || !workArea) return null;

  const s = clampTextScale(scale);
  const outerWidth = Math.round(width * s);
  const outerHeight = Math.round(clamp(height, HALO_MIN_HEIGHT, HALO_MAX_HEIGHT) * s);
  const petGap = Math.round(HALO_PET_GAP * s);
  const edgeMargin = Math.round(EDGE_MARGIN * s);

  const followCx = Math.round((followRect.left + followRect.right) / 2);
  const minX = Math.round(workArea.x + edgeMargin);
  const maxX = Math.round(workArea.x + workArea.width - edgeMargin - outerWidth);
  const x = clamp(followCx - Math.round(outerWidth / 2), minX, maxX);

  const belowY = Math.round(followRect.bottom) + petGap;
  const maxY = Math.round(workArea.y + workArea.height - edgeMargin - outerHeight);
  const minY = Math.round(workArea.y + edgeMargin);

  if (belowY <= maxY) {
    const bounds = { x, y: Math.max(minY, belowY), width: outerWidth, height: outerHeight };
    return { bounds, contentBounds: bounds, flippedAbove: false };
  }

  const aboveY = Math.round(followRect.top) - petGap - outerHeight;
  const bounds = {
    x,
    y: clamp(aboveY, minY, maxY),
    width: outerWidth,
    height: outerHeight,
  };
  return { bounds, contentBounds: bounds, flippedAbove: true };
}

function deferMacFloatingVisibility(ctx, win) {
  if (!isMac || !win || win.isDestroyed()) return;
  const deferUntil = Date.now() + MAC_FLOATING_TOPMOST_DELAY_MS;
  win.__clawdMacDeferredVisibilityUntil = deferUntil;
  setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    if (win.__clawdMacDeferredVisibilityUntil === deferUntil) {
      delete win.__clawdMacDeferredVisibilityUntil;
    }
    if (typeof ctx.reapplyMacVisibility === "function") ctx.reapplyMacVisibility();
  }, MAC_FLOATING_TOPMOST_DELAY_MS);
}

async function launchAgentClientApp(clientId, { t, showDashboard, agentRegistry } = {}) {
  const entry = MAC_AGENT_CLIENTS.find((c) => c.id === clientId);
  if (agentRegistry && typeof agentRegistry.launchClient === "function") {
    const res = await agentRegistry.launchClient(clientId);
    if (res && res.status === "ok") return res;
    if (typeof dialog?.showErrorBox === "function" && entry) {
      const tr = typeof t === "function" ? t : (k) => k;
      dialog.showErrorBox(
        tr("openAgentClientFailed").replace("{app}", entry.label),
        tr("openAgentClientCheckInstallation")
      );
    }
    return { status: "error", reason: "launch-failed", error: res?.error || "" };
  }
  if (isMac) {
    if (!entry) return { status: "error", reason: "unknown-client" };
    return new Promise((resolve) => {
      execFile("/usr/bin/open", entry.args, (error) => {
        if (error) {
          if (typeof dialog?.showErrorBox === "function") {
            const tr = typeof t === "function" ? t : (k) => k;
            dialog.showErrorBox(
              tr("openAgentClientFailed").replace("{app}", entry.label),
              tr("openAgentClientCheckInstallation")
            );
          }
          resolve({ status: "error", reason: "launch-failed" });
          return;
        }
        resolve({ status: "ok" });
      });
    });
  }
  if (typeof showDashboard === "function") showDashboard({ source: "halo-client" });
  return { status: "ok", fallback: "workspace" };
}

function initPetHalo(ctx) {
  let haloWindow = null;
  let haloLoaded = false;
  let haloMeasuredCssHeight = HALO_DEFAULT_HEIGHT;
  let haloFlippedAbove = false;
  let haloVisibleLogical = false;
  let lastReservedOffset = 0;

  let latestSnapshot = null;
  let hoverActive = false;
  let hoverOpenTimer = null;
  let hideAnimTimer = null;
  let pollTimer = null;
  let visibleHoldUntil = 0;
  const surfaceHover = { pet: false, halo: false };
  const ipcDisposers = [];

  function getTextScale() {
    return clampTextScale(typeof ctx.getTextScale === "function" ? ctx.getTextScale() : 1);
  }

  function getSnapshot() {
    return typeof ctx.getSessionSnapshot === "function"
      ? ctx.getSessionSnapshot()
      : { sessions: [], accountQuota: [], quotaAgentIcons: {} };
  }

  function isSuppressed() {
    if (!ctx.win || ctx.win.isDestroyed()) return true;
    if (ctx.petHidden) return true;
    if (typeof ctx.isDragLocked === "function" && ctx.isDragLocked()) return true;
    if (ctx.menuOpen) return true;
    if (typeof ctx.getMiniMode === "function" && ctx.getMiniMode()) return true;
    if (typeof ctx.getMiniTransitioning === "function" && ctx.getMiniTransitioning()) return true;
    return false;
  }

  function buildHaloStatePayload(snapshot = latestSnapshot || getSnapshot()) {
    const sessions = Array.isArray(snapshot && snapshot.sessions) ? snapshot.sessions : [];
    const runningCount = sessions.filter((s) => s && !s.headless && s.badge === "running").length;
    const pendingList = typeof ctx.getPendingPermissions === "function" ? ctx.getPendingPermissions() : [];
    const pendingApprovalCount = Array.isArray(pendingList) ? pendingList.length : 0;
    const snapshotIcons = (snapshot && snapshot.quotaAgentIcons) || {};
    const iconFor = typeof ctx.getAgentIconUrl === "function" ? ctx.getAgentIconUrl : () => "";
    return {
      lang: typeof ctx.getLang === "function" ? ctx.getLang() : "en",
      flippedAbove: haloFlippedAbove,
      runningCount,
      pendingApprovalCount,
      accountQuota: Array.isArray(snapshot && snapshot.accountQuota) ? snapshot.accountQuota : [],
      quotaAgentIcons: {
        ...snapshotIcons,
        codexQuota: snapshotIcons.codexQuota || iconFor("codex") || "",
        antigravityQuota: snapshotIcons.antigravityQuota || iconFor("antigravity-cli") || "",
      },
    };
  }

  function sendHaloState(snapshot = latestSnapshot || getSnapshot()) {
    if (!haloWindow || haloWindow.isDestroyed() || !haloLoaded) return;
    if (!haloWindow.webContents || haloWindow.webContents.isDestroyed()) return;
    haloWindow.webContents.send("pet-halo:state", buildHaloStatePayload(snapshot));
  }

  function sendHaloVisibility(visible) {
    if (!haloWindow || haloWindow.isDestroyed() || !haloLoaded) return;
    if (!haloWindow.webContents || haloWindow.webContents.isDestroyed()) return;
    haloWindow.webContents.send("pet-halo:visibility", {
      visible: !!visible,
      flippedAbove: haloFlippedAbove,
    });
  }

  function getPetFollowContext() {
    if (!ctx.win || ctx.win.isDestroyed()) return null;
    const petBounds = typeof ctx.getPetWindowBounds === "function" ? ctx.getPetWindowBounds() : null;
    if (!petBounds) return null;
    const hitRect = typeof ctx.getHitRectScreen === "function" ? ctx.getHitRectScreen(petBounds) : null;
    const anchorRect = typeof ctx.getSessionHudAnchorRect === "function"
      ? ctx.getSessionHudAnchorRect(petBounds)
      : null;
    const cx = petBounds.x + petBounds.width / 2;
    const cy = petBounds.y + petBounds.height / 2;
    const workArea = typeof ctx.getNearestWorkArea === "function"
      ? ctx.getNearestWorkArea(cx, cy)
      : { x: 0, y: 0, width: 1280, height: 800 };
    return { petBounds, hitRect, anchorRect, workArea };
  }

  function ensureHaloWindow() {
    if (haloWindow && !haloWindow.isDestroyed()) return haloWindow;
    if (!ctx.win || ctx.win.isDestroyed()) return null;

    haloLoaded = false;
    const scale = getTextScale();
    haloWindow = new BrowserWindow({
      parent: ctx.win,
      width: Math.round(HALO_WIDTH * scale),
      height: scaleHeight(haloMeasuredCssHeight, scale),
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: !isMac,
      focusable: false,
      hasShadow: false,
      backgroundColor: "#00000000",
      ...(isLinux ? { type: LINUX_WINDOW_TYPE } : {}),
      ...(isMac ? { type: "panel" } : {}),
      webPreferences: {
        preload: path.join(__dirname, "preload-pet-halo.js"),
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    if (isWin) haloWindow.setAlwaysOnTop(true, WIN_TOPMOST_LEVEL);
    if (typeof ctx.guardAlwaysOnTop === "function") ctx.guardAlwaysOnTop(haloWindow);

    haloWindow.loadFile(path.join(__dirname, "pet-halo.html"));
    haloWindow.webContents.once("did-finish-load", () => {
      haloLoaded = true;
      applyZoomToWindow(haloWindow, getTextScale());
      sendHaloState();
      syncSurfaces({ sendSnapshot: true });
    });
    haloWindow.on("closed", () => {
      haloWindow = null;
      haloLoaded = false;
      haloVisibleLogical = false;
      haloFlippedAbove = false;
      notifyReservedOffsetIfChanged();
    });
    return haloWindow;
  }

  function showPanelInactive(win) {
    if (!win || win.isDestroyed()) return;
    if (!haloLoaded) return;
    if (!win.isVisible()) {
      win.showInactive();
      keepOutOfTaskbar(win);
      if (isMac) deferMacFloatingVisibility(ctx, win);
      else if (typeof ctx.reapplyMacVisibility === "function") ctx.reapplyMacVisibility();
    }
  }

  function hideHaloImmediate() {
    if (hideAnimTimer) {
      clearTimeout(hideAnimTimer);
      hideAnimTimer = null;
    }
    haloVisibleLogical = false;
    haloFlippedAbove = false;
    surfaceHover.halo = false;
    if (haloWindow && !haloWindow.isDestroyed()) {
      sendHaloVisibility(false);
      haloWindow.hide();
    }
    notifyReservedOffsetIfChanged();
  }

  function hideHaloAnimated() {
    if (!haloWindow || haloWindow.isDestroyed() || !haloWindow.isVisible()) {
      haloVisibleLogical = false;
      notifyReservedOffsetIfChanged();
      return;
    }
    haloVisibleLogical = false;
    sendHaloVisibility(false);
    if (hideAnimTimer) clearTimeout(hideAnimTimer);
    hideAnimTimer = setTimeout(() => {
      hideAnimTimer = null;
      if (hoverActive) return;
      if (haloWindow && !haloWindow.isDestroyed()) haloWindow.hide();
      notifyReservedOffsetIfChanged();
    }, EXIT_ANIM_MS);
  }

  function syncSurfaces(options = {}) {
    const snapshot = options.snapshot || latestSnapshot || getSnapshot();
    latestSnapshot = snapshot;

    if (isSuppressed()) {
      cancelHoverOpenTimer();
      stopAutoHidePoll();
      hoverActive = false;
      hideHaloImmediate();
      return;
    }

    const scale = getTextScale();

    if (hoverActive) {
      if (hideAnimTimer) {
        clearTimeout(hideAnimTimer);
        hideAnimTimer = null;
      }
      const follow = getPetFollowContext();
      const computed = follow
        ? computeHaloBounds({
          hitRect: follow.hitRect,
          anchorRect: follow.anchorRect,
          workArea: follow.workArea,
          width: HALO_WIDTH,
          height: haloMeasuredCssHeight,
          scale,
        })
        : null;

      if (computed) {
        haloFlippedAbove = !!computed.flippedAbove;
        const hwin = ensureHaloWindow();
        if (hwin && !hwin.isDestroyed()) {
          applyZoomToWindow(hwin, scale);
          hwin.setBounds(computed.bounds);
          if (options.sendSnapshot !== false) sendHaloState(snapshot);
          showPanelInactive(hwin);
          const wasVisible = haloVisibleLogical;
          haloVisibleLogical = true;
          sendHaloVisibility(true);
          notifyReservedOffsetIfChanged();
          if (!wasVisible && typeof ctx.onQuotaSurfaceShown === "function") {
            try { ctx.onQuotaSurfaceShown("pet-halo-hover"); } catch {}
          }
        }
      }
    } else if (options.immediateHide) {
      hideHaloImmediate();
    } else {
      hideHaloAnimated();
    }

  }

  function cancelHoverOpenTimer() {
    if (!hoverOpenTimer) return;
    clearTimeout(hoverOpenTimer);
    hoverOpenTimer = null;
  }

  function stopAutoHidePoll() {
    if (!pollTimer) return;
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  function isCursorInsideHotZone() {
    if (surfaceHover.halo) return true;
    let cursor = null;
    try {
      cursor = screen.getCursorScreenPoint();
    } catch {
      cursor = null;
    }
    if (!cursor) return surfaceHover.pet;
    const follow = getPetFollowContext();
    if (!follow) return false;
    const scale = getTextScale();
    const haloBounds = haloWindow && !haloWindow.isDestroyed() && haloWindow.isVisible()
      ? haloWindow.getBounds()
      : null;
    const hotZone = computeHaloHotZone({
      petHitRect: follow.hitRect,
      haloBounds,
      pad: Math.round(HOT_ZONE_PAD * scale),
    });
    return pointInHaloHotZone(cursor, hotZone);
  }

  function runAutoHideTick() {
    pollTimer = null;
    if (!hoverActive) return;
    if (isSuppressed()) {
      hoverActive = false;
      syncSurfaces({ immediateHide: true, sendSnapshot: false });
      return;
    }
    const now = Date.now();
    if (isCursorInsideHotZone()) {
      visibleHoldUntil = now + HIDE_GRACE_MS;
      pollTimer = setTimeout(runAutoHideTick, AUTO_HIDE_POLL_MS);
      return;
    }
    if (now < visibleHoldUntil) {
      pollTimer = setTimeout(runAutoHideTick, AUTO_HIDE_POLL_MS);
      return;
    }
    hoverActive = false;
    surfaceHover.pet = false;
    surfaceHover.halo = false;
    syncSurfaces({ sendSnapshot: false });
  }

  function ensureAutoHidePoll() {
    visibleHoldUntil = Date.now() + HIDE_GRACE_MS;
    if (!pollTimer) {
      pollTimer = setTimeout(runAutoHideTick, AUTO_HIDE_POLL_MS);
    }
  }

  function activateHoverNow() {
    cancelHoverOpenTimer();
    if (isSuppressed()) return;
    latestSnapshot = getSnapshot();
    const alreadyActive = hoverActive;
    hoverActive = true;
    ensureAutoHidePoll();
    if (!alreadyActive || !haloVisibleLogical) {
      syncSurfaces({ snapshot: latestSnapshot, sendSnapshot: true });
    }
  }

  function handleHoverSignal(surface, hovered) {
    if (surface === "pet" || surface === "halo") {
      surfaceHover[surface] = !!hovered;
    }
    if (hovered) {
      if (isSuppressed()) return;
      if (hoverActive) {
        visibleHoldUntil = Date.now() + HIDE_GRACE_MS;
        if (hideAnimTimer) {
          clearTimeout(hideAnimTimer);
          hideAnimTimer = null;
          sendHaloVisibility(true);
        }
        ensureAutoHidePoll();
        return;
      }
      if (!hoverOpenTimer) {
        hoverOpenTimer = setTimeout(() => {
          hoverOpenTimer = null;
          if (isSuppressed()) return;
          if (surfaceHover.pet || surfaceHover.halo || isCursorInsideHotZone()) {
            activateHoverNow();
          }
        }, HOVER_OPEN_DELAY_MS);
      }
      return;
    }

    if (!surfaceHover.pet && !surfaceHover.halo && !hoverActive) {
      cancelHoverOpenTimer();
    }
  }

  function notifyImmediateSuppression() {
    cancelHoverOpenTimer();
    if (hoverActive) {
      hoverActive = false;
      stopAutoHidePoll();
      syncSurfaces({ immediateHide: true, sendSnapshot: false });
    }
  }

  function readReservedOffset() {
    if (!haloWindow || haloWindow.isDestroyed() || !haloWindow.isVisible() || !haloVisibleLogical) return 0;
    if (haloFlippedAbove) return 0;
    const scale = getTextScale();
    return scaleHeight(HALO_PET_GAP + haloMeasuredCssHeight + BUBBLE_GAP, scale);
  }

  function notifyReservedOffsetIfChanged() {
    const next = readReservedOffset();
    if (next === lastReservedOffset) return;
    lastReservedOffset = next;
    if (typeof ctx.onReservedOffsetChange === "function") ctx.onReservedOffsetChange(next);
  }

  function repositionSessionHud() {
    syncSurfaces({ sendSnapshot: false });
  }

  function broadcastSessionSnapshot(snapshot) {
    latestSnapshot = snapshot;
    syncSurfaces({ snapshot, sendSnapshot: true });
  }

  function sendI18n() {
    sendHaloState();
  }

  function handlePinnedChanged() {
    sendHaloState();
    syncSurfaces({ sendSnapshot: true });
  }

  function registerIpc(ipcMain) {
    if (!ipcMain) return;
    const on = (channel, fn) => {
      ipcMain.on(channel, fn);
      ipcDisposers.push(() => ipcMain.removeListener(channel, fn));
    };
    const handle = (channel, fn) => {
      ipcMain.handle(channel, fn);
      ipcDisposers.push(() => ipcMain.removeHandler(channel));
    };

    const isHaloSender = (event) => {
      if (!haloWindow || haloWindow.isDestroyed()) return false;
      return event && event.sender === haloWindow.webContents;
    };

    handle("pet-halo:get-state", (event) => {
      latestSnapshot = getSnapshot();
      return buildHaloStatePayload(latestSnapshot);
    });

    on("pet-halo:hover-surface", (_event, payload) => {
      if (!payload || typeof payload !== "object") return;
      handleHoverSignal(payload.surface, !!payload.hovered);
    });

    on("pet-halo:layout", (event, metrics) => {
      const nextHeight = Number(metrics.height);
      if (!Number.isFinite(nextHeight)) return;
      const clamped = clamp(Math.ceil(nextHeight), HALO_MIN_HEIGHT, HALO_MAX_HEIGHT);
      if (Math.abs(clamped - haloMeasuredCssHeight) < 2) return;
      haloMeasuredCssHeight = clamped;
      if (hoverActive) syncSurfaces({ sendSnapshot: false });
    });

    handle("pet-halo:action", async (event, payload) => {
      const type = payload.type;
      hoverActive = false;
      stopAutoHidePoll();
      // Hide the non-focusable halo panel synchronously before opening Command
      // or Workspace so a delayed 150ms halo.hide() never races with macOS key-window
      // activation of the newly opened window.
      if (type === "open-workspace" || type === "open-command") {
        hideHaloImmediate();
      } else {
        hideHaloAnimated();
      }
      if (type === "open-workspace" && typeof ctx.openDashboard === "function") {
        const view = typeof payload.view === "string" ? payload.view : undefined;
        ctx.openDashboard({ source: "halo", ...(view ? { view } : {}) });
        return { status: "ok" };
      }
      if (type === "open-command" && typeof ctx.openChat === "function") {
        ctx.openChat();
        return { status: "ok" };
      }
      if (type === "launch-client") {
        return launchAgentClientApp(String(payload.clientId || ""), {
          t: ctx.t,
          showDashboard: ctx.openDashboard,
          agentRegistry: ctx.agentRegistry,
        });
      }
      return { status: "error" };
    });

  }

  function cleanup() {
    cancelHoverOpenTimer();
    stopAutoHidePoll();
    if (hideAnimTimer) {
      clearTimeout(hideAnimTimer);
      hideAnimTimer = null;
    }
    while (ipcDisposers.length) {
      const dispose = ipcDisposers.pop();
      try { dispose(); } catch {}
    }
    if (haloWindow && !haloWindow.isDestroyed()) haloWindow.destroy();
    haloWindow = null;
    haloLoaded = false;
    haloVisibleLogical = false;
  }

  if (ctx.ipcMain) registerIpc(ctx.ipcMain);

  return {
    syncSessionHud: () => syncSurfaces({ sendSnapshot: true }),
    broadcastSessionSnapshot,
    repositionSessionHud,
    sendI18n,
    getHudReservedOffset: readReservedOffset,
    getWindow: () => haloWindow,
    handleHoverSignal,
    handlePinnedChanged,
    notifyImmediateSuppression,
    revealFromPet: activateHoverNow,
    cleanup,
  };
}

initPetHalo.__test = {
  computeHaloBounds,
  computeHaloHotZone,
  pointInHaloHotZone,
  pointInExpandedRect,
  buildBridgeRect,
  constants: {
    HALO_WIDTH,
    HALO_DEFAULT_HEIGHT,
    HALO_PET_GAP,
    EDGE_MARGIN,
    HOT_ZONE_PAD,
    HOVER_OPEN_DELAY_MS,
    HIDE_GRACE_MS,
  },
};

initPetHalo.launchAgentClientApp = launchAgentClientApp;
initPetHalo.MAC_AGENT_CLIENTS = MAC_AGENT_CLIENTS;

module.exports = initPetHalo;
