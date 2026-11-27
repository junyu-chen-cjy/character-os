"use strict";

const { canOfferLocalFolder, focusUnavailableReasonKey } = globalThis.ClawdSessionFocusUnavailable;
const { createLanguagePicker } = globalThis.ClawdLanguagePicker;

const AGENT_LABELS = {
  "claude-code": "Claude Code",
  codex: "Codex",
  "copilot-cli": "Copilot",
  "cursor-agent": "Cursor Agent",
  "gemini-cli": "Gemini",
  "antigravity-cli": "Antigravity",
  "kiro-cli": "Kiro",
  "kimi-cli": "Kimi",
  opencode: "opencode",
  mimocode: "MiMo Code",
  codebuddy: "CodeBuddy",
  workbuddy: "WorkBuddy",
  "grok-build": "Grok Build",
  pi: "Pi",
  openclaw: "OpenClaw",
};

let snapshot = { sessions: [], groups: [], orderedIds: [] };
let i18nPayload = { lang: "en", translations: {} };
let activeEdit = null;

const SESSION_FOLDER_FEEDBACK_MS = 4000;
const sessionFolderActionState = new Map();
const sessionTerminalActionState = new Map();
const sessionAutomationActionState = new Map();
let sessionAutomationPickers = [];

const titleEl = document.getElementById("title");
const countEl = document.getElementById("count");
const contentEl = document.getElementById("content");
const quotaSummaryEl = document.getElementById("quotaSummary");
// Fixed node in the header. Keeping the mode banner outside the card tree
// means entering the mode never reflows or rebuilds the user's content.
const quickBannerEl = document.getElementById("quickBanner");

// Optional Workspace Control Center nodes (null in legacy minimal test harnesses).
const wsBodyEl = document.getElementById("wsBody");
const wsStatusDotEl = document.getElementById("wsStatusDot");
const wsNavEl = document.getElementById("wsNav");
const wsBtnCommandEl = document.getElementById("wsBtnCommand");
const wsLblCommandEl = document.getElementById("wsLblCommand");
const wsBtnCodexEl = document.getElementById("wsBtnCodex");
const wsBtnAntigravityEl = document.getElementById("wsBtnAntigravity");
const wsBtnSettingsEl = document.getElementById("wsBtnSettings");
const wsLblSettingsEl = document.getElementById("wsLblSettings");
const wsQuotasPanelEl = document.getElementById("wsQuotasPanel");
const wsReadGeminiQuota = document.getElementById("wsReadGeminiQuota");
const wsGeminiQuotaStatus = document.getElementById("wsGeminiQuotaStatus");
let geminiQuotaStatus = "quotaReadInstructions";
let readingGeminiQuota = false;
const wsQuotaTitleEl = document.getElementById("wsQuotaTitle");
const wsGeminiChatControls = document.getElementById("wsGeminiChatControls");
const wsGeminiChatStatus = document.getElementById("wsGeminiChatStatus");
const wsOpenGeminiUsage = document.getElementById("wsOpenGeminiUsage");
const wsQuotaFallbackEl = document.getElementById("wsQuotaFallback");
const wsRuntimeTitleEl = document.getElementById("wsRuntimeTitle");
const wsBtnManageAgentsEl = document.getElementById("wsBtnManageAgents");
const wsRuntimeListEl = document.getElementById("wsRuntimeList");

let workspaceView = "overview";
let workspaceCtx = null;
let workspaceCtxPending = false;
let lastWorkspaceRailSig = "";

const WS_STRINGS = {
  en: {
    quotaRefreshAll: "Refresh all quotas",
    quotaRefreshingAll: "Refreshing…",
    quotaRefreshDone: "Quotas refreshed.",
    quotaRefreshPartial: "Some sources could not refresh.",
    quotaStatusRefreshing: "Refreshing…",
    quotaStatusAuthRequired: "Sign-in required",
    quotaStatusFailed: "Refresh failed",
    quotaStatusExtension: "Chrome extension background sync",
    quotaReadGemini: "Refresh all quotas",
    quotaReadInstructions: "In Gemini Antigravity, reopen the model picker → View Usage and wait for it to refresh.",
    quotaReadOk: "Antigravity quota refreshed.",
    quotaAutoReady: "Antigravity refreshes in the background using the official CLI.",
    quotaAutoUnavailable: "Waiting for Gemini in Antigravity mode.",
    quotaUnchanged: "The open panel has the same reading.",
    quotaStale: "Stale",
    quotaPendingReset: "Reset not yet confirmed",
    quotaWindowDisabled: "Not available",
    quotaDisabledShort: "N/A",
    quotaUnknown: "Unknown",
    quotaSvcCodex: "Codex Agent",
    quotaSvcAgGemini: "Antigravity · Gemini",
    quotaSvcAgThird: "Antigravity · Claude / GPT",
    quotaSvcGeminiChat: "Gemini Chat",
    quotaUpdatedAt: "Updated {time}",
    geminiChat: "Gemini Chat",
    geminiChatUsage: "Open Gemini Usage Limits",
    geminiChatWaiting: "The Character OS Chrome extension refreshes Gemini Chat in the background.",
    geminiChatWatching: "Gemini Chat is syncing from the official Usage Limits page.",
    quotaReadAt: "Read {time}",
    quotaPermission: "Grant Character OS access in macOS Privacy & Security → Accessibility.",
    quotaOpenGemini: "Open Gemini App in Antigravity mode first.",
    quotaRefreshing: "Wait for View Usage to finish refreshing.",
    quotaUnrecognized: "No supported quota figures were exposed by the open panel. Previous readings are retained.",
    quotaTryLater: "Wait a few seconds and try again.",
    quotaReadFailed: "Unable to read Gemini Antigravity quota.",
    workspaceTitle: "Workspace",
    navOverview: "Overview",
    navSessions: "Sessions",
    navProjects: "Projects",
    navQuotas: "Quotas",
    cmdButton: "Command",
    settingsButton: "Settings",
    quotasTitle: "AI Service Quotas",
    quotaNoData: "No data",
    quotaFallback: "No live quota telemetry yet.",
    runtimeTitle: "Connections",
    manageAgents: "Manage",
    localService: "Local State Service",
    serviceRunning: "Running · Port {port}",
    serviceOffline: "Unavailable",
    agentReady: "Connected",
    agentPaused: "Paused",
    agentUninstalled: "Hooks off",
    approvalsTitle: "Pending Approvals ({n})",
    revealBubble: "Show Prompt",
    projectsTitle: "Projects",
    projectsEmpty: "No project directories recorded yet.",
    projectActiveCount: "{n} active",
    projectRecentCount: "{n} recent",
    focusSession: "Focus",
    remainingShort: "{pct}% left",
    emptyTitle: "Nothing running",
    emptyBody: "Agent sessions appear here as soon as they start.",
    running: "{n} running",
    awaiting: "{n} awaiting approval",
    idle: "Idle",
    readNow: "Read now",
    reading: "Reading…",
    readAt: "Read {time}",
    projectsMore: "All projects",
    agentClientsTitle: "Agent Clients",
    agentSessionsTitle: "Desktop & CLI Sessions",
    refreshClients: "Refresh",
    refreshingClients: "Refreshing…",
    clientOnline: "Online",
    clientRunning: "Running task",
    clientAwaiting: "Awaiting approval",
    clientOffline: "Offline",
    clientNotInstalled: "Not installed",
    clientOpen: "Open",
    clientFocus: "Focus",
    clientSessionCount: "{n} session(s)",
    clientActiveDraft: "Current blank chat",
    clientNoActiveSession: "No active conversation",
    kindDesktop: "Desktop",
    kindCli: "CLI",
    badgeCurrent: "Current",
    badgeBlankDraft: "Blank draft",
    badgeResumable: "Resumable",
    stageLocated: "Located",
    stageConfirmed: "Confirmed",
    stageDelivered: "Delivered",
    stageStarted: "Running",
    stageAwaitingApproval: "Awaiting approval",
    stageCompleted: "Completed",
    stageFailed: "Delivery failed",
    axLabel: "macOS Accessibility",
    axTrusted: "Authorized",
    axMissing: "Permission needed",
    axTitle: "macOS Accessibility permission required",
    axBody: "Grant {app} access in macOS Privacy & Security → Accessibility to inspect active desktop conversations and deliver delegated tasks.",
    axDevNote: "Running in development mode — authorize Electron.app below (re-toggle if updated).",
    axOpenSettings: "Open Accessibility Settings",
    axRevealApp: "Show App in Finder",
    axRecheck: "Re-check",
  },
  zh: {
    quotaRefreshAll: "刷新全部额度",
    quotaRefreshingAll: "刷新中…",
    quotaRefreshDone: "全部可刷新额度已更新。",
    quotaRefreshPartial: "部分服务刷新失败，已保留最后一次读数。",
    quotaStatusRefreshing: "正在刷新…",
    quotaStatusAuthRequired: "登录已失效",
    quotaStatusFailed: "刷新失败",
    quotaStatusExtension: "由 Chrome 扩展后台同步",
    quotaReadGemini: "刷新全部额度",
    quotaReadInstructions: "请在 Gemini 的 Antigravity 模型菜单重新打开 View Usage，等刷新完成后读取。",
    quotaReadOk: "Antigravity 额度已刷新。",
    quotaAutoReady: "Antigravity 通过官方 CLI 在后台自动刷新。",
    quotaAutoUnavailable: "等待 Gemini 打开 Antigravity。",
    quotaUnchanged: "面板中的读数未变化。",
    quotaStale: "已过期",
    quotaPendingReset: "尚未确认重置",
    quotaWindowDisabled: "已停用（不适用）",
    quotaDisabledShort: "停用",
    quotaUnknown: "未知",
    quotaSvcCodex: "Codex Agent",
    quotaSvcAgGemini: "Antigravity · Gemini",
    quotaSvcAgThird: "Antigravity · Claude / GPT",
    quotaSvcGeminiChat: "Gemini 日常聊天",
    quotaUpdatedAt: "更新于 {time}",
    geminiChat: "Gemini 日常聊天",
    geminiChatUsage: "打开 Gemini 用量页",
    geminiChatWaiting: "Character OS Chrome 扩展在后台自动刷新 Gemini 聊天额度。",
    geminiChatWatching: "Gemini 聊天额度已从官方用量限额页同步。",
    quotaReadAt: "读取于 {time}",
    quotaPermission: "请在 macOS「隐私与安全性 → 辅助功能」中授权 Character OS。",
    quotaOpenGemini: "请先打开 Gemini App 并进入 Antigravity。",
    quotaRefreshing: "请等 View Usage 刷新完成。",
    quotaUnrecognized: "该面板未提供可识别的额度数据。已有读数仍保留。",
    quotaTryLater: "请稍等几秒再试。",
    quotaReadFailed: "无法读取 Gemini Antigravity 额度。",
    workspaceTitle: "工作台",
    navOverview: "总览",
    navSessions: "会话",
    navProjects: "项目",
    navQuotas: "额度",
    cmdButton: "指令",
    settingsButton: "设置",
    quotasTitle: "AI 服务额度",
    quotaNoData: "暂无数据",
    quotaFallback: "暂无实时额度数据。",
    runtimeTitle: "服务与连接",
    manageAgents: "管理",
    localService: "本地状态服务",
    serviceRunning: "运行中 · 端口 {port}",
    serviceOffline: "未连接",
    agentReady: "已启用",
    agentPaused: "已暂停",
    agentUninstalled: "未安装",
    approvalsTitle: "待处理审批 ({n})",
    revealBubble: "显示审批",
    projectsTitle: "项目目录",
    projectsEmpty: "暂无已记录的本地项目目录。",
    projectActiveCount: "{n} 个活跃会话",
    projectRecentCount: "{n} 条近期记录",
    focusSession: "跳转",
    remainingShort: "剩余 {pct}%",
    emptyTitle: "暂无运行中的会话",
    emptyBody: "Agent 会话一开始就会出现在这里。",
    running: "{n} 个运行中",
    awaiting: "{n} 个待审批",
    idle: "空闲",
    readNow: "立即读取",
    reading: "读取中…",
    readAt: "读取于 {time}",
    projectsMore: "全部项目",
    agentClientsTitle: "Agent 客户端",
    agentSessionsTitle: "桌面与 CLI 会话",
    refreshClients: "刷新",
    refreshingClients: "刷新中…",
    clientOnline: "在线",
    clientRunning: "运行任务中",
    clientAwaiting: "等待审批",
    clientOffline: "离线",
    clientNotInstalled: "未安装",
    clientOpen: "打开",
    clientFocus: "切换过去",
    clientSessionCount: "{n} 个会话",
    clientActiveDraft: "当前空白对话",
    clientNoActiveSession: "暂无活跃对话",
    kindDesktop: "桌面",
    kindCli: "CLI",
    badgeCurrent: "当前显示",
    badgeBlankDraft: "当前空白对话",
    badgeResumable: "可恢复",
    stageLocated: "已定位",
    stageConfirmed: "已确认",
    stageDelivered: "已投递",
    stageStarted: "执行中",
    stageAwaitingApproval: "待审批",
    stageCompleted: "已完成",
    stageFailed: "投递失败",
    axLabel: "macOS 辅助功能",
    axTrusted: "已授权",
    axMissing: "需要授权",
    axTitle: "需要 macOS 辅助功能权限",
    axBody: "请在「系统设置 → 隐私与安全性 → 辅助功能」中勾选 {app}，以识别 Codex / Antigravity 当前对话并向目标会话可靠发送消息。",
    axDevNote: "当前处于开发运行模式，请在列表中授权下方 Electron.app（如已添加可取消后重新勾选）。",
    axOpenSettings: "打开辅助功能设置",
    axRevealApp: "在 Finder 中显示应用",
    axRecheck: "重新检测",
  },
};

function wt(key) {
  const lang = (i18nPayload && i18nPayload.lang) || "en";
  const bucket = String(lang).startsWith("zh") ? WS_STRINGS.zh : WS_STRINGS.en;
  return bucket[key] || WS_STRINGS.en[key] || key;
}

// ── Dashboard keyboard mode ─────────────────────────────────────────────────
// A temporary state of this same page: same DOM, same drafts, same scroll.
// Digits own session IDs for the whole round (never list indices), so a
// snapshot arriving mid-round can disable a number but never reassign it.
const QUICK_HANDOFF_QUIET_MS = 120;
const quick = {
  revision: 0,
  entries: [],
  active: false,
  // Digits are only captured when the round actually froze candidates. An
  // empty round still opens the Dashboard, it just captures nothing.
  capture: false,
  // A busy replacement may leave an unarmed editor on the borrowed host.
  canDismissBorrow: false,
  pending: false,
  pendingId: null,
  feedbackKey: "",
  hintKey: "",
  // Bumped on every cancel/exit so a late timer or in-flight IPC reply from an
  // abandoned attempt can never activate anything.
  generation: 0,
  // Bumped whenever a round is started, refused or ended. An `enter`/`ready`
  // reply that arrives after its round was abandoned must not revive it, and
  // comparing revisions alone cannot detect that (a dismissal leaves the
  // revision in place so a stale `dismissed` can still be matched).
  roundSeq: 0,
  // Frozen presentation for the round: which group held which id, in which
  // order, at the moment the round started. Discarded when the round ends.
  skeleton: null,
  held: new Set(),
  timer: null,
};
let composing = false;

// ── Scroll continuity across a host transfer ────────────────────────────────
// Observed on Windows (#972): after the mode borrowed this page and handed it
// back, `#content` was at exactly 0. Same WebContents, same document token,
// same group/card order and same scrollHeight before and after — but *which*
// step drops the offset is not established. The card tree is rebuilt
// (replaceChildren) on every render, the view is re-parented between two native
// hosts, the host size changes and focus moves; the evidence does not single
// any of them out, and this page cannot see below itself to find out. So this
// is a repair, not a prevention, and it is deliberately narrow:
//
//   * `top` is the position the user last chose. A landing on exactly 0 that no
//     user gesture produced never overwrites it.
//   * `armed` is only true while a transfer is plausible: from the start of a
//     round until the round has ended and one settling signal has arrived.
//     Outside that window nothing is ever repaired.
//   * a repair only fires at exactly 0, only while armed, only when the content
//     is still tall enough, and it clamps to the current maximum.
//   * a scroll the user asked for always wins, including a scroll to the top.
//     Chromium turns one wheel notch into a whole animation — a scroll event
//     per frame, only the first of which sits next to an input event — so what
//     is tracked is the *gesture* (wheel / scrolling keys; the keys
//     come from the document-capture handler, so a key that never reaches this
//     element still counts), and every frame it produces belongs to the user.
//     A gesture ends at `scrollend` or when a movement reverses it. Pointer
//     holds are separate: a plain click must not leave a gesture waiting for
//     a scrollend that will never come. Drag positions belong to the user
//     until release, including a last position whose scroll event is queued.
//
// The repair rides the scroll/resize signals the transfer itself produces plus
// the round's own IPC boundaries — no timers and no retry loops, which could
// otherwise land on top of a scroll the user made in the meantime.
const SCROLL_INTENT_KEYS = new Set([
  "PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " ", "Spacebar",
]);
// Native keyboard semantics only, not the feature's platform-availability gate.
// On macOS bare Home scrolls the page even while a text input owns focus; on
// Windows that same key moves the caret and must not open a page gesture.
const MAC_INPUT_HOME_SCROLL = typeof navigator !== "undefined"
  && /^Mac/.test(navigator.platform || "");
const scrollGuard = {
  armed: false,
  // The round ended: stay armed for the return transfer, then close on the
  // first signal after it so nothing is repaired indefinitely.
  settling: false,
  top: 0,
  // A scroll the user started that has not finished yet.
  gesture: false,
  // Which way that gesture is moving (-1 up, 1 down, 0 = not moved yet).
  gestureDir: 0,
  // A pointer is still down, so the whole drag is theirs whatever it does.
  held: false,
};
let restoringScroll = false;

function scrollMetrics() {
  if (!contentEl) return null;
  const top = contentEl.scrollTop;
  const scrollHeight = contentEl.scrollHeight;
  const clientHeight = contentEl.clientHeight;
  if (!Number.isFinite(top) || !Number.isFinite(scrollHeight) || !Number.isFinite(clientHeight)) {
    return null;
  }
  return { top, max: Math.max(0, scrollHeight - clientHeight) };
}

// The user started a scroll. Each input event opens a fresh gesture, so a
// direction change (wheel down, then up) is not read as a reversal.
function noteScrollIntent() {
  scrollGuard.gesture = true;
  scrollGuard.gestureDir = 0;
}

function endScrollGesture() {
  scrollGuard.gesture = false;
  scrollGuard.gestureDir = 0;
}

function endScrollHold() {
  if (!scrollGuard.held) return;
  // The last drag offset can be applied before its scroll event is delivered.
  // Capture it while the pointer still owns it, without ending an independent
  // wheel/key animation or recording releases that started outside content.
  const metrics = scrollMetrics();
  if (metrics) scrollGuard.top = metrics.top;
  scrollGuard.held = false;
}

