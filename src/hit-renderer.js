// --- Input window: pointer capture, drag, click detection ---
// This is the "controller" — all input decisions happen here.
// Render window is pure "view" — receives reaction commands via IPC relay.

const area = document.getElementById("hit-area");

// ── Theme config (injected via preload-hit.js additionalArguments) ──
let tc = window.hitThemeConfig || {};
let _reactions = (tc && tc.reactions) || {};

// ── Platform (injected via preload-hit.js additionalArguments) ──
const isMac = !!(window.hitPlatform && window.hitPlatform.isMac);

// Theme switch: IPC push overrides additionalArguments
if (window.hitAPI && window.hitAPI.onThemeConfig) {
  window.hitAPI.onThemeConfig((cfg) => {
    tc = cfg || {};
    _reactions = (tc && tc.reactions) || {};
  });
}

// --- State synced from main ---
let currentState = null;
let miniMode = false;
let dndEnabled = false;

window.hitAPI.onStateSync((data) => {
  if (data.currentState !== undefined) currentState = data.currentState;
  if (data.miniMode !== undefined) {
    miniMode = data.miniMode;
    area.style.cursor = miniMode ? "default" : "";
  }
  if (data.dndEnabled !== undefined) dndEnabled = data.dndEnabled;
});

// --- Drag state ---
let isDragging = false;
let didDrag = false;
let mouseDownX, mouseDownY;
let lastDragClientX;
let dragReactionDirection = null;
let dragMoveRAF = null;
const DRAG_THRESHOLD = 4;
let isHoveringPet = false;

function reportHover(next) {
  const flag = !!next;
  if (isHoveringPet === flag) return;
  isHoveringPet = flag;
  if (window.hitAPI && typeof window.hitAPI.setHovering === "function") {
    window.hitAPI.setHovering(flag);
  }
}

// --- Reaction state (tracked here to gate input) ---
let isReacting = false;
let isDragReacting = false;

// Cancel signal from main (e.g. state change)
window.hitAPI.onCancelReaction(() => {
  isReacting = false;
  isDragReacting = false;
  dragReactionDirection = null;
});

function queueDragMove() {
  if (dragMoveRAF !== null) return;
  dragMoveRAF = requestAnimationFrame(() => {
    dragMoveRAF = null;
    if (!isDragging) return;
    window.hitAPI.dragMove();
  });
}

function clearQueuedDragMove() {
  if (dragMoveRAF === null) return;
  cancelAnimationFrame(dragMoveRAF);
  dragMoveRAF = null;
}

// --- Pointer handlers ---
area.addEventListener("pointerenter", () => {
  if (!isDragging && !miniMode) reportHover(true);
});

area.addEventListener("pointerleave", () => {
  if (!isDragging) reportHover(false);
});

area.addEventListener("pointerdown", (e) => {
  if (e.button === 0) {
    if (miniMode) { didDrag = false; return; }
    area.setPointerCapture(e.pointerId);
    isDragging = true;
    didDrag = false;
    mouseDownX = e.clientX;
    mouseDownY = e.clientY;
    lastDragClientX = e.clientX;
    dragReactionDirection = null;
    window.hitAPI.dragLock(true);
    area.classList.add("dragging");
  }
});

document.addEventListener("pointermove", (e) => {
  if (!isDragging && !miniMode) {
    reportHover(true);
  }
  if (isDragging) {
    // A swallowed pointerup (UAC secure desktop, RDP reconnect, fullscreen
    // transition) leaves isDragging and the main-process drag lock stranded
    // while hover moves keep flowing. The first move with no pressed button
    // proves the physical gesture is over — finish through the normal stop
    // path (drag-lock false, drag-end if moved). A real drag always carries
    // buttons != 0, and a held-still mouse emits no moves at all, so a
    // genuine long press is never cut short by this.
    if (e.buttons === 0) {
      stopDrag();
      return;
    }
    if (!didDrag) {
      const totalDx = e.clientX - mouseDownX;
      const totalDy = e.clientY - mouseDownY;
      if (Math.abs(totalDx) > DRAG_THRESHOLD || Math.abs(totalDy) > DRAG_THRESHOLD) {
        didDrag = true;
        reportHover(false);
        startDragReaction(totalDx < 0 ? "left" : (totalDx > 0 ? "right" : null));
      }
    } else {
      const stepDx = e.clientX - lastDragClientX;
      if (stepDx !== 0) startDragReaction(stepDx < 0 ? "left" : "right");
    }
    lastDragClientX = e.clientX;
    queueDragMove();
  }
});

function stopDrag() {
  if (!isDragging) return;
  clearQueuedDragMove();
  isDragging = false;
  window.hitAPI.dragLock(false);
  area.classList.remove("dragging");
  if (didDrag) {
    window.hitAPI.dragEnd();
  }
  // A state-change cancel can arrive after pointer movement and clear the
  // input window's local reaction flag. The render window may already have
  // received startDragReaction, so an actual drag must still complete the
  // end handshake on pointerup/cancel/lost capture/blur.
  endDragReaction(didDrag);
}