// Whether this scroll event is another frame of the gesture that is running.
// Chromium animates one wheel notch into a sequence of scroll events that moves
// steadily one way, so a same-direction move continues the gesture and a
// reversal ends it. `scrollend` ends it properly where the event is available.
function scrollContinuesGesture(top) {
  if (!scrollGuard.gesture) return false;
  const delta = top - scrollGuard.top;
  // No movement attributes nothing, and must not end a running animation.
  if (delta === 0) return false;
  const direction = delta > 0 ? 1 : -1;
  if (scrollGuard.gestureDir === 0) {
    scrollGuard.gestureDir = direction;
    return true;
  }
  if (scrollGuard.gestureDir === direction) return true;
  endScrollGesture();
  return false;
}

// From here on a transfer can move this page between hosts.
function armScrollGuard() {
  scrollGuard.armed = true;
  scrollGuard.settling = false;
  const metrics = scrollMetrics();
  // A 0 here is either a top the user already chose (recorded when it happened)
  // or an offset a transfer already dropped; neither is worth re-recording.
  if (metrics && metrics.top !== 0) scrollGuard.top = metrics.top;
}

// The round is over. Main returns the view to the ordinary host *before* it
// tells this page, so the return transfer can land first: stay armed for it.
function settleScrollGuard() {
  armScrollGuard();
  scrollGuard.settling = true;
}

function closeScrollGuard() {
  scrollGuard.armed = false;
  scrollGuard.settling = false;
}

// One signal that the scroller may have moved: a scroll event, a layout change
// or a transfer that just reported back.
function handleScrollSignal(options = {}) {
  if (restoringScroll) return false;
  const metrics = scrollMetrics();
  if (!metrics) {
    closeScrollGuard();
    return false;
  }
  // Only a scroll event can belong to a gesture; a layout signal or an IPC
  // reply never does, and must not end one either.
  const userOwned = options.fromScrollEvent === true
    && (scrollGuard.held || scrollContinuesGesture(metrics.top));
  if (!scrollGuard.armed) {
    // No transfer is possible right now, so wherever the page sits is simply
    // where the user is.
    scrollGuard.top = metrics.top;
    return false;
  }
  let repaired = false;
  if (metrics.top !== 0 || userOwned) {
    // A real position: the user's own, or a legitimate clamp.
    scrollGuard.top = metrics.top;
  } else if (scrollGuard.top > 0 && metrics.max > 0) {
    restoringScroll = true;
    try {
      contentEl.scrollTop = Math.min(scrollGuard.top, metrics.max);
    } finally {
      restoringScroll = false;
    }
    const after = scrollMetrics();
    if (after) scrollGuard.top = after.top;
    repaired = true;
  }
  if (scrollGuard.settling) closeScrollGuard();
  return repaired;
}

function isEditableElement(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el.isContentEditable === true;
}

// The single busy predicate. It is answered before anything native moves,
// because the host transfer itself blurs a focused alias input and would
// commit a half-typed draft.
function isEditingBusy() {
  if (activeEdit) return true;
  if (composing) return true;
  return isEditableElement(document.activeElement);
}

function quickDigitForSession(sessionId) {
  if (!quick.active || !quick.capture || !sessionId) return 0;
  const index = quick.entries.findIndex((entry) => entry.id === sessionId);
  return index === -1 ? 0 : index + 1;
}

function clearQuickTimer() {
  if (quick.timer !== null) clearTimeout(quick.timer);
  quick.timer = null;
}

// Drop any not-yet-sent jump without touching the round itself.
function cancelPendingActivation() {
  clearQuickTimer();
  quick.generation += 1;
  quick.held = new Set();
  quick.pending = false;
  quick.pendingId = null;
}

function endQuickRound() {
  cancelPendingActivation();
  // Invalidate the round itself so any enter/ready reply still in flight is
  // discarded instead of re-arming a round the user already left.
  quick.roundSeq += 1;
  quick.active = false;
  quick.capture = false;
  quick.canDismissBorrow = false;
  quick.entries = [];
  // Dropping the skeleton restores the ordinary dynamic ordering.
  quick.skeleton = null;
  quick.feedbackKey = "";
  quick.hintKey = "";
  renderQuickBanner();
  render();
  // After this round's own repaint, so the settle window is not closed by it:
  // the page may still be on its way back to the ordinary host, because main
  // returns the view before it sends the dismissal.
  settleScrollGuard();
}

function setQuickHint(key) {
  quick.hintKey = key || "";
  renderQuickBanner();
}

function setQuickFeedback(key) {
  quick.feedbackKey = key || "";
  renderQuickBanner();
}

function renderQuickBanner() {
  // Busy negotiation must not rebuild an editor just to remove old digits.
  // Hide their paint without changing card geometry or the focused input.
  if (contentEl) contentEl.classList.toggle("is-quick-capture", quick.active && quick.capture);
  if (!quickBannerEl) return;
  const message = quick.feedbackKey || quick.hintKey
    || (quick.active ? "dashboardQuickSelectHint" : "");
  if (!message) {
    quickBannerEl.hidden = true;
    quickBannerEl.textContent = "";
    quickBannerEl.classList.remove("is-active");
    return;
  }
  quickBannerEl.hidden = false;
  quickBannerEl.textContent = t(message);
  quickBannerEl.classList.toggle("is-active", quick.active);
}

async function beginQuickRound(revision) {
  if (!Number.isInteger(revision) || revision <= 0) return;
  // Only main issues rounds and only ever forward; a stale or repeated intent
  // can never reopen a finished round.
  if (revision <= quick.revision) return;
  quick.revision = revision;
  cancelPendingActivation();
  quick.roundSeq += 1;
  const seq = quick.roundSeq;
  quick.active = false;
  quick.capture = false;
  quick.canDismissBorrow = false;
  quick.entries = [];
  quick.skeleton = null;
  quick.feedbackKey = "";
  quick.hintKey = "";
  renderQuickBanner();

  let result;
  try {
    result = await window.dashboardAPI.quickEnter({ revision, busy: isEditingBusy() });
  } catch {
    result = null;
  }
  // The round was superseded, dismissed or invalidated while we waited.
  if (!result || seq !== quick.roundSeq || revision !== quick.revision) return;
  if (result.status !== "ok" && result.status !== "empty") {
    // Busy: this press is refused outright. The draft/IME/select keeps its
    // keyboard, nothing is armed, and the user presses the shortcut again once
    // the edit is finished. Do NOT force a render here — a forced rebuild
    // re-creates the alias input and re-selects the whole draft.
    if (result.status === "busy") {
      quick.canDismissBorrow = result.retainedBorrow === true;
      setQuickHint("dashboardQuickSelectBusy");
    }
    return;
  }
  quick.entries = Array.isArray(result.entries) ? result.entries : [];
  quick.capture = result.status === "ok" && quick.entries.length > 0;
  quick.active = true;
  // Pin the layout the user is already looking at before the first render of
  // the round, so entering the mode never rearranges existing cards.
  quick.skeleton = quick.capture ? captureQuickSkeleton() : null;
  quick.feedbackKey = "";
  quick.hintKey = quick.capture ? "" : "dashboardQuickSelectEmpty";

  // Editing may have started while `enter` was in flight. Nothing native has
  // moved yet, so tell main to abandon the round rather than transfer a page
  // whose detach would blur the input and commit its draft.
  if (isEditingBusy()) {
    quick.active = false;
    quick.capture = false;
    quick.entries = [];
    quick.skeleton = null;
    setQuickHint("dashboardQuickSelectBusy");
    try {
      const refused = await window.dashboardAPI.quickReady({ revision, busy: true });
      if (seq !== quick.roundSeq || revision !== quick.revision) return;
      quick.canDismissBorrow = refused && refused.status === "busy" && refused.retainedBorrow === true;
    } catch { /* main also ends the round on blur/close. */ }
    return;
  }

  // Paint the digits into the existing page before the quick host appears.
  // Everything from here on can move this page to another native host, so
  // remember where the user is first.
  armScrollGuard();
  renderQuickBanner();
  render({ force: true });
  let readyResult;
  try {
    readyResult = await window.dashboardAPI.quickReady({ revision, busy: false });
  } catch {
    readyResult = null;
  }
  if (seq !== quick.roundSeq) return;
  // Main refused or could not arm the round: drop the local mode so the page
  // never shows digits that cannot be activated.
  if (!readyResult || (readyResult.status !== "ok")) {
    endQuickRound();
    return;
  }
  // The page is on its new host. If the move dropped the offset before this
  // reply, no later scroll or layout signal is coming to report it.
  handleScrollSignal();
}

function dismissQuickRound() {
  const revision = quick.revision;
  cancelPendingActivation();
  if (!revision) return;
  try {
    const pending = window.dashboardAPI.quickDismiss({ revision });
    if (pending && typeof pending.catch === "function") pending.catch(() => {});
  } catch {
    /* main also ends the round on blur/close. */
  }
  endQuickRound();
}

// Main-key row and numpad are tracked as distinct physical keys so holding one
// while tapping the other cannot fire early.
function physicalDigit(event) {
  if (/^(Digit|Numpad)[1-9]$/.test(event.code || "")) return event.code;
  return /^[1-9]$/.test(event.key) ? `key:${event.key}` : null;
}

function armQuickHandoff() {
  clearQuickTimer();
  if (!quick.pending || quick.held.size > 0) return;
  const attempt = quick.generation;
  const sessionId = quick.pendingId;
  const seq = quick.roundSeq;
  quick.timer = setTimeout(async () => {
    quick.timer = null;
    if (!quick.active || !quick.capture) return;
    if (quick.generation !== attempt || quick.roundSeq !== seq) return;
    // Re-validate the safe state at submit time, not only at keydown: an
    // input, select or IME composition may have taken focus during the quiet
    // period, and a jump must never fire out from under it.
    if (isEditingBusy()) {
      quick.pending = false;
      return;
    }
    const entry = quick.entries.find((item) => item.id === sessionId);
    if (!entry || !entry.canFocus) {
      quick.pending = false;
      setQuickFeedback("dashboardQuickSelectUnavailable");
      return;
    }
    let result;
    try {
      result = await window.dashboardAPI.quickActivate({ sessionId, revision: quick.revision });
    } catch {
      result = { status: "rejected" };
    }
    if (quick.generation !== attempt || quick.roundSeq !== seq) return;
    quick.pending = false;
    if (result && result.status === "submitted") {
      // Handed to the production focus path — not confirmed, not acked. Main
      // keeps the quick host up until the native blur completes the handoff.
      setQuickFeedback("dashboardQuickSelectSubmitted");
    } else if (result && result.reason === "dropped-duplicate") {
      setQuickFeedback("dashboardQuickSelectAlreadyRequested");
    } else {
      setQuickFeedback("dashboardQuickSelectUnavailable");
    }
  }, QUICK_HANDOFF_QUIET_MS);
}

function handleQuickKeydown(event) {
  // Scroll intent first, and before the round check: this handler is on
  // document capture, so it is the one place that sees a scrolling key no
  // matter which element it is aimed at (the scroller itself is not focusable,
  // so such a key often targets body). It must never change what the mode does
  // with the key.
  const buttonSpace = event && (event.key === " " || event.key === "Spacebar")
    && event.target && event.target.tagName === "BUTTON";
  const macInputHome = MAC_INPUT_HOME_SCROLL && event && event.key === "Home"
    && event.target && event.target.tagName === "INPUT"
    && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
  if (event && SCROLL_INTENT_KEYS.has(event.key)
    && !event.defaultPrevented && !event.isComposing && !composing && !buttonSpace
    && (macInputHome || (!isEditingBusy() && !isEditableElement(event.target)))) {
    noteScrollIntent();
  }
  // The open listbox owns its keys before the page's numeric/cancel mode.
  if (hasOpenSessionAutomationPicker(event.target)) {
    cancelPendingActivation();
    return;
  }
  if (!quick.active) {
    // A refused replacement leaves the borrowed editor intact. Once editing
    // is over Esc/Tab may close that shell, but digits never auto-arm again.
    if (quick.canDismissBorrow && (event.key === "Escape" || event.key === "Tab")
      && !event.isComposing && !isEditingBusy() && !isEditableElement(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      dismissQuickRound();
    }
    return;
  }
  if (event.isComposing || composing) {
    cancelPendingActivation();
    return;
  }
  // An empty round shows the Dashboard but captures no digits; only Esc/Tab
  // are meaningful, and every other key belongs to the page.
  if (!quick.capture) {
    if (event.key === "Escape" || event.key === "Tab") {
      if (isEditingBusy() || isEditableElement(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      dismissQuickRound();
    }
    return;
  }
  // Inputs, selects, contenteditable and an active alias edit keep their own
  // keyboard: the mode never swallows a keystroke it does not act on.
  if (isEditingBusy() || isEditableElement(event.target)) {
    cancelPendingActivation();
    return;
  }
  if (event.key === "Escape" || event.key === "Tab") {
    event.preventDefault();
    event.stopPropagation();
    dismissQuickRound();
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const physicalKey = physicalDigit(event);
  if (!physicalKey) return;
  // With NumLock off, Chromium keeps `code: "Numpad2"` but reports the
  // navigation meaning in `key` (for example, "ArrowDown"). Leave those
  // navigation keys to the page instead of silently jumping to a session.
  // Main-row Digit codes remain layout-independent for AZERTY and peers.
  if (physicalKey.startsWith("Numpad") && !/^[1-9]$/.test(event.key)) return;
  // Shift is part of typing the digit on layouts such as AZERTY. Only accept
  // it when `code` proves which physical digit key was pressed; the key-only
  // fallback must keep modified shortcuts out of Quick Select.
  if (event.shiftKey && physicalKey.startsWith("key:")) return;
  const digit = Number(physicalKey.slice(-1));
  event.preventDefault();
  event.stopPropagation();
  quick.held.add(physicalKey);
  clearQuickTimer();
  // First target wins for the whole hold; auto-repeat never re-targets.
  if (quick.pending || event.repeat) return;
  const entry = quick.entries[digit - 1];
  if (!entry) return;
  if (!entry.canFocus) {
    setQuickFeedback("dashboardQuickSelectUnavailable");
    return;
  }
  quick.pending = true;
  quick.pendingId = entry.id;
  setQuickFeedback("");
}

function handleQuickKeyup(event) {
  if (!quick.active) return;
  const physicalKey = physicalDigit(event);
  if (!physicalKey) return;
  quick.held.delete(physicalKey);
  // Quiet period starts only once every digit key is up.
  armQuickHandoff();
}
// The manual Kimi quota refresh lives inside the Kimi quota section header
// (built by renderQuotaSummary), so these refs are re-pointed on every quota
// summary rebuild and stay null whenever the section is not rendered.
let kimiQuotaRefreshButtonEl = null;
let kimiQuotaRefreshFeedbackEl = null;

let kimiQuotaStatus = null;
let kimiQuotaRefreshBusy = false;

function t(key) {
  const dict = i18nPayload && i18nPayload.translations ? i18nPayload.translations : {};
  return dict[key] || key;
}

function formatElapsed(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 5) return t("sessionJustNow");
  if (sec < 60) return t("sessionHudElapsedSec").replace("{n}", sec);
  const min = Math.floor(sec / 60);
  if (min < 60) return t("sessionMinAgo").replace("{n}", min);
  const hr = Math.floor(min / 60);
  return t("sessionHrAgo").replace("{n}", hr);
}

function formatTokenCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "";
  try {
    return new Intl.NumberFormat(i18nPayload.lang || "en").format(Math.round(n));
  } catch (_err) {
    return String(Math.round(n));
  }
}

function contextUsageText(session) {
  const usage = session && session.contextUsage;
  if (!usage) return "";
  if (!Number.isFinite(Number(usage.used))) {
    // Percent-only usage (token counts unavailable): never claim "0 tokens".
    return Number.isFinite(Number(usage.percent))
      ? `${t("dashboardContextUsage")}: ${Math.max(0, Math.min(100, Math.round(Number(usage.percent))))}%`
      : "";
  }
  const used = formatTokenCount(usage.used);
  if (Number.isFinite(Number(usage.limit))) {
    const limit = formatTokenCount(usage.limit);
    const percent = Number.isFinite(Number(usage.percent))
      ? ` (${Math.max(0, Math.min(100, Math.round(Number(usage.percent))))}%)`
      : "";
    return `${t("dashboardContextUsage")}: ${used} / ${limit}${percent}`;
  }
  return t("dashboardContextUsageUnknownLimit").replace("{used}", used);
}

// Account-wide rate-limit quota, shown once at the top of the dashboard -
// grouped per reporting source (this machine + one group per remote host;
// snapshot.accountQuota, fed by src/state-account-quota.js), because local
// and remote can be different subscriptions. Freshest-wins applies within
// a source only. Provider sections cover Antigravity's own /usage (Gemini +
// Claude/GPT-via-agy), Claude Code's rate_limits, Codex's generic rollout
// rate_limits, and Dashboard-only Codex Spark quota.
function quotaSeverityClass(usedPercent) {
  return "sev-" + globalThis.CharacterQuotaView.severity(usedPercent);
}
// A source that has not confirmed its numbers recently gets an explicit
// "as of N ago" label instead of presenting old numbers as live.
const DEFAULT_QUOTA_STALE_AFTER_MS = 5 * 60 * 1000;
const PROVIDER_STALE_AFTER_MS = Object.freeze({
  kimiQuota: 7 * 60 * 1000,
  deepseekQuota: 12 * 60 * 1000,
});

function quotaStaleAfterMs(providerKey) {
  return PROVIDER_STALE_AFTER_MS[providerKey] || DEFAULT_QUOTA_STALE_AFTER_MS;
}

function isKimiQuotaConnected() {
  return !!(
    kimiQuotaStatus
    && kimiQuotaStatus.status === "ok"
    && kimiQuotaStatus.configured === true
    && kimiQuotaStatus.collectionEnabled === true
  );
}

// Feedback is kept as data (not just written into the span) so it survives
// the quota summary rebuild that a fresh snapshot triggers right after a
// refresh completes.
let kimiQuotaRefreshFeedbackState = { text: "", isError: false };

function applyKimiQuotaRefreshFeedback() {
  const el = kimiQuotaRefreshFeedbackEl;
  if (!el) return;
  const { text, isError } = kimiQuotaRefreshFeedbackState;
  el.textContent = text;
  el.title = text;
  el.className = isError
    ? "quota-refresh-feedback error"
    : "quota-refresh-feedback";
  el.hidden = !text;
}

function setKimiQuotaRefreshFeedback(message, isError = false) {
  kimiQuotaRefreshFeedbackState = { text: message || "", isError: !!isError };
  applyKimiQuotaRefreshFeedback();
}

function syncKimiQuotaRefreshControl() {
  const button = kimiQuotaRefreshButtonEl;
  if (!button) return;
  button.disabled = kimiQuotaRefreshBusy
    || !kimiQuotaStatus
    || kimiQuotaStatus.decryptable !== true
    || kimiQuotaStatus.agentEnabled === false;
  button.className = kimiQuotaRefreshBusy
    ? "quota-refresh-button is-refreshing"
    : "quota-refresh-button";
  const label = t(
    kimiQuotaRefreshBusy ? "dashboardKimiQuotaRefreshing" : "dashboardKimiQuotaRefresh"
  );
  button.title = label;
  button.setAttribute("aria-label", label);
  applyKimiQuotaRefreshFeedback();
}

// Icon-only refresh action for the Kimi quota section header; repoints the
// module-level refs on every quota summary rebuild.
function buildKimiQuotaRefreshControl() {
  const feedback = document.createElement("span");
  feedback.className = "quota-refresh-feedback";
  feedback.setAttribute("role", "status");
  feedback.setAttribute("aria-live", "polite");
  feedback.hidden = true;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "quota-refresh-button";
  const icon = document.createElement("span");
  icon.className = "quota-refresh-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "↻";
  button.appendChild(icon);
  const label = document.createElement("span");
  label.className = "quota-refresh-label";
  label.textContent = t("dashboardKimiQuotaRefreshShort");
  button.appendChild(label);
  button.addEventListener("click", refreshKimiQuotaFromDashboard);
  kimiQuotaRefreshFeedbackEl = feedback;
  kimiQuotaRefreshButtonEl = button;
  syncKimiQuotaRefreshControl();
  return [feedback, button];
}

async function reloadKimiQuotaStatus() {
  if (!window.dashboardAPI || typeof window.dashboardAPI.getKimiQuotaStatus !== "function") {
    kimiQuotaStatus = null;
  } else {
    try { kimiQuotaStatus = await window.dashboardAPI.getKimiQuotaStatus(); }
    catch { kimiQuotaStatus = null; }
  }
  // The connected flag feeds the quota summary signature, so this rebuilds
  // (showing/hiding the section-header refresh) only when it flipped.
  renderQuotaSummary(snapshot);
  syncKimiQuotaRefreshControl();
  return kimiQuotaStatus;
}

// Identity of the live session set. Only a change here can add or remove a
// resumable row, so it gates the disk read.
function liveSessionKey(value) {
  const sessions = value && Array.isArray(value.sessions) ? value.sessions : [];
  return sessions.map((session) => (session && session.id) || "").sort().join("\u0000");
}

function snapshotHasKimiQuota(value) {
  const accountQuota = Array.isArray(value && value.accountQuota) ? value.accountQuota : [];
  return accountQuota.some((entry) => entry && entry.kimiQuota && entry.kimiQuota.group);
}

async function refreshKimiQuotaFromDashboard() {
  if (kimiQuotaRefreshBusy || !window.dashboardAPI
      || typeof window.dashboardAPI.refreshKimiQuota !== "function") return;
  kimiQuotaRefreshBusy = true;
  setKimiQuotaRefreshFeedback("");
  syncKimiQuotaRefreshControl();
  let result;
  try { result = await window.dashboardAPI.refreshKimiQuota(); }
  catch { result = { status: "error", reason: "runtime-unavailable" }; }
  kimiQuotaRefreshBusy = false;
  await reloadKimiQuotaStatus();
  if (result && result.status === "ok") {
    setKimiQuotaRefreshFeedback(t("dashboardKimiQuotaUpdated"));
  } else {
    const reason = (result && (result.reason || result.message)) || "unknown-error";
    setKimiQuotaRefreshFeedback(
      t("dashboardKimiQuotaRefreshFailed").replace("{reason}", String(reason)),
      true
    );
  }
  syncKimiQuotaRefreshControl();
}

function formatDurationHM(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0
    ? t("dashboardQuotaResetHoursMinutes").replace("{h}", hours).replace("{m}", minutes)
    : t("dashboardQuotaResetMinutes").replace("{m}", minutes);
}

function formatResetIn(resetAt) {
  const n = Number(resetAt);
  if (!Number.isFinite(n)) return "";
  const secondsLeft = Math.round((n - Date.now()) / 1000);
  if (secondsLeft < 0) return "";
  return formatDurationHM(Math.round(secondsLeft / 60));
}

function formatAsOf(updatedAt) {
  const n = Number(updatedAt);
  if (!Number.isFinite(n)) return "";
  const agoMinutes = Math.round((Date.now() - n) / 60000);
  if (agoMinutes < 1) return "";
  return t("dashboardQuotaAsOf").replace("{time}", formatDurationHM(agoMinutes));
}

// The rate-limit windows reset on wall clock regardless of CLI activity, so
// a bucket whose resetAt has passed would show the pre-reset high - worse
// than showing nothing. The store already drops expired buckets at snapshot
// time; this guard covers buckets that expire between snapshots (the
// dashboard rerenders on its own tick).
function liveBucket(group, field, providerKey) {
  return globalThis.CharacterQuotaView.describeWindow(group?.[field], providerKey, Date.now());
}

function formatQuotaWindowLabel(bucket, fallbackLabel) {
  const minutes = Number(bucket && bucket.windowMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return fallbackLabel;
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${Math.round(minutes)}m`;
}

function quotaResetStyle(bucket, fallbackStyle) {
  const minutes = Number(bucket && bucket.windowMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return fallbackStyle;
  return minutes >= 24 * 60 ? "date" : "countdown";
}

// renderQuotaSummary can run once a second (see the setInterval(render, 1000)
// tick below) - cache the formatter per lang instead of constructing a new
// Intl.DateTimeFormat on every call.
let resetDateFormatterLang = null;
let resetDateFormatter = null;

function formatResetDate(resetAt) {
  const n = Number(resetAt);
  if (!Number.isFinite(n)) return "";
  const lang = (i18nPayload && i18nPayload.lang) || "en";
  try {
    if (!resetDateFormatter || resetDateFormatterLang !== lang) {
      resetDateFormatter = new Intl.DateTimeFormat(lang, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      resetDateFormatterLang = lang;
    }
    return resetDateFormatter.format(n);
  } catch (_err) {
    return "";
  }
}

// One row (or two for Antigravity) per source that has live data for the
// provider. Source labels appear only when they carry information: a single
// local-only source renders exactly the compact pre-grouping layout, and a
// fresh source shows no "as of" suffix.
function buildQuotaSourceHeader(sourceEntry, providerEntry, baseLabel, providerKey) {
  const parts = [];
  const multiSource = sourceEntry.multiSource === true;
  // Extra local Codex subscriptions are labeled even if they are the only
  // currently reporting source. A lone default source stays compact.
  const namedLocalCodex = typeof sourceEntry.sourceKey === "string"
    && sourceEntry.sourceKey.startsWith("codex-profile:");
  if (multiSource || namedLocalCodex || providerKey === "geminiChatQuota" || sourceEntry.sourceKey === "gemini-app-antigravity") {
    let localLabel = t("dashboardQuotaSourceLocal");
    if (sourceEntry.hasExtraCodexProfile) {
      if (providerKey === "codexQuota") localLabel = t("dashboardQuotaSectionCodex");
      if (providerKey === "codexSparkQuota") localLabel = t("dashboardQuotaSectionCodexSpark");
    }
    parts.push(sourceEntry.host || localLabel);
  }
  if (baseLabel) parts.push(baseLabel);
  // lastSeenAt (last confirmation), not updatedAt (last value change): a
  // reporter confirming the same numbers every minute is alive, not stale.
  // Fallback covers snapshots that predate lastSeenAt.
  const seenAt = Number(providerEntry.lastSeenAt ?? providerEntry.updatedAt ?? 0);
  const age = Date.now() - seenAt;
  if (Number.isFinite(seenAt) && seenAt > 0 && (providerKey === "antigravityQuota" || providerKey === "geminiChatQuota" || providerKey.startsWith("codex"))) {
    parts.push(wt("quotaReadAt").replace("{time}", new Date(seenAt).toLocaleString(i18nPayload?.lang)));
  } else if (Number.isFinite(age) && age > quotaStaleAfterMs(providerKey)) {
    const asOf = formatAsOf(seenAt);
    if (asOf) parts.push(asOf);
  }
  return parts.length ? parts.join(" · ") : null;
}

function formatBalanceAmount(amount, currency) {
  const symbol = currency === "USD" ? "$" : "¥";
  return symbol + (amount >= 100 ? Math.round(amount).toString() : amount.toFixed(2));
}

function buildQuotaHalfBar(labelText, bucket, resetStyle, providerKey, ringSlot, presentation = {}) {
  const half = document.createElement("div");
  half.className = "quota-half";

  const labelRow = document.createElement("div");
  labelRow.className = "quota-label-row";
  labelRow.appendChild(createText("span", "quota-label", labelText));
  const isBalance = presentation.kind === "balance";
  const remainingPercent = bucket.remaining;
  const remainingWord = t("quotaRemainingWord") !== "quotaRemainingWord"
    ? t("quotaRemainingWord")
    : "left";
  const percentText = isBalance
    ? t("dashboardDeepseekBalanceBaseline").replace("{amount}", formatBalanceAmount(bucket.baseline, bucket.currency))
    : `${remainingPercent}% ${remainingWord}`;
  let resetText = "";
  if (bucket.expired) {
    resetText = wt("quotaPendingReset");
  } else if (Number.isFinite(bucket.resetAt)) {
    resetText = resetStyle === "date"
      ? t("dashboardQuotaResetOn").replace("{date}", formatResetDate(bucket.resetAt))
      : t("dashboardQuotaResetIn").replace("{time}", formatResetIn(bucket.resetAt));
  }
  const bucketSeenAt = Number(bucket.lastSeenAt);
  const showsSourceTime = providerKey === "antigravityQuota" || providerKey === "geminiChatQuota" || providerKey.startsWith("codex");
  const asOf = !showsSourceTime && Number.isFinite(bucketSeenAt)
    && Date.now() - bucketSeenAt > quotaStaleAfterMs(providerKey)
    ? formatAsOf(bucketSeenAt)
    : "";
  const details = [percentText, bucket.stale ? wt("quotaStale") : "", resetText, asOf].filter(Boolean).join(" · ");
  labelRow.appendChild(createText("span", "quota-percent", details));
  half.appendChild(labelRow);

  const track = document.createElement("div");
  track.className = "quota-bar-track";
  const fill = document.createElement("div");
  fill.className = `quota-bar-fill pv-${providerKey} rg-${ringSlot} ${quotaSeverityClass(bucket.usedPercent)}`;
  const percent = isBalance ? 100 - bucket.usedPercent : remainingPercent;
  fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  track.appendChild(fill);
  if (!bucket.stale) half.appendChild(track);

  return half;
}

function buildQuotaGroupRow(headerText, fiveHourBucket, weeklyBucket, providerKey, presentation = {}) {
  if (!fiveHourBucket && !weeklyBucket) return null;
  if (presentation.kind === "balance"
      && !globalThis.ClawdQuotaBalance.isDrawableBalanceBucket(fiveHourBucket)) return null;
  const row = document.createElement("div");
  row.className = "quota-group-row";
  if (headerText) row.appendChild(createText("div", "quota-group-header", headerText));
  const halves = document.createElement("div");
  halves.className = "quota-halves";
  if (fiveHourBucket) {
    halves.appendChild(buildQuotaHalfBar(
      presentation.kind === "balance"
        ? formatBalanceAmount(fiveHourBucket.amount, fiveHourBucket.currency)
        : formatQuotaWindowLabel(fiveHourBucket, t("dashboardQuotaFiveHour")),
      fiveHourBucket,
      quotaResetStyle(fiveHourBucket, "countdown"),
      providerKey,
      "outer",
      presentation
    ));
  }
  if (weeklyBucket) {
    halves.appendChild(buildQuotaHalfBar(
      formatQuotaWindowLabel(weeklyBucket, t("dashboardQuotaWeekly")),
      weeklyBucket,
      quotaResetStyle(weeklyBucket, "date"),
      providerKey,
      "inner"
    ));
  }
  row.appendChild(halves);
  return row;
}

function buildQuotaSection(headerKey, rows, headerExtras = [], title = t(headerKey)) {
  const usableRows = rows.filter(Boolean);
  if (!usableRows.length && !headerExtras.length) return null;
  const section = document.createElement("div");
  section.className = "quota-section";
  if (headerExtras.length) {
    const titlebar = document.createElement("div");
    titlebar.className = "quota-section-titlebar";
    titlebar.appendChild(createText("div", "quota-section-header", title));
    for (const el of headerExtras) titlebar.appendChild(el);
    section.appendChild(titlebar);
  } else {
    section.appendChild(createText("div", "quota-section-header", title));
  }
  for (const row of usableRows) section.appendChild(row);
  return section;
}

// render() re-invokes renderQuotaSummary every second so the "resets in Xh
// Ym" countdowns stay live even between real quota updates, but that only
// needs to touch the DOM once a minute (formatResetIn's granularity) or when
// the underlying quota/lang actually changes - not on every tick. Skipping
// the rebuild otherwise avoids rebuilding the whole subtree (and re-running
// every Intl.DateTimeFormat/formatResetIn call inside it) 59 times a minute
// for nothing.
let lastQuotaSummarySignature = null;

function computeQuotaSummarySignature(accountQuota) {
  return JSON.stringify({
    lang: (i18nPayload && i18nPayload.lang) || "en",
    minute: accountQuota.length ? Math.floor(Date.now() / 60000) : null,
    accountQuota,
    // The Kimi section header hosts the manual refresh while connected, so a
    // connection flip must force a rebuild even when the data is unchanged.
    kimiRefresh: isKimiQuotaConnected(),
  });
}

function renderQuotaSummary(snapshot) {
  if (!quotaSummaryEl) return;
  const accountQuota = Array.isArray(snapshot && snapshot.accountQuota) ? snapshot.accountQuota : [];

  const signature = computeQuotaSummarySignature(accountQuota);
  if (signature === lastQuotaSummarySignature) return;
  lastQuotaSummarySignature = signature;
  // Stale until the Kimi section (re)creates them below.
  kimiQuotaRefreshButtonEl = null;
  kimiQuotaRefreshFeedbackEl = null;

  const multiSource = accountQuota.length > 1;
  const hasExtraCodexProfile = accountQuota.some((source) => typeof source.sourceKey === "string"
    && source.sourceKey.startsWith("codex-profile:"));
  const sources = accountQuota.map((entry) => ({ ...entry, multiSource, hasExtraCodexProfile }));

  const sections = [];

  if (hasWorkspaceDom() && globalThis.CharacterQuotaView && typeof globalThis.CharacterQuotaView.buildUnifiedQuotaRows === "function") {
    const now = Date.now();
    const unified = globalThis.CharacterQuotaView.buildUnifiedQuotaRows(accountQuota, now);
    const serviceLabelKeys = {
      codex: "quotaSvcCodex",
      "antigravity-gemini": "quotaSvcAgGemini",
      "antigravity-claude-gpt": "quotaSvcAgThird",
      "gemini-chat": "quotaSvcGeminiChat",
    };

    for (const item of unified) {
      const section = document.createElement("div");
      section.className = "quota-section";
      section.dataset.quotaId = item.id;

      const titlebar = document.createElement("div");
      titlebar.className = "quota-section-titlebar";
      titlebar.appendChild(createText("div", "quota-section-header", wt(serviceLabelKeys[item.id] || item.id)));

      const refreshMap = workspaceCtx?.system?.quotaRefresh || {};
      const refreshKey = item.id === "codex"
        ? "codex"
        : item.id.startsWith("antigravity-")
          ? "antigravity"
          : item.id === "gemini-chat"
            ? "geminiChat"
            : "";
      const rState = refreshKey ? refreshMap[refreshKey] : null;
      const metaParts = [];
      if (rState?.state === "refreshing") metaParts.push(wt("quotaStatusRefreshing"));
      else if (rState?.state === "auth-required") metaParts.push(wt("quotaStatusAuthRequired"));
      else if (rState?.state === "error") metaParts.push(wt("quotaStatusFailed"));
      else if (item.stale) metaParts.push(wt("quotaStale"));
      if (item.lastSeenAt) {
        const ts = new Date(item.lastSeenAt).toLocaleTimeString(i18nPayload?.lang, { hour: "2-digit", minute: "2-digit" });
        metaParts.push(wt("quotaUpdatedAt").replace("{time}", ts));
      } else if (item.id === "gemini-chat") {
        metaParts.push(wt("quotaStatusExtension"));
      }
      if (item.source) metaParts.push(item.source);
      if (metaParts.length) {
        const isWarn = rState?.state === "auth-required" || rState?.state === "error" || item.stale;
        const metaEl = createText("span", `quota-section-meta${isWarn ? " is-stale" : ""}`, metaParts.join(" · "));
        if (item.lastSeenAt) metaEl.title = new Date(item.lastSeenAt).toLocaleString();
        titlebar.appendChild(metaEl);
      }
      section.appendChild(titlebar);

      const row = document.createElement("div");
      row.className = "quota-group-row";

      if (item.unknown) {
        row.appendChild(createText("div", "note", wt("quotaNoData")));
      } else {
        const halves = document.createElement("div");
        halves.className = "quota-halves";
        const slotDefs = [
          [item.shortWindow, t("dashboardQuotaFiveHour"), "countdown", "outer"],
          [item.weeklyWindow, t("dashboardQuotaWeekly"), "date", "inner"],
        ];
        for (const [slot, fallbackLabel, defaultResetStyle, ringSlot] of slotDefs) {
          if (!slot) continue;
          const label = formatQuotaWindowLabel(slot, fallbackLabel);
          if (slot.kind === "disabled") {
            const half = document.createElement("div");
            half.className = "quota-half is-disabled";
            const labelRow = document.createElement("div");
            labelRow.className = "quota-label-row";
            labelRow.append(
              createText("span", "quota-label", label),
              createText("span", "quota-percent is-muted", wt("quotaWindowDisabled"))
            );
            half.appendChild(labelRow);
            halves.appendChild(half);
          } else {
            halves.appendChild(buildQuotaHalfBar(
              label,
              slot,
              quotaResetStyle(slot, defaultResetStyle),
              item.providerKey,
              ringSlot
            ));
          }
        }
        row.appendChild(halves);
      }
      section.appendChild(row);
      sections.push(section);
    }
  } else {
    const antigravityRows = [];
    const hasCliQuota = sources.some(source => source.antigravityCliQuota);
    for (const source of sources) {
      if (source.antigravityCliQuota) {
        const provider = source.antigravityCliQuota;
        const rows = new Map();
        for (const bucket of Object.values(provider.group)) {
          if (!rows.has(bucket.groupLabel)) rows.set(bucket.groupLabel, []);
          rows.get(bucket.groupLabel).push(bucket);
        }
        for (const [label, buckets] of rows) {
          const row = document.createElement("div");
          row.className = "quota-group-row";
          row.appendChild(createText("div", "quota-group-header", `${label} · ${source.host} · ${new Date(provider.lastSeenAt).toLocaleString()}`));
          for (const raw of buckets) {
            if (raw.disabled) {
              row.appendChild(createText("div", "note", `${raw.bucketLabel} · ${wt("quotaWindowDisabled")}`));
              continue;
            }
            const bucket = globalThis.CharacterQuotaView.describeWindow(raw, "antigravityCliQuota", Date.now(), raw.windowMinutes);
            row.appendChild(buildQuotaHalfBar(formatQuotaWindowLabel(bucket, raw.bucketLabel), bucket, quotaResetStyle(bucket, "countdown"), "antigravityCliQuota", "outer"));
          }
          antigravityRows.push(row);
        }
        continue;
      }
      if (hasCliQuota) continue;
      const provider = source.antigravityQuota;
      const group = provider && provider.group;
      if (!group) continue;
      antigravityRows.push(
        buildQuotaGroupRow(
          buildQuotaSourceHeader(source, provider, t("dashboardQuotaGroupGemini"), "antigravityQuota"),
          liveBucket(group, "geminiFiveHour", "antigravityQuota"),
          liveBucket(group, "geminiWeekly", "antigravityQuota"),
          "antigravityQuota"
        ),
        buildQuotaGroupRow(
          buildQuotaSourceHeader(source, provider, t("dashboardQuotaGroupThirdParty"), "antigravityQuota"),
          liveBucket(group, "thirdPartyFiveHour", "antigravityQuota"),
          liveBucket(group, "thirdPartyWeekly", "antigravityQuota"),
          "antigravityQuota"
        )
      );
    }
    const antigravitySection = buildQuotaSection("dashboardQuotaSectionAntigravity", antigravityRows);
    if (antigravitySection) sections.push(antigravitySection);
  }

  const claudeRows = sources.map((source) => {
    const provider = source.claudeQuota;
    const group = provider && provider.group;
    if (!group) return null;
    return buildQuotaGroupRow(
      buildQuotaSourceHeader(source, provider, null, "claudeQuota"),
      liveBucket(group, "claudeFiveHour", "claudeQuota"),
      liveBucket(group, "claudeWeekly", "claudeQuota"),
      "claudeQuota"
    );
  });
  const claudeSection = buildQuotaSection("dashboardQuotaSectionClaudeCode", claudeRows);
  if (claudeSection) sections.push(claudeSection);

  if (!hasWorkspaceDom()) {
    const codexRows = sources.map((source) => {
      const provider = source.codexQuota;
      const group = provider && provider.group;
      if (!group) return null;
      return buildQuotaGroupRow(
        buildQuotaSourceHeader(source, provider, null, "codexQuota"),
        liveBucket(group, "codexFiveHour", "codexQuota"),
        liveBucket(group, "codexWeekly", "codexQuota"),
        "codexQuota"
      );
    });
    const codexSection = buildQuotaSection("dashboardQuotaSectionCodex", codexRows);
    if (codexSection) sections.push(codexSection);

    const geminiChatRows = sources.map(source => {
      const provider = source.geminiChatQuota;
      if (!provider?.group) return null;
      return buildQuotaGroupRow(
        buildQuotaSourceHeader(source, provider, null, "geminiChatQuota"),
        liveBucket(provider.group, "geminiChatFiveHour", "geminiChatQuota"),
        liveBucket(provider.group, "geminiChatWeekly", "geminiChatQuota"),
        "geminiChatQuota"
      );
    });
    if (geminiChatRows.some(Boolean)) sections.push(buildQuotaSection(null, geminiChatRows, [], wt("geminiChat")));
  }

  const codexSparkRows = sources.map((source) => {
    const provider = source.codexSparkQuota;
    const group = provider && provider.group;
    if (!group) return null;
    return buildQuotaGroupRow(
      buildQuotaSourceHeader(source, provider, null, "codexSparkQuota"),
      liveBucket(group, "codexFiveHour", "codexQuota"),
      liveBucket(group, "codexWeekly", "codexQuota"),
      "codexSparkQuota"
    );
  });
  const codexSparkSection = buildQuotaSection(
    "dashboardQuotaSectionCodexSpark",
    codexSparkRows
  );
  if (codexSparkSection) sections.push(codexSparkSection);

  const kimiRows = sources.map((source) => {
    const provider = source.kimiQuota;
    const group = provider && provider.group;
    if (!group) return null;
    return buildQuotaGroupRow(
      buildQuotaSourceHeader(source, provider, null, "kimiQuota"),
      liveBucket(group, "kimiFiveHour", "kimiQuota"),
      liveBucket(group, "kimiWeekly", "kimiQuota"),
      "kimiQuota"
    );
  });
  const kimiConnected = isKimiQuotaConnected();
  if (kimiConnected && !kimiRows.some(Boolean)) {
    // Connected but nothing reported yet: keep the section visible so the
    // manual refresh that fetches the first numbers has a home.
    kimiRows.push(createText("div", "quota-empty-hint", t("dashboardKimiQuotaEmpty")));
  }
  const kimiSection = buildQuotaSection(
    "dashboardQuotaSectionKimiCode",
    kimiRows,
    kimiConnected ? buildKimiQuotaRefreshControl() : []
  );
  if (kimiSection) sections.push(kimiSection);

  const deepseekRows = sources.map((source) => {
    const provider = source.deepseekQuota;
    const balance = provider?.group?.deepseekBalance;
    if (!balance) return null;
    return buildQuotaGroupRow(
      buildQuotaSourceHeader(source, provider, null, "deepseekQuota"),
      balance, null, "deepseekQuota", { kind: "balance" }
    );
  });
  const deepseekSection = buildQuotaSection("dashboardQuotaSectionDeepseek", deepseekRows);
  if (deepseekSection) sections.push(deepseekSection);

  if (!sections.length) {
    quotaSummaryEl.hidden = true;
    quotaSummaryEl.replaceChildren();
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const section of sections) fragment.appendChild(section);
  quotaSummaryEl.replaceChildren(fragment);
  quotaSummaryEl.hidden = false;
}

function badgeLabel(badge) {
  const key = {
    running: "sessionBadgeRunning",
    done: "sessionBadgeDone",
    interrupted: "sessionBadgeInterrupted",
    idle: "sessionBadgeIdle",
  }[badge] || "sessionBadgeIdle";
  return t(key);
}

function agentLabel(agentId, agentName) {
  return AGENT_LABELS[agentId] || agentName || agentId || t("dashboardUnknownAgent");
}

function agentFallback(agentId, agentName) {
  const label = agentLabel(agentId, agentName).trim();
  return label ? label.slice(0, 2).toUpperCase() : "?";
}

function createText(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = text || "";
  return el;
}

function sessionTitleText(session) {
  return session.displayTitle || session.sessionTitle || session.id || "";
}

function snapshotHasSession(currentSnapshot, sessionId) {
  const sessions = Array.isArray(currentSnapshot && currentSnapshot.sessions)
    ? currentSnapshot.sessions
    : [];
  return sessions.some((session) => session && session.id === sessionId);
}

function beginTitleEdit(session) {
  if (!session || !session.id) return;
  activeEdit = {
    sessionId: session.id,
    rawSessionId: session.rawSessionId || session.id,
    profileId: session.profileId || "local",
    codexProfileId: session.codexProfileId || null,
    agentId: session.agentId || null,
    host: session.host || null,
    cwd: session.cwd || "",
    initialDraft: sessionTitleText(session),
    draft: sessionTitleText(session),
    committing: false,
  };
  render({ force: true });
}

function cancelTitleEdit() {
  if (!activeEdit) return;
  activeEdit = null;
  render({ force: true });
}

async function commitTitleEdit() {
  if (!activeEdit || activeEdit.committing) return;
  const edit = activeEdit;
  if (edit.draft === edit.initialDraft) {
    activeEdit = null;
    render({ force: true });
    return;
  }
  edit.committing = true;
  try {
    const result = await window.dashboardAPI.setSessionAlias({
      host: edit.host,
      agentId: edit.agentId,
      sessionId: edit.sessionId,
      rawSessionId: edit.rawSessionId,
      profileId: edit.profileId,
      codexProfileId: edit.codexProfileId,
      cwd: edit.cwd,
      alias: edit.draft,
    });
    if (!result || result.status !== "ok") {
      edit.committing = false;
      console.warn("session alias update failed:", result && result.message);
      render({ force: true });
      return;
    }
    if (activeEdit === edit) activeEdit = null;
    render({ force: true });
  } catch (err) {
    if (activeEdit === edit) {
      edit.committing = false;
      render({ force: true });
    }
    console.warn("session alias update threw:", err);
  }
}

function createTitle(session) {
  const text = sessionTitleText(session);
  if (activeEdit && activeEdit.sessionId === session.id) {
    const input = document.createElement("input");
    input.className = "session-title-input";
    input.type = "text";
    input.value = activeEdit.draft;
    input.addEventListener("input", () => {
      if (activeEdit && activeEdit.sessionId === session.id) {
        activeEdit.draft = input.value;
      }
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitTitleEdit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelTitleEdit();
      }
    });
    input.addEventListener("blur", () => {
      commitTitleEdit();
    });
    requestAnimationFrame(() => {
      if (activeEdit && activeEdit.sessionId === session.id && document.contains(input)) {
        input.focus();
        input.select();
      }
    });
    return input;
  }

  const title = createText("div", "session-title", text);
  title.title = text;
  title.addEventListener("dblclick", (event) => {
    event.stopPropagation();
    beginTitleEdit(session);
  });
  return title;
}

function appendMeta(main, session, now) {
  const meta = createText("div", "meta", "");
  const badge = document.createElement("span");
  badge.className = `badge badge-${session.badge || "idle"}`;
  const dot = document.createElement("span");
  dot.className = "dot";
  badge.appendChild(dot);
  badge.appendChild(document.createTextNode(badgeLabel(session.badge)));

  meta.appendChild(document.createTextNode(agentLabel(session.agentId, session.agentName)));
  // Claude profile chip ("work"), right after the agent so the clipped end of
  // this single-line row never hides it.
  if (session.claudeProfileLabel) {
    meta.appendChild(document.createTextNode(" "));
    const profileBadge = document.createElement("span");
    profileBadge.className = "profile-badge";
    profileBadge.textContent = session.claudeProfileLabel;
    profileBadge.title = session.claudeConfigDir
      ? `${t("sessionClaudeProfile")}: ${session.claudeConfigDir}`
      : t("sessionClaudeProfile");
    meta.appendChild(profileBadge);
  }
  if (session.codexProfileLabel) {
    meta.appendChild(document.createTextNode(" · "));
    const profileBadge = document.createElement("span");
    profileBadge.className = "source-badge codex-profile-badge";
    profileBadge.textContent = session.codexProfileLabel;
    meta.appendChild(profileBadge);
  }
  meta.appendChild(document.createTextNode(" · "));
  meta.appendChild(badge);
  meta.appendChild(document.createTextNode(` · ${formatElapsed(now - session.updatedAt)}`));
  if (session.headless) {
    meta.appendChild(document.createTextNode(` · ${t("dashboardHeadless")}`));
  }
  if (session.startupRecovered) {
    meta.appendChild(document.createTextNode(" · "));
    const recoveryBadge = document.createElement("span");
    recoveryBadge.className = "recovery-badge";
    recoveryBadge.textContent = t("sessionRecovered");
    meta.appendChild(recoveryBadge);
  }
  // Source badge: show where this session runs (WSL, SSH)
  if (session.sourceType && session.sourceType !== "local") {
    meta.appendChild(document.createTextNode(" · "));
    const sourceBadge = document.createElement("span");
    sourceBadge.className = `source-badge source-${session.sourceType}`;
    sourceBadge.title = session.sourceDisplayLabel || session.sourceLabel || "";
    sourceBadge.textContent = session.sourceDisplayLabel || session.sourceLabel;
    meta.appendChild(sourceBadge);
  }
  main.appendChild(meta);
}

function appendPath(main, session) {
  const pathText = session.cwd || t("dashboardNoPath");
  const pathEl = createText("div", "path", pathText);
  if (session.cwd) {
    pathEl.title = session.cwd;
    if (canOfferLocalFolder(session) && window.dashboardAPI && typeof window.dashboardAPI.openSessionFolder === "function") {
      pathEl.style.cursor = "pointer";
      pathEl.addEventListener("click", (event) => {
        event.stopPropagation();
        void window.dashboardAPI.openSessionFolder(session.id);
      });
    }
  }
  main.appendChild(pathEl);
}

function appendEvent(main, session, now) {
  if (!session.lastEvent) return;
  const eventLabel = session.lastEvent.labelKey
    ? t(session.lastEvent.labelKey)
    : (session.lastEvent.rawEvent || "");
  if (!eventLabel) return;
  const eventAt = Number(session.lastEvent.at) || session.updatedAt;
  main.appendChild(createText(
    "div",
    "event-row",
    `${t("dashboardLastEventPrefix")}: ${eventLabel} · ${formatElapsed(now - eventAt)}`
  ));
}

// Own row, not a chip in `.meta`: that row is a single clipped line, so at the
// default 480px width an appended chip is cut off before it can be read.
function appendModel(main, session) {
  if (!session.model) return;
  const row = createText("div", "model-row", `${t("dashboardModel")}: ${session.model}`);
  row.title = session.model;
  main.appendChild(row);
}

function appendPlanProgress(main, session) {
  if (!session.planProgress) return;
  const plan = session.planProgress;
  const text = t("codexPlanProgress")
    .replace("{completed}", plan.completed)
    .replace("{total}", plan.total)
    .replace("{percent}", plan.percent);
  main.appendChild(createText("div", "plan-progress-row", text));
}

function appendContextUsage(main, session) {
  const text = contextUsageText(session);
  if (!text) return;
  main.appendChild(createText("div", "context-usage-row", text));
}

function createIcon(session) {
  if (session.iconUrl) {
    const img = document.createElement("img");
    img.className = "agent-icon";
    img.alt = "";
    img.src = session.iconUrl;
    img.addEventListener("error", () => {
      const fallback = createText("span", "agent-fallback", agentFallback(session.agentId, session.agentName));
      img.replaceWith(fallback);
    }, { once: true });
    return img;
  }
  return createText("span", "agent-fallback", agentFallback(session.agentId, session.agentName));
}

function createHideButton(session) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "hide-session-button";
  button.textContent = "\u00d7";
  button.title = t("dashboardHideSessionTitle");
  button.setAttribute("aria-label", t("dashboardHideSessionTitle"));
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (!session || !session.id || !window.dashboardAPI.hideSession) return;
    button.disabled = true;
    try {
      const result = await window.dashboardAPI.hideSession(session.id);
      if (!result || (result.status !== "ok" && result.status !== "not-found")) {
        button.disabled = false;
        console.warn("hide session failed:", result && result.message);
      }
    } catch (err) {
      button.disabled = false;
      console.warn("hide session threw:", err);
    }
  });
  return button;
}

function focusUnavailableText(session) {
  return t(focusUnavailableReasonKey(session));
}

function openFolderFailureText(result) {
  if (result && result.status === "error" && result.message) {
    return t("sessionOpenFolderFailed").replace("{reason}", result.message);
  }
  return t("sessionOpenFolderUnavailable");
}

function pruneSessionFolderActionState(sessions, now) {
  const currentIds = new Set(sessions.map((session) => session && session.id).filter(Boolean));
  for (const [sessionId, state] of sessionFolderActionState) {
    if (!currentIds.has(sessionId)
        || (!state.pending && (!state.feedbackText || state.feedbackUntil <= now))) {
      sessionFolderActionState.delete(sessionId);
    }
  }
}

function beginSessionFolderAction(sessionId) {
  const current = sessionFolderActionState.get(sessionId);
  if (current && current.pending) return false;
  sessionFolderActionState.set(sessionId, {
    pending: true,
    feedbackText: "",
    feedbackUntil: 0,
  });
  return true;
}

function finishSessionFolderAction(sessionId, feedbackText = "") {
  if (!feedbackText) {
    sessionFolderActionState.delete(sessionId);
    return;
  }
  sessionFolderActionState.set(sessionId, {
    pending: false,
    feedbackText,
    feedbackUntil: Date.now() + SESSION_FOLDER_FEEDBACK_MS,
  });
}

function createCard(session, now) {
  const card = document.createElement("article");
  card.className = session.canFocus === true ? "card" : "card card-unfocusable";

  // The digit badge is produced here, from the frozen round state, on every
  // rebuild. The one-second tick replaces the whole card tree, so anything
  // injected after a render would be wiped a second later.
  const digit = quickDigitForSession(session.id);
  if (digit) {
    card.classList.add("card-quick-numbered");
    const badge = createText("span", "quick-digit-badge", String(digit));
    badge.setAttribute("aria-hidden", "true");
    card.appendChild(badge);
  }

  if (session.id) {
    const idTail = String(session.id).slice(-3);
    card.appendChild(createText("span", "session-id-badge", `#${idTail}`));
    card.appendChild(createHideButton(session));
  }

  card.appendChild(createIcon(session));

  const main = document.createElement("div");
  main.className = "main";
  main.appendChild(createTitle(session));
  appendMeta(main, session, now);
  appendPlanProgress(main, session);
  appendPath(main, session);
  appendModel(main, session);
  appendEvent(main, session, now);
  appendContextUsage(main, session);
  appendSessionAutomation(main, session);
  card.appendChild(main);

  const actions = document.createElement("div");
  actions.className = "actions";
  const hideRemoteFocusButton = session.canFocus !== true
    && focusUnavailableReasonKey(session) === "sessionFocusUnavailableRemote";
  if (!hideRemoteFocusButton) {
    const button = document.createElement("button");
    button.type = "button";
    const focusTargetType = session.focusTarget && session.focusTarget.type;
    button.textContent = focusTargetType === "codebuddy-ide"
      ? t("dashboardOpenCodeBuddy")
      : focusTargetType === "codex-app"
      ? t("dashboardOpenCodexApp")
      : focusTargetType === "codex-thread"
      ? t("dashboardOpenCodexSession")
      : focusTargetType === "dsh-desktop"
        ? t("dashboardOpenDshDesktop")
        : t("dashboardJumpTerminal");
    button.disabled = session.canFocus !== true;
    if (button.disabled) {
      button.title = focusUnavailableText(session);
    }
    button.addEventListener("click", async () => {
      window.dashboardAPI.focusSession(session.id);
      // Best-effort ack alongside focus. Most remote-Codex sessions have
      // canFocus=false (no terminal-jump target) and reach ack through the
      // Mark-read button instead, but local Codex Stop sessions can land
      // here so we ack on focus too.
      if (window.dashboardAPI && typeof window.dashboardAPI.ackCompletion === "function") {
        try { await window.dashboardAPI.ackCompletion(session.id); }
        catch (err) { console.warn("ack completion threw:", err); }
      }
    });
    actions.appendChild(button);
  }

  if (session.canFocus !== true) {
    const reason = focusUnavailableText(session);
    actions.appendChild(createText("span", "focus-unavailable-reason", reason));
    const folderState = sessionFolderActionState.get(session.id) || null;
    const feedback = createText(
      "span",
      "session-action-feedback",
      folderState && folderState.feedbackUntil > now ? folderState.feedbackText : ""
    );
    feedback.setAttribute("aria-live", "polite");
    actions.appendChild(feedback);

    if (canOfferLocalFolder(session)) {
      const openFolder = document.createElement("button");
      openFolder.type = "button";
      openFolder.className = "open-folder-button";
      openFolder.textContent = t("dashboardOpenFolder");
      openFolder.disabled = !!(folderState && folderState.pending);
      openFolder.addEventListener("click", async () => {
        if (!beginSessionFolderAction(session.id)) return;
        openFolder.disabled = true;
        feedback.textContent = "";
        render();
        try {
          const result = await window.dashboardAPI.openSessionFolder(session.id);
          if (!result || result.status !== "ok") {
            const message = openFolderFailureText(result);
            finishSessionFolderAction(session.id, message);
            feedback.textContent = message;
          } else {
            finishSessionFolderAction(session.id);
          }
        } catch (err) {
          const message = t("sessionOpenFolderFailed")
            .replace("{reason}", err && err.message ? err.message : String(err));
          finishSessionFolderAction(session.id, message);
          feedback.textContent = message;
          console.warn("open session folder threw:", err);
        }
        openFolder.disabled = false;
        render();
      });
      actions.appendChild(openFolder);
    }
  }

  if (session.canOpenInTerminal === true && typeof window.dashboardAPI.openSessionInTerminal === "function") {
    const terminalState = sessionTerminalActionState.get(session.id) || {};
    const openTerminal = document.createElement("button");
    openTerminal.type = "button";
    openTerminal.className = "open-terminal-button";
    openTerminal.textContent = t("dashboardOpenInTerminal");
    openTerminal.disabled = terminalState.pending === true;
    const feedback = createText("span", "session-action-feedback", terminalState.feedback || "");
    feedback.setAttribute("aria-live", "polite");
    openTerminal.addEventListener("click", async () => {
      if (sessionTerminalActionState.get(session.id)?.pending) return;
      sessionTerminalActionState.set(session.id, { pending: true });
      render();
      let feedbackText = "";
      try {
        const result = await window.dashboardAPI.openSessionInTerminal(session.id);
        if (!result || result.status !== "ok") {
          const key = result?.reason === "directory" ? "dashboardOpenTerminalDirectory"
            : result?.reason === "opencode" ? "dashboardOpenTerminalOpencode"
            : result?.status === "unavailable" ? "dashboardOpenTerminalUnavailable"
            : "dashboardOpenTerminalFailed";
          feedbackText = t(key);
        }
      } catch { feedbackText = t("dashboardOpenTerminalFailed"); }
      sessionTerminalActionState.set(session.id, { pending: false, feedback: feedbackText });
      render();
    });
    actions.appendChild(openTerminal);
    actions.appendChild(feedback);
  }

  if (session.requiresCompletionAck === true) {
    actions.appendChild(createMarkReadButton(session));
  }

  card.appendChild(actions);

  return card;
}

function automationActionKey(session) {
  return session && session.id ? `session:${session.id}` : "";
}

function automationActionState(key) {
  const state = key ? sessionAutomationActionState.get(key) : null;
  return state && typeof state === "object"
    ? state
    : { pending: false, feedbackText: "" };
}

function sessionAutomationUnavailableText(session) {
  // Display-only identity check, matching hooks/codex-originator.js. An
  // unsupported source/originator reason alone does not identify Desktop.
  const originator = String(session && session.codexOriginator || "").trim().toLowerCase();
  if (session && session.agentId === "codex"
    && (originator === "codex desktop" || originator === "codex_work_desktop")) {
    return t("sessionAutomationUnavailableCodexDesktop");
  }
  return t("sessionAutomationUnavailable");
}

function appendSessionAutomation(container, session) {
  if (!container || !session) return;
  // Explain Codex's unavailable per-session settings, but do not imply that
  // state-only/manual-only agents inherit Clawd permission automation.
  if (session.canConfigureSessionAutomation !== true
    && !session.sessionAutomationGrantId && session.agentId !== "codex") return;
  const row = document.createElement("div");
  row.className = "session-automation-row";
  const label = createText("span", "session-automation-label", t("sessionAutomationLabel"));
  const canConfigure = session.canConfigureSessionAutomation === true;
  const hasGrant = !!session.sessionAutomationGrantId;
  const unavailableText = canConfigure ? "" : sessionAutomationUnavailableText(session);

  if (!canConfigure && !hasGrant) {
    const readonlyValue = createText(
      "span",
      "session-automation-readonly",
      t("sessionAutomationUnavailableValue")
    );
    readonlyValue.setAttribute(
      "aria-label",
      `${t("sessionAutomationLabel")}: ${t("sessionAutomationUnavailableValue")}`
    );
    const unavailable = createText(
      "span",
      "session-automation-unavailable",
      unavailableText
    );
    unavailable.setAttribute("role", "note");
    row.appendChild(label);
    row.appendChild(readonlyValue);
    row.appendChild(unavailable);
    container.appendChild(row);
    return;
  }

  const values = [
    ["inherit", t("sessionAutomationFollowGlobal")],
    ["off", t("sessionAutomationAsk")],
    ["auto-tools", t("sessionAutomationAutoTools")],
  ];
  const key = automationActionKey(session);
  const actionState = automationActionState(key);
  const feedback = createText(
    "span",
    "session-automation-feedback",
    actionState.feedbackText
  );
  const currentMode = session.sessionAutomationMode || "inherit";
  const pickerValues = canConfigure
    ? values
    : values.filter(([value]) => value === "inherit" || value === currentMode);
  const picker = createLanguagePicker({
    className: "session-automation-picker",
    ariaLabel: t("sessionAutomationLabel"),
    value: currentMode,
    options: pickerValues.map(([value, labelText]) => ({ value, label: labelText })),
    lockWhilePending: true,
    pending: actionState.pending === true,
    revealWhenClosed: false,
    onChange: async (nextValue) => {
      if (!window.dashboardAPI) return false;
      sessionAutomationActionState.set(key, {
        pending: true,
        feedbackText: "",
      });
      feedback.textContent = "";
      let result;
      try {
        if (nextValue === "inherit") {
          result = session.sessionAutomationGrantId
            ? await window.dashboardAPI.clearSessionAutomationGrant({
              grantId: session.sessionAutomationGrantId,
            })
            : { status: "equivalent" };
        } else {
          result = await window.dashboardAPI.setSessionAutomationOverride({
            sessionId: session.id,
            mode: nextValue,
          });
        }
      } catch (err) {
        result = { status: "error", message: err && err.message };
      }
      if (!result || !["applied", "equivalent"].includes(result.status)) {
        if (result && result.status === "cancelled") {
          sessionAutomationActionState.delete(key);
        } else {
          const feedbackText = t("sessionAutomationChangeFailed");
          sessionAutomationActionState.set(key, {
            pending: false,
            feedbackText,
          });
          feedback.textContent = feedbackText;
        }
        return false;
      }
      sessionAutomationActionState.delete(key);
      return true;
    },
  });
  picker.element.setAttribute("data-session-automation-key", key);
  sessionAutomationPickers.push(picker);
  if (!canConfigure) picker.element.title = unavailableText;
  row.appendChild(label);
  row.appendChild(picker.element);
  if (!canConfigure) {
    const unavailable = createText(
      "span",
      "session-automation-unavailable",
      unavailableText
    );
    unavailable.setAttribute("role", "note");
    row.appendChild(unavailable);
  }
  row.appendChild(feedback);
  container.appendChild(row);
}

function createMarkReadButton(session) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mark-read-button";
  button.textContent = t("dashboardMarkRead");
  button.title = t("dashboardMarkReadTitle");
  button.setAttribute("aria-label", t("dashboardMarkReadTitle"));
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (!session || !session.id || !window.dashboardAPI || typeof window.dashboardAPI.ackCompletion !== "function") return;
    button.disabled = true;
    try {
      const result = await window.dashboardAPI.ackCompletion(session.id);
      if (!result || (result.status !== "ok" && result.status !== "noop")) {
        // Failure path: re-enable so the user can try again. Successful
        // ack keeps the button disabled — the next forced snapshot will
        // strip requiresCompletionAck and the button disappears on
        // re-render.
        button.disabled = false;
        console.warn("ack completion failed:", result && result.message);
      }
    } catch (err) {
      button.disabled = false;
      console.warn("ack completion threw:", err);
    }
  });
  return button;
}