document.addEventListener("pointerup", (e) => {
  if (e.button !== 0) return;
  const wasDrag = didDrag;
  stopDrag();
  if (wasDrag) return;

  // macOS Ctrl-click belongs to the native context-menu gesture.
  if (isMac && e.ctrlKey && !e.metaKey) return;
  const modClick = isMac ? !!e.metaKey : !!e.ctrlKey;
  if (modClick && window.hitAPI && typeof window.hitAPI.showDashboard === "function") {
    window.hitAPI.showDashboard();
    return;
  }
  if (miniMode) {
    window.hitAPI.exitMiniMode();
    return;
  }
  if (window.hitAPI && typeof window.hitAPI.openChat === "function") {
    window.hitAPI.openChat();
  }
});

area.addEventListener("pointercancel", () => stopDrag());
area.addEventListener("lostpointercapture", () => { if (isDragging) stopDrag(); });
window.addEventListener("blur", stopDrag);

// Main released the lock because a user-invoked recovery ran (bring to
// primary display / send to display / hide show). If this renderer is alive
// and still holding a phantom capture, drop it through the normal stop path
// so gesture state, drag reaction and the input gate all unwind together.
window.hitAPI.onForceDragRelease(() => {
  if (isDragging) stopDrag();
});

// Reaction helpers shared by drag and the built-in renderer test events.
function _getReaction(name) {
  return _reactions[name] || null;
}

function canPlayReactionNow() {
  return currentState === "idle" && !dndEnabled && !isReacting;
}

function playReaction(svg, duration) {
  if (!svg) return;
  isReacting = true;
  window.hitAPI.playClickReaction(svg, duration);
  // Local timer to ungate input after duration
  setTimeout(() => { isReacting = false; }, duration);
}

// --- Drag reaction ---
function startDragReaction(direction) {
  if (dndEnabled) return;
  if (isDragReacting && dragReactionDirection === direction) return;

  if (isReacting) {
    isReacting = false;
  }

  isDragReacting = true;
  dragReactionDirection = direction;
  window.hitAPI.startDragReaction(direction);
}

function endDragReaction(force = false) {
  if (!isDragReacting && !force) return;
  isDragReacting = false;
  dragReactionDirection = null;
  window.hitAPI.endDragReaction();
}

// --- OS file drop → open terminal at that directory (#459, Windows/Linux only) ---
// macOS is OUT: the pet windows live at screen-saver level so they stay above
// fullscreen apps, and macOS drag-destination search never delivers drag
// events to windows at that level (real-machine bisect, 2026-06-11 — lowering
// only the hit window doesn't help either, the overlapping screen-saver render
// window still blocks the search; ignoresMouseEvents passes mouse events
// through but NOT drag destinations). Don't re-attempt without changing the
// window-level model; listeners are simply not registered on mac.
//
// Affordance gating lives HERE (not only in main): in mini mode dragover must
// not preventDefault, so the OS shows "no drop" instead of a copy cursor that
// would then do nothing. Main re-checks mini (and platform) as the second layer.
function dragHasFiles(e) {
  const types = e.dataTransfer && e.dataTransfer.types;
  if (!types) return false;
  for (const t of types) { if (t === "Files") return true; }
  return false;
}

if (!isMac) {
  area.addEventListener("dragover", (e) => {
    if (miniMode || !dragHasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });

  area.addEventListener("drop", (e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    if (miniMode) return;
    const paths = [];
    for (const file of e.dataTransfer.files || []) {
      const p = window.hitAPI.getPathForFile(file);
      if (typeof p === "string" && p) paths.push(p);
    }
    if (paths.length) window.hitAPI.dropPaths(paths);
  });

  // Main confirmed the drop opened a terminal → react. Routed back through the
  // local playReaction so isReacting gating stays consistent. Best-effort with a
  // fallback chain: double (Clawd) → clickLeft/clickRight poke (Calico) →
  // nothing (Cloudling only ships a drag reaction; no new theme capability is
  // invented for drops).
  window.hitAPI.onDropAccepted(() => {
    if (!canPlayReactionNow()) return;
    const doubleReact = _getReaction("double");
    if (doubleReact) {
      const files = doubleReact.files || [doubleReact.file];
      playReaction(files[Math.floor(Math.random() * files.length)], doubleReact.duration || 3500);
      return;
    }
    const left = _getReaction("clickLeft");
    const right = _getReaction("clickRight");
    const poke = left && right ? (Math.random() < 0.5 ? left : right) : (left || right);
    if (poke) playReaction(poke.file, poke.duration || 2500);
  });
}

// --- Right-click context menu ---
// #1260: a menu popped mid-drag runs a modal loop that takes the OS mouse
// capture and swallows the closing pointerup, and while dragLocked is held
// syncHitWin() keeps the input window at its pre-drag rect. After the menu
// closes no pointer event reaches this renderer again (capture is gone and
// the cursor sits over the pet's new position, off the stale input rect), so
// the buttons=0 move self-heal can never fire and the drag strand is
// permanent — pet frozen in the drag pose, input window stranded at the old
// rect, right-click falling through to whatever is underneath. Ending the
// drag through the normal stop path BEFORE the menu opens leaves nothing to
// strand regardless of what the menu loop swallows.
document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (isDragging) stopDrag();
  reportHover(false);
  window.hitAPI.showContextMenu();
});