function deriveGroups(currentSnapshot) {
  return Array.isArray(currentSnapshot.groups) ? currentSnapshot.groups : [];
}

function renderEmpty() {
  const empty = document.createElement("div");
  empty.className = "empty";
  empty.appendChild(createText("div", "empty-title", t("dashboardEmpty")));
  empty.appendChild(createText("div", "empty-hint", t("dashboardEmptyHint")));
  // "No sessions running" is exactly when the resume list is most useful —
  // it is the state a machine comes back up in. With nothing to resume the
  // node tree stays exactly as it was before this section existed.
  if (!sessionHistory.length) {
    contentEl.replaceChildren(empty);
    return;
  }
  empty.classList.add("empty-with-history");
  const fragment = document.createDocumentFragment();
  fragment.appendChild(empty);
  appendSessionHistory(fragment, Date.now());
  contentEl.replaceChildren(fragment);
}

function createSessionAutomationOrphan(record) {
  const card = document.createElement("article");
  card.className = "automation-orphan-card";
  const main = document.createElement("div");
  main.className = "automation-orphan-main";
  main.appendChild(createText(
    "div",
    "automation-orphan-title",
    record.displayLabel || record.sessionId || record.agentId
  ));
  main.appendChild(createText(
    "div",
    "automation-orphan-meta",
    `${AGENT_LABELS[record.agentId] || record.agentId} · ${
      record.mode === "auto-tools"
        ? t("sessionAutomationAutoTools")
        : t("sessionAutomationAsk")
    }`
  ));
  card.appendChild(main);
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = t("sessionAutomationRevoke");
  const key = `grant:${record.sessionAutomationGrantId}`;
  const actionState = automationActionState(key);
  button.disabled = actionState.pending === true;
  main.appendChild(createText(
    "div",
    "session-automation-feedback",
    actionState.feedbackText
  ));
  button.addEventListener("click", async () => {
    if (!record.sessionAutomationGrantId) return;
    sessionAutomationActionState.set(key, {
      pending: true,
      feedbackText: "",
    });
    button.disabled = true;
    let result;
    try {
      result = await window.dashboardAPI.clearSessionAutomationGrant({
        grantId: record.sessionAutomationGrantId,
      });
    } catch (err) {
      console.warn("clear orphan session automation grant threw:", err);
      result = { status: "error" };
    }
    if (result && ["applied", "equivalent"].includes(result.status)) {
      sessionAutomationActionState.delete(key);
    } else {
      sessionAutomationActionState.set(key, {
        pending: false,
        feedbackText: t("sessionAutomationChangeFailed"),
      });
    }
    render();
  });
  card.appendChild(button);
  return card;
}

function appendSessionAutomationOrphans(fragment) {
  const orphans = Array.isArray(snapshot.sessionAutomationOrphans)
    ? snapshot.sessionAutomationOrphans
    : [];
  if (!orphans.length) return;
  const section = document.createElement("section");
  section.className = "group automation-orphans";
  section.appendChild(createText("h2", "group-title", t("sessionAutomationOrphansTitle")));
  section.appendChild(createText(
    "p",
    "automation-orphans-hint",
    t("sessionAutomationOrphansHint")
  ));
  const cards = document.createElement("div");
  cards.className = "cards";
  for (const record of orphans) cards.appendChild(createSessionAutomationOrphan(record));
  section.appendChild(cards);
  fragment.appendChild(section);
}

function hasOpenSessionAutomationPicker(target = document.activeElement) {
  return sessionAutomationPickers.some((picker) => {
    const element = picker && picker.element;
    return !!(
      element
      && element.classList
      && element.classList.contains("open")
      && contentEl.contains(element)
      && element.contains(target)
    );
  });
}

function sessionAutomationFocusKey() {
  const focused = sessionAutomationPickers.find((picker) =>
    picker.element.contains(document.activeElement));
  return focused ? focused.element.getAttribute("data-session-automation-key") : null;
}

function restoreSessionAutomationFocus(key) {
  if (!key) return;
  const picker = sessionAutomationPickers.find((candidate) =>
    candidate.element.getAttribute("data-session-automation-key") === key);
  const trigger = picker && picker.element.querySelector(".language-picker-trigger");
  if (trigger) trigger.focus({ preventScroll: true });
}

function disposeSessionAutomationPickers() {
  for (const picker of sessionAutomationPickers) picker.dispose();
  sessionAutomationPickers = [];
}

// ── Session history ──────────────────────────────────────────────────────
// Rows come from ~/.clawd/session-history-v1 via main. render() runs on a
// one-second tick and rebuilds the whole tree, so the list is fetched into
// this cache and re-read only on real changes — never once per frame.
let sessionHistory = [];
let sessionHistoryPending = false;
let sessionHistoryReloadRequested = false;
// Whether the collapsed "other sessions" group is expanded. Session-local on
// purpose: the Dashboard reopening starts collapsed so the resumable list
// leads, and no extra state needs to be persisted or synced.
let sessionHistoryOtherExpanded = false;
const sessionHistoryActionState = new Map();

function historyKey(row) {
  return row.historyKey;
}

async function reloadSessionHistory(options = {}) {
  if (!window.dashboardAPI || typeof window.dashboardAPI.getSessionHistory !== "function") return;
  if (sessionHistoryPending) {
    sessionHistoryReloadRequested = true;
    return;
  }
  sessionHistoryPending = true;
  try {
    do {
      sessionHistoryReloadRequested = false;
      const rows = await window.dashboardAPI.getSessionHistory();
      sessionHistory = Array.isArray(rows) ? rows : [];
    } while (sessionHistoryReloadRequested);
  } catch {
    sessionHistory = [];
  } finally {
    sessionHistoryPending = false;
  }
  // Drop feedback for rows that are gone so it cannot outlive its card.
  const live = new Set(sessionHistory.map(historyKey));
  for (const key of sessionHistoryActionState.keys()) {
    if (!live.has(key)) sessionHistoryActionState.delete(key);
  }
  for (const row of sessionHistory) {
    if (row.resumePending && !sessionHistoryActionState.has(historyKey(row))) {
      sessionHistoryActionState.set(historyKey(row), {
        status: "submitted", retryAt: row.resumeRetryAt,
      });
    }
  }
  if (options.rerender !== false) render();
}

function isHistoryResumePending(state, now = Date.now()) {
  return !!state && (state.status === "pending"
    || (state.status === "submitted" && now < state.retryAt));
}

async function resumeHistoryRow(row) {
  if (row.resumeDisabledReason) return;
  const key = historyKey(row);
  if (isHistoryResumePending(sessionHistoryActionState.get(key))) return;
  sessionHistoryActionState.set(key, { status: "pending" });
  render({ force: true });
  let result = null;
  try {
    result = await window.dashboardAPI.resumeSession({
      agentId: row.agentId,
      historyKey: row.historyKey,
    });
  } catch {
    result = null;
  }
  if (result && result.status === "submitted") {
    sessionHistoryActionState.set(key, { status: "submitted", retryAt: result.retryAt });
    render({ force: true });
    return;
  }
  if (result && result.status === "already-running") {
    sessionHistoryActionState.delete(key);
    sessionHistory = sessionHistory.filter((item) => historyKey(item) !== key);
    await reloadSessionHistory();
    return;
  }
  sessionHistoryActionState.set(key, { status: "error" });
  render({ force: true });
}

function createSessionHistoryCard(row, now) {
  const card = document.createElement("article");
  card.className = "session-history-card";

  const main = document.createElement("div");
  main.className = "session-history-main";
  main.appendChild(createText(
    "div",
    "session-history-title",
    row.title || row.sessionId
  ));

  const meta = document.createElement("div");
  meta.className = "session-history-meta";
  if (row.interrupted) {
    meta.appendChild(createText("span", "session-history-flag", t("dashboardHistoryInterrupted")));
  }
  // null means the probe could not tell; only a confident false warns.
  if (row.transcriptPresent === false) {
    meta.appendChild(createText(
      "span",
      "session-history-flag is-missing",
      t("dashboardHistoryTranscriptMissing")
    ));
  }
  if (row.resumeDisabledReason === "profile-unverified") {
    meta.appendChild(createText(
      "span",
      "session-history-flag is-missing",
      t("dashboardHistoryProfileUnverified")
    ));
  }
  const folder = sessionHistoryFolderLabel(row.cwd);
  // The short id sits next to the folder so two similar-looking rows stay
  // distinguishable and can be matched against `claude --resume` output.
  const shortId = typeof row.sessionId === "string" ? row.sessionId.slice(0, 8) : "";
  const elapsed = formatElapsed(Math.max(0, now - row.lastEventAt));
  const parts = [folder, shortId].filter(Boolean);
  meta.appendChild(document.createTextNode(parts.length ? `${parts.join(" · ")} · ${elapsed}` : elapsed));
  main.appendChild(meta);
  card.appendChild(main);

  const actions = document.createElement("div");
  actions.className = "session-history-actions";
  const state = sessionHistoryActionState.get(historyKey(row)) || null;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "session-history-resume";
  const pending = isHistoryResumePending(state, now);
  button.textContent = pending
    ? t("dashboardHistoryResuming")
    : t("dashboardHistoryResume");
  button.disabled = pending || !!row.resumeDisabledReason;
  button.addEventListener("click", () => { void resumeHistoryRow(row); });
  actions.appendChild(button);
  if (state && (state.status === "error" || (state.status === "submitted" && !pending))) {
    actions.appendChild(createText(
      "div",
      "session-history-feedback",
      t(state.status === "error" ? "dashboardHistoryResumeFailed" : "dashboardHistoryNotConfirmed")
    ));
  }
  card.appendChild(actions);
  return card;
}

function sessionHistoryFolderLabel(cwd) {
  if (typeof cwd !== "string" || !cwd) return "";
  const parts = cwd.split(/[/\\]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : cwd;
}

function appendSessionHistory(fragment, now) {
  // A queued disk read can finish after the hook has already put a session
  // on screen. Always apply the current live snapshot at render time too.
  const activeIds = new Set((snapshot.sessions || [])
    .filter((session) => session.agentId === "claude-code"
      && (session.profileId || "local") === "local" && !session.host && !session.wslDistro)
    .map((session) => session.rawSessionId));
  const rows = sessionHistory.filter((row) => !activeIds.has(row.sessionId));
  for (const id of activeIds) sessionHistoryActionState.delete(`claude-code\u0000${id}`);
  if (!rows.length) return;
  // Rows the loader could not confirm resumable (transcript missing or
  // unknown, v1 profiles) collapse behind the confirmed list instead of
  // crowding it — the probe stays a hint on each card, never a gate.
  const confirmed = rows.filter((row) => row.group !== "other");
  const other = rows.filter((row) => row.group === "other");
  const section = document.createElement("section");
  section.className = "group session-history";
  section.appendChild(createText("h2", "group-title", t("dashboardHistoryTitle")));
  section.appendChild(createText("p", "session-history-hint", t("dashboardHistoryHint")));
  if (confirmed.length) {
    const cards = document.createElement("div");
    cards.className = "cards";
    for (const row of confirmed) cards.appendChild(createSessionHistoryCard(row, now));
    section.appendChild(cards);
  }
  if (other.length) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "session-history-toggle";
    toggle.setAttribute("aria-expanded", sessionHistoryOtherExpanded ? "true" : "false");
    toggle.textContent = sessionHistoryOtherExpanded
      ? t("dashboardHistoryHideOther")
      : t("dashboardHistoryShowOther").replace("{n}", other.length);
    toggle.addEventListener("click", () => {
      sessionHistoryOtherExpanded = !sessionHistoryOtherExpanded;
      render();
    });
    section.appendChild(toggle);
    if (sessionHistoryOtherExpanded) {
      const otherCards = document.createElement("div");
      otherCards.className = "cards";
      for (const row of other) otherCards.appendChild(createSessionHistoryCard(row, now));
      section.appendChild(otherCards);
    }
  }
  fragment.appendChild(section);
}

function createQuickTombstoneCard(entry, digit) {
  const card = document.createElement("article");
  card.className = "card card-unfocusable card-quick-tombstone";
  const badge = createText("span", "quick-digit-badge", String(digit));
  badge.setAttribute("aria-hidden", "true");
  card.appendChild(badge);
  const main = document.createElement("div");
  main.className = "main";
  main.appendChild(createText("div", "session-title", entry.title || entry.id));
  main.appendChild(createText("div", "meta", t("dashboardQuickSelectUnavailable")));
  card.appendChild(main);
  return card;
}

// Presentation skeleton for one round.
//
// Entering the mode must not rearrange the Dashboard the user is already
// looking at: the existing host groups, the order of the cards inside them and
// the scroll position all stay as they were. So the round snapshots the
// *presentation* (which group held which id, in which order) once, and renders
// from that for as long as the round lasts. Live fields still update every
// second; only the layout is pinned. Leaving the round drops the skeleton and
// the list goes back to following the shared snapshot's own ordering.
function captureQuickSkeleton() {
  const groups = deriveGroups(snapshot).map((group) => ({
    host: group.host || null,
    displayHost: group.displayHost || null,
    ids: (Array.isArray(group.ids) ? group.ids : []).slice(),
  }));
  const covered = new Set(groups.flatMap((group) => group.ids));
  // A numbered candidate can come from orderedIds/sessions without belonging
  // to any group; it still needs a stable home for the round.
  const ungrouped = quick.entries
    .map((entry) => entry && entry.id)
    .filter((id) => id && !covered.has(id));
  if (ungrouped.length) groups.push({ host: null, displayHost: null, ids: ungrouped });
  return { groups };
}

function quickGroupKey(group) {
  return (group && group.host) || "";
}

// One frozen group: its own ids in their frozen positions first, then any
// session that joined this group during the round appended after them.
function buildQuickFrozenGroup(frozen, currentGroup, byId, now, placed) {
  const cards = document.createElement("div");
  cards.className = "cards";
  let rendered = 0;

  for (const id of frozen.ids) {
    placed.add(id);
    const live = byId.get(id);
    if (live) {
      cards.appendChild(createCard(live, now));
      rendered += 1;
      continue;
    }
    // A numbered session that disappeared holds its own position as an
    // inactive placeholder, so nothing below it shifts up.
    const slot = quick.entries.findIndex((entry) => entry && entry.id === id);
    if (slot !== -1) {
      cards.appendChild(createQuickTombstoneCard(quick.entries[slot], slot + 1));
      rendered += 1;
    }
  }

  const currentIds = currentGroup && Array.isArray(currentGroup.ids) ? currentGroup.ids : [];
  for (const id of currentIds) {
    if (placed.has(id)) continue;
    placed.add(id);
    const live = byId.get(id);
    if (!live) continue;
    cards.appendChild(createCard(live, now));
    rendered += 1;
  }

  if (!rendered) return null;
  const section = document.createElement("section");
  section.className = "group";
  const host = (currentGroup && (currentGroup.displayHost || currentGroup.host))
    || frozen.displayHost
    || frozen.host
    || "";
  section.appendChild(createText("h2", "group-title", host || t("sessionLocal")));
  section.appendChild(cards);
  return section;
}

function appendPlainGroup(fragment, group, byId, now, placed) {
  const ids = Array.isArray(group.ids) ? group.ids : [];
  const groupSessions = ids
    .filter((id) => !placed || !placed.has(id))
    .map((id) => byId.get(id))
    .filter(Boolean);
  if (!groupSessions.length) return;
  if (placed) for (const session of groupSessions) placed.add(session.id);

  const section = document.createElement("section");
  section.className = "group";
  const host = group.displayHost || group.host || "";
  if (host) section.appendChild(createText("h2", "group-title", host));

  const cards = document.createElement("div");
  cards.className = "cards";
  for (const session of groupSessions) cards.appendChild(createCard(session, now));
  section.appendChild(cards);
  fragment.appendChild(section);
}

function appendSessionGroups(fragment, byId, now) {
  const skeleton = quick.active ? quick.skeleton : null;
  if (!skeleton) {
    for (const group of deriveGroups(snapshot)) {
      appendPlainGroup(fragment, group, byId, now, null);
    }
    return;
  }

  const currentGroups = deriveGroups(snapshot);
  const currentByKey = new Map(currentGroups.map((group) => [quickGroupKey(group), group]));
  const frozenKeys = new Set(skeleton.groups.map(quickGroupKey));
  const placed = new Set();

  for (const frozen of skeleton.groups) {
    const section = buildQuickFrozenGroup(
      frozen,
      currentByKey.get(quickGroupKey(frozen)),
      byId,
      now,
      placed
    );
    if (section) fragment.appendChild(section);
  }
  // Whole groups that appeared during the round are appended after the frozen
  // ones rather than pushing the existing context around.
  for (const group of currentGroups) {
    if (frozenKeys.has(quickGroupKey(group))) continue;
    appendPlainGroup(fragment, group, byId, now, placed);
  }
}

function formatBytesGB(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `${(n / (1024 ** 3)).toFixed(1)} GB`;
}

function formatUptime(sec) {
  const s = Number(sec);
  if (!Number.isFinite(s) || s < 0) return "—";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

async function reloadWorkspaceContext() {
  if (!window.dashboardAPI || typeof window.dashboardAPI.getWorkspaceContext !== "function") return;
  if (workspaceCtxPending) return;
  workspaceCtxPending = true;
  try {
    const res = await window.dashboardAPI.getWorkspaceContext();
    if (res && !res.reason && typeof res === "object") {
      workspaceCtx = res;
    }
  } catch {
    // ignore transient IPC error
  } finally {
    workspaceCtxPending = false;
  }
}

function collectProjectsModel(sessions, historyRows) {
  const byCwd = new Map();
  const byName = new Map();
  const findOrCreate = (cwd, name) => {
    const cleanCwd = typeof cwd === "string" ? cwd.trim() : "";
    const cleanName = typeof name === "string" ? name.trim() : "";
    if (!cleanCwd && !cleanName) return null;
    const baseName = cleanCwd ? sessionHistoryFolderLabel(cleanCwd) : cleanName;
    const nameKey = (cleanName || baseName || "").toLowerCase();
    const baseKey = (baseName || "").toLowerCase();
    let rec = (cleanCwd && byCwd.get(cleanCwd))
      || (nameKey && byName.get(nameKey))
      || (baseKey && byName.get(baseKey))
      || null;
    if (!rec) {
      rec = {
        cwd: cleanCwd,
        name: cleanName || baseName || cleanCwd,
        activeSessions: [],
        historyItems: [],
        clients: new Set(),
        registrySessionCount: 0,
        updatedAt: 0,
      };
      if (cleanCwd) byCwd.set(cleanCwd, rec);
      if (nameKey) byName.set(nameKey, rec);
      if (baseKey) byName.set(baseKey, rec);
    } else {
      if (!rec.cwd && cleanCwd) {
        rec.cwd = cleanCwd;
        byCwd.set(cleanCwd, rec);
      }
      if (nameKey && !byName.has(nameKey)) byName.set(nameKey, rec);
      if (baseKey && !byName.has(baseKey)) byName.set(baseKey, rec);
    }
    return rec;
  };

  for (const s of sessions) {
    const cwd = s && typeof s.cwd === "string" ? s.cwd.trim() : "";
    if (!cwd) continue;
    const rec = findOrCreate(cwd, s.displayFolder || sessionHistoryFolderLabel(cwd));
    if (!rec) continue;
    rec.activeSessions.push(s);
    rec.updatedAt = Math.max(rec.updatedAt, Number(s.updatedAt) || 0);
  }
  for (const h of historyRows) {
    const cwd = h && typeof h.cwd === "string" ? h.cwd.trim() : "";
    if (!cwd) continue;
    const rec = findOrCreate(cwd, sessionHistoryFolderLabel(cwd));
    if (!rec) continue;
    rec.historyItems.push(h);
    rec.updatedAt = Math.max(rec.updatedAt, Number(h.lastEventAt) || 0);
  }
  const regProjects = workspaceCtx?.agentRegistry?.projects;
  if (Array.isArray(regProjects)) {
    for (const p of regProjects) {
      const rec = findOrCreate(p.cwd, p.name);
      if (!rec) continue;
      for (const c of p.clients || []) rec.clients.add(c);
      rec.registrySessionCount = Math.max(rec.registrySessionCount, Number(p.sessionCount) || 0);
      if (p.activeCount > 0) rec.updatedAt = Math.max(rec.updatedAt, Date.now());
    }
  }
  const unique = Array.from(new Set([...byCwd.values(), ...byName.values()]));
  return unique.sort((a, b) => {
    const aLive = a.activeSessions.length > 0 ? 1 : 0;
    const bLive = b.activeSessions.length > 0 ? 1 : 0;
    if (bLive !== aLive) return bLive - aLive;
    if (b.registrySessionCount !== a.registrySessionCount) return b.registrySessionCount - a.registrySessionCount;
    return b.updatedAt - a.updatedAt;
  });
}

function appendPendingApprovalsSection(fragment, now) {
  const approvals = workspaceCtx && Array.isArray(workspaceCtx.pendingApprovals)
    ? workspaceCtx.pendingApprovals
    : [];
  if (!approvals.length) return;

  const panel = document.createElement("section");
  panel.className = "approvals-panel";

  const head = document.createElement("div");
  head.className = "approvals-head";
  head.appendChild(createText("div", "approvals-title", wt("approvalsTitle").replace("{n}", approvals.length)));

  if (window.dashboardAPI && typeof window.dashboardAPI.workspaceAction === "function") {
    const revealBtn = document.createElement("button");
    revealBtn.type = "button";
    revealBtn.className = "secondary-btn";
    revealBtn.style.height = "24px";
    revealBtn.style.minWidth = "0";
    revealBtn.style.fontSize = "11px";
    revealBtn.textContent = wt("revealBubble");
    revealBtn.addEventListener("click", () => {
      void window.dashboardAPI.workspaceAction({ type: "reveal-approvals" });
    });
    head.appendChild(revealBtn);
  }
  panel.appendChild(head);

  for (const item of approvals) {
    const row = document.createElement("div");
    row.className = "approval-item";

    const main = document.createElement("div");
    main.className = "approval-item-main";

    const top = document.createElement("div");
    top.className = "approval-item-top";
    top.appendChild(document.createTextNode(agentLabel(item.agentId)));
    if (item.toolName) {
      top.appendChild(createText("span", "approval-tool-tag", item.toolName));
    }
    if (item.cwd) {
      top.appendChild(createText("span", "source-badge", sessionHistoryFolderLabel(item.cwd)));
    }
    top.appendChild(createText("span", "meta", formatElapsed(Math.max(0, now - (item.createdAt || now)))));
    main.appendChild(top);

    if (item.summary) {
      main.appendChild(createText("div", "approval-item-cmd", item.summary));
    }
    row.appendChild(main);

    if (item.sessionId) {
      const jumpBtn = document.createElement("button");
      jumpBtn.type = "button";
      jumpBtn.style.height = "25px";
      jumpBtn.style.minWidth = "0";
      jumpBtn.textContent = t("dashboardJumpTerminal");
      jumpBtn.addEventListener("click", () => {
        window.dashboardAPI.focusSession(item.sessionId);
      });
      row.appendChild(jumpBtn);
    }
    panel.appendChild(row);
  }

  fragment.appendChild(panel);
}

let refreshingAgentRegistry = false;

async function runAgentRegistryRefresh() {
  if (refreshingAgentRegistry || typeof window.dashboardAPI?.workspaceAction !== "function") return;
  refreshingAgentRegistry = true;
  render({ force: true });
  try {
    await window.dashboardAPI.workspaceAction({ type: "refresh-agent-registry" });
    await reloadWorkspaceContext();
  } catch {
    // ignore transient error
  } finally {
    refreshingAgentRegistry = false;
    lastWorkspaceRailSig = "";
    render({ force: true });
  }
}

function clientIconUrlFor(clientId) {
  const icons = (snapshot && snapshot.quotaAgentIcons) || {};
  if (clientId === "codex" && icons.codexQuota) return icons.codexQuota;
  if (clientId === "antigravity" && icons.antigravityQuota) return icons.antigravityQuota;
  const ag = workspaceCtx?.agents?.find((a) =>
    (clientId === "codex" && a.id === "codex")
    || (clientId === "antigravity" && (a.id === "antigravity-cli" || a.id === "antigravity"))
  );
  return ag?.iconUrl || "";
}

function formatClientStatus(status) {
  switch (status) {
    case "running_task": return { text: wt("clientRunning"), tone: "is-live" };
    case "awaiting_approval": return { text: wt("clientAwaiting"), tone: "is-warn" };
    case "online": return { text: wt("clientOnline"), tone: "is-ready" };
    case "not_installed": return { text: wt("clientNotInstalled"), tone: "" };
    default: return { text: wt("clientOffline"), tone: "" };
  }
}

function formatDelegationStage(stage) {
  switch (stage) {
    case "located": return { text: wt("stageLocated"), isWarn: false };
    case "confirmed": return { text: wt("stageConfirmed"), isWarn: false };
    case "delivered": return { text: wt("stageDelivered"), isWarn: false };
    case "started": return { text: wt("stageStarted"), isWarn: false };
    case "awaiting_approval": return { text: wt("stageAwaitingApproval"), isWarn: true };
    case "completed": return { text: wt("stageCompleted"), isWarn: false };
    case "failed": return { text: wt("stageFailed"), isWarn: true };
    default: return null;
  }
}

function createAccessibilityActionButtons() {
  const wrap = document.createElement("div");
  wrap.className = "ax-guide-actions";

  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "secondary-btn";
  openBtn.textContent = wt("axOpenSettings");
  openBtn.addEventListener("click", () => {
    void window.dashboardAPI?.workspaceAction({ type: "open-accessibility-settings" });
  });

  const revealBtn = document.createElement("button");
  revealBtn.type = "button";
  revealBtn.className = "secondary-btn";
  revealBtn.textContent = wt("axRevealApp");
  revealBtn.addEventListener("click", () => {
    void window.dashboardAPI?.workspaceAction({ type: "reveal-accessibility-app" });
  });

  const recheckBtn = document.createElement("button");
  recheckBtn.type = "button";
  recheckBtn.className = "secondary-btn";
  recheckBtn.textContent = wt("axRecheck");
  recheckBtn.addEventListener("click", async () => {
    await window.dashboardAPI?.workspaceAction({ type: "recheck-accessibility" }).catch(() => {});
    await reloadWorkspaceContext();
    lastWorkspaceRailSig = "";
    render({ force: true });
  });

  wrap.append(openBtn, revealBtn, recheckBtn);
  return wrap;
}

function appendAccessibilityGuideBanner(fragment) {
  const ax = workspaceCtx?.agentRegistry?.accessibility;
  if (!ax || !ax.supported || ax.trusted) return;

  const card = document.createElement("section");
  card.className = "ax-guide-card";
  card.appendChild(createText("div", "ax-guide-title", wt("axTitle")));
  const appLabel = ax.appDisplayName || "Character OS";
  card.appendChild(createText("div", "ax-guide-body", wt("axBody").replace("{app}", appLabel)));
  if (ax.isDevElectron) {
    card.appendChild(createText("div", "ax-guide-body", wt("axDevNote")));
  }
  if (ax.appBundlePath) {
    card.appendChild(createText("div", "ax-guide-path", ax.appBundlePath));
  }
  card.appendChild(createAccessibilityActionButtons());
  fragment.appendChild(card);
}

function appendAgentClientsSection(fragment) {
  const clients = workspaceCtx?.agentRegistry?.clients;
  if (!Array.isArray(clients) || !clients.length) return;

  const section = document.createElement("section");
  section.className = "group ws-clients-section";

  const head = document.createElement("div");
  head.className = "block-head";
  head.appendChild(createText("h2", "group-title", wt("agentClientsTitle")));
  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.className = "ui-btn quiet";
  refreshBtn.style.height = "24px";
  refreshBtn.disabled = refreshingAgentRegistry;
  refreshBtn.textContent = refreshingAgentRegistry ? wt("refreshingClients") : wt("refreshClients");
  refreshBtn.addEventListener("click", () => void runAgentRegistryRefresh());
  head.appendChild(refreshBtn);
  section.appendChild(head);

  const grid = document.createElement("div");
  grid.className = "client-cards";

  for (const client of clients) {
    const card = document.createElement("article");
    card.className = "client-card";
    card.dataset.clientId = client.id;

    const top = document.createElement("div");
    top.className = "client-card-head";

    const titleWrap = document.createElement("div");
    titleWrap.className = "client-card-title";
    const iconUrl = clientIconUrlFor(client.id);
    if (iconUrl) {
      const img = document.createElement("img");
      img.src = iconUrl;
      img.alt = "";
      img.addEventListener("error", () => img.remove(), { once: true });
      titleWrap.appendChild(img);
    }
    titleWrap.appendChild(document.createTextNode(client.name));

    const st = formatClientStatus(client.status);
    top.append(titleWrap, createText("span", `status-pill ${st.tone}`.trim(), st.text));
    card.appendChild(top);

    let summary = wt("clientNoActiveSession");
    if (client.running) {
      if (client.isBlankDraft) {
        summary = client.activeProjectName
          ? `${wt("clientActiveDraft")} · ${client.activeProjectName}`
          : wt("clientActiveDraft");
      } else if (client.activeSessionTitle) {
        summary = client.activeProjectName
          ? `${client.activeSessionTitle} · ${client.activeProjectName}`
          : client.activeSessionTitle;
      }
    }
    const sumEl = createText("div", "client-card-summary", summary);
    sumEl.title = summary;
    card.appendChild(sumEl);

    const foot = document.createElement("div");
    foot.className = "client-card-foot";
    foot.appendChild(createText("span", "", wt("clientSessionCount").replace("{n}", String(client.sessionCount || 0))));

    const actionBtn = document.createElement("button");
    actionBtn.type = "button";
    actionBtn.className = "secondary-btn";
    actionBtn.textContent = client.running ? wt("clientFocus") : wt("clientOpen");
    actionBtn.addEventListener("click", () => {
      void window.dashboardAPI?.workspaceAction({ type: "launch-client", clientId: client.id });
    });
    foot.appendChild(actionBtn);
    card.appendChild(foot);

    grid.appendChild(card);
  }

  section.appendChild(grid);
  fragment.appendChild(section);
}

function getDeduplicatedRegistrySessions(hookSessions) {
  const regSessions = workspaceCtx?.agentRegistry?.sessions;
  if (!Array.isArray(regSessions) || !regSessions.length) return [];
  const hookIds = new Set();
  for (const h of hookSessions || []) {
    if (!h) continue;
    if (h.id) hookIds.add(h.id);
    if (h.rawSessionId) hookIds.add(h.rawSessionId);
  }
  return regSessions.filter((s) => {
    if (!s) return false;
    if (s.sessionId && hookIds.has(s.sessionId)) return false;
    if (s.rawSessionId && hookIds.has(s.rawSessionId)) return false;
    return true;
  });
}

function appendRegistrySessionsSection(fragment, hookSessions, now) {
  const items = getDeduplicatedRegistrySessions(hookSessions);
  if (!items.length) return;

  const limit = workspaceView === "sessions" ? 20 : 8;
  const visible = items.slice(0, limit);

  const section = document.createElement("section");
  section.className = "group ws-registry-sessions";
  section.appendChild(createText("h2", "group-title", wt("agentSessionsTitle")));

  const cards = document.createElement("div");
  cards.className = "cards";

  for (const s of visible) {
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.sessionKey = s.key;

    const iconUrl = clientIconUrlFor(s.clientId);
    if (iconUrl) {
      const img = document.createElement("img");
      img.className = "agent-icon";
      img.src = iconUrl;
      img.alt = s.clientName || "";
      img.addEventListener("error", () => img.remove(), { once: true });
      card.appendChild(img);
    } else {
      card.appendChild(createText("div", "agent-fallback", (s.clientName || "?").slice(0, 2).toUpperCase()));
    }

    const main = document.createElement("div");
    main.className = "main";

    const titleText = s.isBlankDraft ? wt("badgeBlankDraft") : (s.title || s.projectName || s.clientName);
    const titleNode = createText("div", "session-title", titleText);
    titleNode.title = titleText;
    main.appendChild(titleNode);

    const meta = document.createElement("div");
    meta.className = "meta";

    const badge = document.createElement("span");
    const badgeTone = s.status === "running"
      ? "badge-running"
      : s.status === "done"
        ? "badge-done"
        : s.status === "awaiting_approval" || s.status === "interrupted"
          ? "badge-interrupted"
          : "";
    badge.className = `badge${badgeTone ? ` ${badgeTone}` : ""}`;
    badge.appendChild(createText("span", "dot", ""));
    const statusLabel = s.status === "blank_draft"
      ? wt("badgeBlankDraft")
      : s.status === "resumable"
        ? wt("badgeResumable")
        : s.status === "awaiting_approval"
          ? wt("clientAwaiting")
          : s.status === "running"
            ? t("badgeRunning")
            : s.status === "done"
              ? t("badgeDone")
              : wt("idle");
    badge.appendChild(document.createTextNode(statusLabel));
    meta.appendChild(badge);

    meta.appendChild(createText("span", "source-badge", s.clientName));
    meta.appendChild(createText("span", "source-badge", s.kind === "cli" ? wt("kindCli") : wt("kindDesktop")));
    if (s.isCurrentVisible) {
      meta.appendChild(createText("span", "source-badge registry-tag-current", wt("badgeCurrent")));
    }
    if (s.projectName) {
      meta.appendChild(createText("span", "source-badge", s.projectName));
    }
    const stageInfo = s.lastDelegation ? formatDelegationStage(s.lastDelegation.stage) : null;
    if (stageInfo) {
      meta.appendChild(createText(
        "span",
        `source-badge registry-tag-stage${stageInfo.isWarn ? " is-warn" : ""}`,
        stageInfo.text
      ));
    }
    if (s.updatedAt && !s.isBlankDraft) {
      meta.appendChild(document.createTextNode(formatElapsed(Math.max(0, now - s.updatedAt))));
    }
    main.appendChild(meta);

    if (s.cwd) {
      const pathNode = createText("div", "path", s.cwd);
      pathNode.title = s.cwd;
      main.appendChild(pathNode);
    }

    card.appendChild(main);

    if (s.canFocus) {
      const actions = document.createElement("div");
      actions.className = "actions";
      const focusBtn = document.createElement("button");
      focusBtn.type = "button";
      focusBtn.textContent = wt("focusSession");
      focusBtn.addEventListener("click", () => {
        void window.dashboardAPI?.workspaceAction({
          type: "focus-registry-session",
          clientId: s.clientId,
          sessionKey: s.key,
          sessionId: s.sessionId || "",
        });
      });
      actions.appendChild(focusBtn);
      card.appendChild(actions);
    }

    cards.appendChild(card);
  }

  section.appendChild(cards);
  fragment.appendChild(section);
}

function appendProjectsSection(fragment, sessions) {
  if (!wsBodyEl) return;
  const projects = collectProjectsModel(sessions, sessionHistory);
  if (!projects.length && workspaceView !== "projects") return;

  const section = document.createElement("section");
  section.className = "group ws-projects-section";
  section.appendChild(createText("h2", "group-title", wt("projectsTitle")));

  if (!projects.length) {
    section.appendChild(createText("p", "session-history-hint", wt("projectsEmpty")));
    fragment.appendChild(section);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "project-grid";

  for (const proj of projects.slice(0, workspaceView === "projects" ? 24 : 5)) {
    const card = document.createElement("article");
    card.className = "project-card";

    const main = document.createElement("div");
    main.className = "project-main";
    const nameEl = createText("div", "project-name", proj.name);
    nameEl.title = proj.cwd;
    const pathEl = createText("div", "project-path", proj.cwd);
    pathEl.title = proj.cwd;

    const metaParts = [];
    if (proj.clients && proj.clients.size > 0) {
      metaParts.push(Array.from(proj.clients).map((c) => (c === "codex" ? "Codex" : c === "antigravity" ? "Antigravity" : c)).join(" / "));
    }
    if (proj.activeSessions.length > 0) {
      metaParts.push(wt("projectActiveCount").replace("{n}", proj.activeSessions.length));
    } else if (proj.registrySessionCount > 0) {
      metaParts.push(wt("clientSessionCount").replace("{n}", proj.registrySessionCount));
    } else if (proj.historyItems.length > 0) {
      metaParts.push(wt("projectRecentCount").replace("{n}", proj.historyItems.length));
    }
    const metaEl = createText("div", "project-meta", metaParts.join(" · "));
    main.append(nameEl, pathEl, metaEl);
    card.appendChild(main);

    const actions = document.createElement("div");
    actions.className = "project-actions";

    if (proj.cwd) {
      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "open-folder-button";
      openBtn.textContent = t("dashboardOpenFolder");
      openBtn.addEventListener("click", () => {
        if (proj.activeSessions[0] && canOfferLocalFolder(proj.activeSessions[0])) {
          void window.dashboardAPI.openSessionFolder(proj.activeSessions[0].id);
        } else if (window.dashboardAPI && typeof window.dashboardAPI.workspaceAction === "function") {
          void window.dashboardAPI.workspaceAction({ type: "open-known-folder", cwd: proj.cwd });
        }
      });
      actions.appendChild(openBtn);
    }

    const focusable = proj.activeSessions.find((s) => s && s.canFocus);
    if (focusable) {
      const jumpBtn = document.createElement("button");
      jumpBtn.type = "button";
      jumpBtn.textContent = wt("focusSession");
      jumpBtn.addEventListener("click", () => window.dashboardAPI.focusSession(focusable.id));
      actions.appendChild(jumpBtn);
    }

    card.appendChild(actions);
    grid.appendChild(card);
  }

  section.appendChild(grid);
  fragment.appendChild(section);
}

function summarizeProviderQuota(accountQuota, providerKey, now) {
  const bucket = globalThis.CharacterQuotaView?.primaryWindow(accountQuota, providerKey, now);
  if (!bucket) return null;
  let resetText = "";
  if (bucket.expired) resetText = wt("quotaPendingReset");
  else if (Number.isFinite(bucket.resetAt)) {
    resetText = quotaResetStyle(bucket, "countdown") === "date"
      ? t("dashboardQuotaResetOn").replace("{date}", formatResetDate(bucket.resetAt))
      : t("dashboardQuotaResetIn").replace("{time}", formatResetIn(bucket.resetAt));
  }
  return { ...bucket, windowLabel: formatQuotaWindowLabel(bucket, bucket.bucketLabel || ""), resetText };
}

let geminiStatusShown = false;

async function runGeminiRead() {
  if (readingGeminiQuota || typeof window.dashboardAPI?.workspaceAction !== "function") return;
  readingGeminiQuota = true;
  geminiStatusShown = true;
  render({ force: true });
  try {
    const result = await window.dashboardAPI.workspaceAction({ type: "refresh-all-quotas" });
    await reloadWorkspaceContext();
    const results = result?.results || {};
    const activeOutcomes = Object.values(results).filter((r) => r && !r.passive);
    const anyFail = activeOutcomes.some((r) => r.status !== "ok" && r.status !== "unchanged");
    const anyAuth = activeOutcomes.some((r) => r.status === "auth-required");
    if (anyAuth) geminiQuotaStatus = "quotaStatusAuthRequired";
    else if (anyFail) geminiQuotaStatus = "quotaRefreshPartial";
    else geminiQuotaStatus = "quotaRefreshDone";
  } catch {
    geminiQuotaStatus = "quotaStatusFailed";
  } finally {
    readingGeminiQuota = false;
    lastQuotaSummarySignature = null;
    render({ force: true });
  }
}

function formatCompactWindowTag(slot, fallback) {
  const m = Number(slot && slot.windowMinutes);
  if (!Number.isFinite(m) || m <= 0) return fallback;
  if (m % 1440 === 0) return `${m / 1440}d`;
  if (m % 60 === 0) return `${m / 60}h`;
  return `${m}m`;
}

function appendOverviewQuotasSection(fragment, now) {
  const section = document.createElement("section");
  section.className = "group";

  const head = document.createElement("div");
  head.className = "block-head";
  head.appendChild(createText("h2", "group-title", wt("navQuotas")));
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ui-btn quiet";
  btn.style.height = "24px";
  btn.textContent = readingGeminiQuota ? wt("quotaRefreshingAll") : wt("quotaRefreshAll");
  btn.disabled = readingGeminiQuota;
  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    void runGeminiRead();
  });
  head.appendChild(btn);
  section.appendChild(head);

  const grid = document.createElement("div");
  grid.className = "overview-quotas-grid";

  const unified = globalThis.CharacterQuotaView?.buildUnifiedQuotaRows
    ? globalThis.CharacterQuotaView.buildUnifiedQuotaRows(snapshot.accountQuota, now)
    : [];
  const labelMap = {
    codex: "quotaSvcCodex",
    "antigravity-gemini": "quotaSvcAgGemini",
    "antigravity-claude-gpt": "quotaSvcAgThird",
    "gemini-chat": "quotaSvcGeminiChat",
  };

  for (const item of unified) {
    const card = document.createElement("div");
    card.className = `overview-quota-card overview-quota-row${item.unknown ? " is-unknown" : ""}`;
    card.dataset.quotaId = item.id;
    card.addEventListener("click", () => {
      workspaceView = "quotas";
      render({ force: true });
    });

    const top = document.createElement("div");
    top.className = "overview-quota-top";
    top.appendChild(createText("span", "overview-quota-name", wt(labelMap[item.id] || item.id)));

    const slotsEl = document.createElement("span");
    slotsEl.className = "overview-quota-slots";
    if (item.unknown) {
      slotsEl.appendChild(createText("span", "overview-quota-val is-empty", wt("quotaNoData")));
    } else {
      for (const [slot, fallbackTag] of [[item.shortWindow, "5h"], [item.weeklyWindow, "7d"]]) {
        if (!slot) continue;
        const tag = formatCompactWindowTag(slot, fallbackTag);
        const pill = document.createElement("span");
        if (slot.kind === "disabled") {
          pill.className = "overview-quota-slot is-disabled";
          pill.append(createText("span", "k", tag), createText("span", "v", wt("quotaDisabledShort")));
        } else {
          const sev = !slot.stale ? globalThis.CharacterQuotaView.severity(slot.usedPercent) : "ok";
          pill.className = `overview-quota-slot${slot.stale ? " is-stale" : (sev !== "ok" ? ` sev-${sev}` : "")}`;
          pill.append(createText("span", "k", tag), createText("span", "v", `${slot.remaining}%`));
        }
        slotsEl.appendChild(pill);
      }
    }
    top.appendChild(slotsEl);
    card.appendChild(top);

    if (item.primary && !item.primary.stale) {
      const bar = document.createElement("div");
      bar.className = "overview-quota-bar";
      const fill = document.createElement("div");
      fill.className = `overview-quota-fill sev-${globalThis.CharacterQuotaView.severity(item.primary.usedPercent)}`;
      fill.style.width = `${item.primary.remaining}%`;
      bar.appendChild(fill);
      card.appendChild(bar);
    }

    if (item.primary || item.stale) {
      const subParts = [];
      if (item.stale) subParts.push(wt("quotaStale"));
      else if (item.primary && Number.isFinite(item.primary.resetAt)) {
        const resetText = quotaResetStyle(item.primary, "countdown") === "date"
          ? t("dashboardQuotaResetOn").replace("{date}", formatResetDate(item.primary.resetAt))
          : t("dashboardQuotaResetIn").replace("{time}", formatResetIn(item.primary.resetAt));
        if (resetText) subParts.push(resetText);
      }
      const updated = item.lastSeenAt
        ? wt("quotaUpdatedAt").replace("{time}", new Date(item.lastSeenAt).toLocaleTimeString(i18nPayload?.lang, { hour: "2-digit", minute: "2-digit" }))
        : "";
      if (subParts.length || updated) {
        const sub = document.createElement("div");
        sub.className = "overview-quota-sub";
        sub.append(createText("span", "", subParts.join(" · ")), createText("span", "", updated));
        card.appendChild(sub);
      }
    }

    grid.appendChild(card);
  }

  section.appendChild(grid);
  if (geminiStatusShown) {
    section.appendChild(createText("div", "note", wt(geminiQuotaStatus)));
  }
  fragment.appendChild(section);
}

function createOverviewLayout() {
  const root = document.createElement("div");
  root.className = "ov";
  const main = document.createElement("div");
  main.className = "ov-main";
  const rail = document.createElement("div");
  rail.className = "ov-rail";
  root.append(main, rail);
  return { root, main, rail };
}

function hasWorkspaceDom() {
  return !!(wsBodyEl && wsNavEl && typeof wsNavEl.querySelectorAll === "function");
}

function renderWorkspaceChrome(sessions) {
  if (!hasWorkspaceDom()) return;

  wsBodyEl.setAttribute("data-view", workspaceView);

  const runningCount = sessions.filter((s) => s && !s.headless && s.badge === "running").length;
  const approvalsCount = workspaceCtx && Array.isArray(workspaceCtx.pendingApprovals)
    ? workspaceCtx.pendingApprovals.length
    : 0;

  // Header: the view's own name, then one honest line about what is happening.
  if (titleEl) {
    const viewLabel = { overview: "navOverview", sessions: "navSessions", projects: "navProjects", quotas: "navQuotas" }[workspaceView];
    titleEl.textContent = viewLabel ? wt(viewLabel) : wt("workspaceTitle");
  }
  if (wsStatusDotEl) wsStatusDotEl.hidden = true;
  if (countEl) {
    const tags = [];
    const onlineClients = (workspaceCtx?.agentRegistry?.clients || []).filter((c) => c && c.running);
    if (approvalsCount > 0) tags.push(["warn", wt("awaiting").replace("{n}", approvalsCount)]);
    if (runningCount > 0) tags.push(["live", wt("running").replace("{n}", runningCount)]);
    if (!tags.length && onlineClients.length > 0) {
      tags.push(["live", `${onlineClients.map((c) => c.name).join(" · ")} ${wt("clientOnline")}`]);
    }
    if (!tags.length) tags.push(["", wt("idle")]);
    countEl.replaceChildren(...tags.map(([tone, text]) => {
      const tag = document.createElement("span");
      tag.className = `tag${tone ? ` ${tone}` : ""}`;
      const dot = document.createElement("span");
      dot.className = `ui-dot${tone === "warn" ? " warn" : tone === "live" ? " live" : ""}`;
      tag.append(dot, document.createTextNode(text));
      return tag;
    }));
  }
  const sessionsCountEl = wsNavEl && wsNavEl.querySelector("[data-ws-count='sessions']");
  if (sessionsCountEl) {
    const extraActive = getDeduplicatedRegistrySessions(sessions).filter((s) => s.status !== "resumable").length;
    const totalVisibleSessions = sessions.length + extraActive;
    sessionsCountEl.hidden = totalVisibleSessions === 0;
    sessionsCountEl.textContent = String(totalVisibleSessions);
    sessionsCountEl.className = `nav-count${approvalsCount > 0 ? " warn" : runningCount > 0 ? " live" : ""}`;
  }
  const footIcons = (snapshot && snapshot.quotaAgentIcons) || {};
  for (const [imgId, svgId, url] of [
    ["wsIcoCodex", "wsSvgCodex", footIcons.codexQuota],
    ["wsIcoAntigravity", "wsSvgAntigravity", footIcons.antigravityQuota],
  ]) {
    const img = document.getElementById(imgId);
    const svg = document.getElementById(svgId);
    if (!img || !svg) continue;
    if (url) {
      if (img.getAttribute("src") !== url) img.src = url;
      img.hidden = false;
      svg.style.display = "none";
      if (!img.dataset.bound) {
        img.dataset.bound = "1";
        img.addEventListener("error", () => { img.hidden = true; svg.style.display = ""; });
      }
    } else {
      img.hidden = true;
      svg.style.display = "";
    }
  }

  if (wsNavEl) {
    const labels = {
      overview: wt("navOverview"),
      sessions: wt("navSessions"),
      projects: wt("navProjects"),
      quotas: wt("navQuotas"),
    };
    for (const btn of wsNavEl.querySelectorAll("[data-ws-view]")) {
      const view = btn.getAttribute("data-ws-view");
      const labelNode = btn.querySelector("[data-ws-nav-label]");
      if (labelNode && labels[view]) labelNode.textContent = labels[view];
      btn.classList.toggle("is-active", view === workspaceView);
    }
  }

  if (wsLblSettingsEl) wsLblSettingsEl.textContent = wt("settingsButton");

  const showQuotasDetail = workspaceView === "quotas";
  if (contentEl) contentEl.hidden = showQuotasDetail;
  if (wsQuotasPanelEl) wsQuotasPanelEl.hidden = !showQuotasDetail;

  if (wsQuotaTitleEl) wsQuotaTitleEl.textContent = wt("quotasTitle");
  if (wsReadGeminiQuota) {
    wsReadGeminiQuota.hidden = false;
    wsReadGeminiQuota.disabled = readingGeminiQuota;
    wsReadGeminiQuota.textContent = readingGeminiQuota ? wt("quotaRefreshingAll") : wt("quotaRefreshAll");
  }
  if (wsGeminiQuotaStatus) {
    wsGeminiQuotaStatus.hidden = false;
    if (geminiStatusShown) {
      wsGeminiQuotaStatus.textContent = wt(geminiQuotaStatus);
    } else {
      const qr = workspaceCtx?.system?.quotaRefresh || {};
      const anyRefreshing = Object.values(qr).some((s) => s && s.state === "refreshing");
      wsGeminiQuotaStatus.textContent = anyRefreshing ? wt("quotaRefreshingAll") : wt("quotaAutoReady");
    }
  }
  if (wsRuntimeTitleEl) wsRuntimeTitleEl.textContent = wt("runtimeTitle");
  if (wsBtnManageAgentsEl) wsBtnManageAgentsEl.textContent = wt("manageAgents");

  if (wsGeminiChatControls) {
    const canReadGemini = workspaceCtx?.system?.platform === "darwin";
    wsGeminiChatControls.hidden = !canReadGemini;
    const browserSource = snapshot.accountQuota?.find(source => source.geminiChatQuota && source.host === "Gemini · Chrome background");
    const status = browserSource && Date.now() - browserSource.geminiChatQuota.lastSeenAt < 30 * 60000
      ? "ok" : workspaceCtx?.system?.geminiChatQuotaStatus;
    wsGeminiChatStatus.textContent = wt(status === "permission-required" ? "quotaPermission"
      : status === "ok" || status === "unchanged" ? "geminiChatWatching" : "geminiChatWaiting");
    wsOpenGeminiUsage.textContent = wt("geminiChatUsage");
  }

  if (wsQuotaFallbackEl && quotaSummaryEl) {
    const childList = quotaSummaryEl.children || quotaSummaryEl.childNodes || [];
    const hasAnyQuota = !quotaSummaryEl.hidden && childList.length > 0;
    wsQuotaFallbackEl.hidden = hasAnyQuota;
    wsQuotaFallbackEl.textContent = wt("quotaFallback");
  }

  const sys = (workspaceCtx && workspaceCtx.system) || {};
  const regSnap = workspaceCtx?.agentRegistry || null;
  const railSig = JSON.stringify({
    lang: (i18nPayload && i18nPayload.lang) || "en",
    serverPort: sys.serverPort || 0,
    agents: workspaceCtx && workspaceCtx.agents,
    regClients: (regSnap?.clients || []).map((c) => [c.id, c.status, c.running, c.sessionCount]),
    ax: regSnap?.accessibility ? [regSnap.accessibility.supported, regSnap.accessibility.trusted, regSnap.accessibility.appDisplayName] : null,
  });

  if (railSig === lastWorkspaceRailSig) return;
  lastWorkspaceRailSig = railSig;

  if (wsRuntimeListEl) {
    wsRuntimeListEl.replaceChildren();

    // Only show real, actionable runtime status: local hook server, desktop clients, macOS Accessibility, and hooks.
    const bridgeRow = document.createElement("div");
    bridgeRow.className = "runtime-row";
    bridgeRow.append(
      createText("span", "runtime-left", wt("localService")),
      createText(
        "span",
        `status-pill${sys.serverPort ? " is-ready" : ""}`,
        sys.serverPort
          ? wt("serviceRunning").replace("{port}", sys.serverPort)
          : wt("serviceOffline")
      )
    );
    wsRuntimeListEl.appendChild(bridgeRow);

    if (Array.isArray(regSnap?.clients)) {
      for (const c of regSnap.clients) {
        const r = document.createElement("div");
        r.className = "runtime-row";
        const left = document.createElement("span");
        left.className = "runtime-left";
        const ico = clientIconUrlFor(c.id);
        if (ico) {
          const img = document.createElement("img");
          img.src = ico;
          img.alt = "";
          img.addEventListener("error", () => img.remove(), { once: true });
          left.appendChild(img);
        }
        left.appendChild(document.createTextNode(c.name));
        const st = formatClientStatus(c.status);
        r.append(left, createText("span", `status-pill ${st.tone}`.trim(), st.text));
        wsRuntimeListEl.appendChild(r);
      }
    }

    if (regSnap?.accessibility?.supported) {
      const ax = regSnap.accessibility;
      const axBlock = document.createElement("div");
      axBlock.className = "runtime-ax-block";
      const top = document.createElement("div");
      top.className = "runtime-ax-top";
      top.append(
        createText("span", "runtime-left", wt("axLabel")),
        createText("span", `status-pill ${ax.trusted ? "is-ready" : "is-warn"}`, ax.trusted ? wt("axTrusted") : wt("axMissing"))
      );
      axBlock.appendChild(top);
      if (!ax.trusted) {
        const appLabel = ax.appDisplayName || "Character OS";
        axBlock.appendChild(createText("div", "runtime-ax-note", wt("axBody").replace("{app}", appLabel)));
        const actions = createAccessibilityActionButtons();
        actions.className = "runtime-ax-actions";
        axBlock.appendChild(actions);
      }
      wsRuntimeListEl.appendChild(axBlock);
    }

    if (workspaceCtx && Array.isArray(workspaceCtx.agents)) {
      for (const ag of workspaceCtx.agents) {
        const r = document.createElement("div");
        r.className = "runtime-row";
        const left = document.createElement("span");
        left.className = "runtime-left";
        if (ag.iconUrl) {
          const img = document.createElement("img");
          img.src = ag.iconUrl;
          img.alt = "";
          img.addEventListener("error", () => img.remove(), { once: true });
          left.appendChild(img);
        }
        left.appendChild(document.createTextNode(ag.name));
        const ready = ag.enabled && ag.integrationInstalled;
        const pill = createText(
          "span",
          `status-pill${ready ? " is-ready" : ""}`,
          !ag.integrationInstalled ? wt("agentUninstalled") : (ag.enabled ? wt("agentReady") : wt("agentPaused"))
        );
        r.append(left, pill);
        wsRuntimeListEl.appendChild(r);
      }
    }
  }
}

function initWorkspaceControls() {
  wsOpenGeminiUsage?.addEventListener("click", () => {
    void window.dashboardAPI?.workspaceAction({ type: "open-gemini-chat-usage" }).catch(() => {});
  });
  if (!hasWorkspaceDom()) return;

  if (wsNavEl) {
    wsNavEl.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-ws-view]");
      if (!btn) return;
      const next = btn.getAttribute("data-ws-view");
      if (next && next !== workspaceView) {
        workspaceView = next;
        render({ force: true });
      }
    });
  }

  if (wsReadGeminiQuota) {
    wsReadGeminiQuota.addEventListener("click", () => {
      void runGeminiRead();
    });
  }

  if (wsBtnCommandEl) {
    wsBtnCommandEl.addEventListener("click", () => {
      if (window.dashboardAPI && typeof window.dashboardAPI.workspaceAction === "function") {
        void window.dashboardAPI.workspaceAction({ type: "open-command" });
      }
    });
  }

  if (wsBtnCodexEl) {
    wsBtnCodexEl.addEventListener("click", () => {
      if (window.dashboardAPI && typeof window.dashboardAPI.workspaceAction === "function") {
        void window.dashboardAPI.workspaceAction({ type: "launch-client", clientId: "codex" });
      }
    });
  }

  if (wsBtnAntigravityEl) {
    wsBtnAntigravityEl.addEventListener("click", () => {
      if (window.dashboardAPI && typeof window.dashboardAPI.workspaceAction === "function") {
        void window.dashboardAPI.workspaceAction({ type: "launch-client", clientId: "antigravity" });
      }
    });
  }

  if (wsBtnSettingsEl) {
    wsBtnSettingsEl.addEventListener("click", () => {
      if (window.dashboardAPI && typeof window.dashboardAPI.workspaceAction === "function") {
        void window.dashboardAPI.workspaceAction({ type: "open-settings" });
      }
    });
  }

  if (wsBtnManageAgentsEl) {
    wsBtnManageAgentsEl.addEventListener("click", () => {
      if (window.dashboardAPI && typeof window.dashboardAPI.workspaceAction === "function") {
        void window.dashboardAPI.workspaceAction({ type: "open-settings", tab: "agents" });
      }
    });
  }
}

function render(options = {}) {
  // A round that ended settles here if no scroll or layout signal closed it
  // first: the guard must never stay armed indefinitely.
  if (scrollGuard.settling) handleScrollSignal();
  // The one-second elapsed-time tick normally rebuilds the entire card tree.
  // Replacing an open picker closes its menu, but focus alone must not block an
  // authoritative snapshot that carries a newly created automation grant.
  if ((activeEdit || hasOpenSessionAutomationPicker()) && !options.force) return;
  const automationFocusKey = sessionAutomationFocusKey();
  disposeSessionAutomationPickers();
  const sessions = Array.isArray(snapshot.sessions) ? snapshot.sessions : [];
  const count = sessions.length;
  const now = Date.now();
  const liveAutomationActionKeys = new Set(
    sessions.map((session) => automationActionKey(session)).filter(Boolean)
  );
  for (const record of Array.isArray(snapshot.sessionAutomationOrphans)
    ? snapshot.sessionAutomationOrphans
    : []) {
    if (record && record.sessionAutomationGrantId) {
      liveAutomationActionKeys.add(`grant:${record.sessionAutomationGrantId}`);
    }
  }
  for (const key of sessionAutomationActionState.keys()) {
    if (!liveAutomationActionKeys.has(key)) sessionAutomationActionState.delete(key);
  }
  pruneSessionFolderActionState(sessions, now);
  const isWsDom = hasWorkspaceDom();
  if (!isWsDom) {
    titleEl.textContent = t("dashboardWindowTitle");
    countEl.textContent = t("dashboardCount").replace("{n}", count);
  }
  document.title = isWsDom ? `Character OS · ${wt("workspaceTitle")}` : t("dashboardWindowTitle");
  renderQuotaSummary(snapshot);
  renderWorkspaceChrome(sessions);

  renderQuickBanner();

  if (isWsDom && workspaceView === "quotas") {
    return;
  }

  const approvalsCount = workspaceCtx && Array.isArray(workspaceCtx.pendingApprovals)
    ? workspaceCtx.pendingApprovals.length
    : 0;
  const orphanCount = Array.isArray(snapshot.sessionAutomationOrphans)
    ? snapshot.sessionAutomationOrphans.length
    : 0;

  if (isWsDom && workspaceView === "projects") {
    const projFragment = document.createDocumentFragment();
    appendProjectsSection(projFragment, sessions);
    contentEl.replaceChildren(projFragment);
    return;
  }

  const regClients = workspaceCtx?.agentRegistry?.clients || [];
  const regSessions = getDeduplicatedRegistrySessions(sessions);
  const hasRegistryContent = isWsDom && (regClients.length > 0 || regSessions.length > 0);

  // A round with a frozen presentation keeps rendering its own groups even if
  // every session in them disappeared — the numbered slots still belong to
  // this round and must not collapse into the generic empty state.
  if (count === 0 && orphanCount === 0 && approvalsCount === 0 && !hasRegistryContent && !(quick.active && quick.skeleton)) {
    if (isWsDom && workspaceView === "overview") {
      const layout = createOverviewLayout();
      appendAccessibilityGuideBanner(layout.main);
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.append(
        createText("div", "empty-title", wt("emptyTitle")),
        createText("div", "empty-body", wt("emptyBody"))
      );
      layout.main.appendChild(empty);
      appendSessionHistory(layout.main, now);
      appendOverviewQuotasSection(layout.rail, now);
      appendProjectsSection(layout.rail, sessions);
      contentEl.replaceChildren(layout.root);
      return;
    }
    renderEmpty();
    return;
  }

  const byId = new Map(sessions.map((session) => [session.id, session]));
  const fragment = document.createDocumentFragment();

  appendPendingApprovalsSection(fragment, now);
  // Overview: clients, sessions and history on the left, quotas and projects in a rail.
  // While a round is on, the groups come from its frozen presentation; the
  // ordinary dynamic ordering resumes as soon as it ends.
  const overview = isWsDom && workspaceView === "overview";
  const layout = overview ? createOverviewLayout() : null;
  const mainHost = layout ? layout.main : fragment;
  if (isWsDom) {
    appendAccessibilityGuideBanner(mainHost);
    appendAgentClientsSection(mainHost);
  }
  if (layout && !quick.active) appendOverviewQuotasSection(layout.rail, now);
  if (count > 0 || (quick.active && quick.skeleton)) {
    appendSessionGroups(mainHost, byId, now);
  }
  if (isWsDom) {
    appendRegistrySessionsSection(mainHost, sessions, now);
  }
  if (layout) appendProjectsSection(layout.rail, sessions);
  appendSessionAutomationOrphans(mainHost);
  appendSessionHistory(mainHost, now);
  if (layout) fragment.appendChild(layout.root);

  contentEl.replaceChildren(fragment);
  restoreSessionAutomationFocus(automationFocusKey);
}

async function init() {
  initWorkspaceControls();
  window.dashboardAPI.onLangChange((payload) => {
    i18nPayload = payload || i18nPayload;
    lastWorkspaceRailSig = "";
    render();
    syncKimiQuotaRefreshControl();
  });
  if (typeof window.dashboardAPI.onSelectView === "function") {
    window.dashboardAPI.onSelectView((view) => {
      if (view === "overview" || view === "sessions" || view === "projects" || view === "quotas") {
        workspaceView = view;
        render({ force: true });
      }
    });
  }
  window.dashboardAPI.onSessionSnapshot((nextSnapshot) => {
    const hadKimiQuota = snapshotHasKimiQuota(snapshot);
    const previousSessionKey = liveSessionKey(snapshot);
    snapshot = nextSnapshot || snapshot;
    if (hadKimiQuota !== snapshotHasKimiQuota(snapshot)) {
      void reloadKimiQuotaStatus();
    }
    if (previousSessionKey !== liveSessionKey(snapshot)) {
      void reloadSessionHistory({ rerender: false });
    }
    if (activeEdit && !snapshotHasSession(snapshot, activeEdit.sessionId)) {
      activeEdit = null;
      render({ force: true });
      return;
    }
    render();
  });

  const [nextI18n, nextSnapshot, nextKimiQuotaStatus, nextWorkspaceCtx] = await Promise.all([
    window.dashboardAPI.getI18n(),
    window.dashboardAPI.getSnapshot(),
    window.dashboardAPI && typeof window.dashboardAPI.getKimiQuotaStatus === "function"
      ? window.dashboardAPI.getKimiQuotaStatus().catch(() => null)
      : Promise.resolve(null),
    window.dashboardAPI && typeof window.dashboardAPI.getWorkspaceContext === "function"
      ? window.dashboardAPI.getWorkspaceContext().catch(() => null)
      : Promise.resolve(null),
  ]);
  i18nPayload = nextI18n || i18nPayload;
  snapshot = nextSnapshot || snapshot;
  kimiQuotaStatus = nextKimiQuotaStatus || null;
  if (nextWorkspaceCtx && !nextWorkspaceCtx.reason && typeof nextWorkspaceCtx === "object") {
    workspaceCtx = nextWorkspaceCtx;
  }
  render();
  void reloadSessionHistory();

  setInterval(render, 1000);
  if (hasWorkspaceDom()) {
    setInterval(() => {
      const prevRegAt = workspaceCtx?.agentRegistry?.updatedAt || 0;
      const prevAxTrusted = workspaceCtx?.agentRegistry?.accessibility?.trusted;
      void reloadWorkspaceContext().then(() => {
        const nextRegAt = workspaceCtx?.agentRegistry?.updatedAt || 0;
        const nextAxTrusted = workspaceCtx?.agentRegistry?.accessibility?.trusted;
        if (nextRegAt !== prevRegAt || nextAxTrusted !== prevAxTrusted) {
          render();
        } else {
          renderWorkspaceChrome(snapshot.sessions || []);
        }
      });
    }, 3000);
  }

  initQuickMode();
}

function initQuickMode() {
  const api = window.dashboardAPI;
  // Linux never registers the shortcut and never exposes these channels; the
  // shared page simply stays an ordinary Dashboard there.
  if (!api || typeof api.quickEnter !== "function") return;

  // Anything that starts real text entry during the 120ms quiet period must
  // drop the queued jump: the user is typing, not navigating.
  document.addEventListener("compositionstart", () => {
    composing = true;
    cancelPendingActivation();
  });
  document.addEventListener("compositionend", () => { composing = false; });
  document.addEventListener("compositionupdate", cancelPendingActivation);
  document.addEventListener("focusin", (event) => {
    if (isEditableElement(event && event.target)) cancelPendingActivation();
  });
  document.addEventListener("input", cancelPendingActivation);
  // Capture phase so the mode sees keys before page controls, while still
  // deferring to any focused editable target.
  document.addEventListener("keydown", handleQuickKeydown, true);
  document.addEventListener("keyup", handleQuickKeyup, true);
  // A real page blur cancels an unsubmitted jump; main ends the round too.
  window.addEventListener("blur", cancelPendingActivation);
  window.addEventListener("beforeunload", cancelPendingActivation);

  // Scroll continuity (see the guard near the top of this file): these are the
  // signals a host transfer produces, plus the gestures that must always win
  // over the remembered offset. Scrolling keys are handled in
  // handleQuickKeydown, which is on document capture and therefore sees a key
  // whatever it is aimed at.
  if (contentEl && typeof contentEl.addEventListener === "function") {
    // Passive: these only read state, and a non-passive wheel listener would
    // make the compositor wait for JS on every scroll.
    contentEl.addEventListener(
      "scroll",
      () => { handleScrollSignal({ fromScrollEvent: true }); },
      { passive: true }
    );
    // Chromium fires `scrollend` once a scroll and any animation it started
    // have finished (shipped in Chrome 114; this app runs a much newer
    // Chromium). Where it is missing, a reversal still ends the gesture.
    contentEl.addEventListener("scrollend", endScrollGesture, { passive: true });
    contentEl.addEventListener("wheel", () => noteScrollIntent(), { passive: true });
    contentEl.addEventListener("pointerdown", () => { scrollGuard.held = true; }, { passive: true });
    // A drag usually ends outside the scroller, so the release is watched on
    // the document.
    document.addEventListener("pointerup", endScrollHold, { passive: true });
    document.addEventListener("pointercancel", endScrollHold, { passive: true });
    // A key that scrolls can be aimed anywhere, so it is marked from the
    // document-capture handler in handleQuickKeydown, not from here.
    if (typeof ResizeObserver === "function") {
      try {
        // Entering or leaving the mode re-lays the scroller out (the banner
        // alone changes its height), so this fires right after the layout that
        // could have dropped the offset.
        new ResizeObserver(() => { handleScrollSignal(); }).observe(contentEl);
      } catch { /* no observer: the scroll signal still covers the usual case */ }
    }
  }

  api.onQuickIntent((payload) => {
    void beginQuickRound(payload && payload.revision);
  });
  api.onQuickEntries((payload) => {
    if (!payload || !quick.active || payload.revision !== quick.revision) return;
    quick.entries = Array.isArray(payload.entries) ? payload.entries : [];
    render();
  });
  api.onQuickDismissed((payload) => {
    // Strictly the round that ended: a late dismissal cannot cancel a new one.
    if (!payload || payload.revision !== quick.revision) return;
    endQuickRound();
  });

  // A shortcut pressed while this page was still loading left a pending round.
  if (typeof api.quickPending === "function") {
    api.quickPending().then((result) => {
      if (result && result.status === "ok" && result.revision) {
        void beginQuickRound(result.revision);
      }
    }).catch(() => {});
  }
}

init().catch((err) => {
  contentEl.textContent = err && err.message ? err.message : String(err);
});
