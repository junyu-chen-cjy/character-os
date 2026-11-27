"use strict";

// Native macOS Accessibility worker executed inside Electron's own process tree
// (worker_thread) so it inherits the exact macOS Accessibility trust granted to
// Character OS / Electron without spawning osascript or System Events.
const { parentPort, workerData } = require("node:worker_threads");
const { execFileSync } = require("node:child_process");
const koffi = require("koffi");

const K_UTF8 = 0x08000100;
const K_AX_VALUE_CGPOINT = 1;
const K_AX_VALUE_CGSIZE = 2;
const K_CG_HID_EVENT_TAP = 0;
const K_CG_EVENT_LEFT_MOUSE_DOWN = 1;
const K_CG_EVENT_LEFT_MOUSE_UP = 2;
const K_CG_MOUSE_BUTTON_LEFT = 0;
const K_CG_EVENT_FLAG_MASK_COMMAND = 0x00100000;
const KEYCODE_V = 9;
const KEYCODE_RETURN = 36;

const CGPoint = koffi.struct("CGPoint", { x: "double", y: "double" });
const CGSize = koffi.struct("CGSize", { width: "double", height: "double" });

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, ms));
}

function createAxRuntime() {
  const foundation = koffi.load("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation");
  const appServices = koffi.load("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices");
  const appKit = koffi.load("/System/Library/Frameworks/AppKit.framework/AppKit");
  const objc = koffi.load("/usr/lib/libobjc.A.dylib");
  void appKit;

  const createString = foundation.func("void *CFStringCreateWithCString(void *, const char *, uint32_t)");
  const getString = foundation.func("bool CFStringGetCString(void *, void *, long, uint32_t)");
  const getType = foundation.func("unsigned long CFGetTypeID(void *)");
  const stringType = foundation.func("unsigned long CFStringGetTypeID()")();
  const arrayType = foundation.func("unsigned long CFArrayGetTypeID()")();
  const boolType = foundation.func("unsigned long CFBooleanGetTypeID()")();
  const boolVal = foundation.func("bool CFBooleanGetValue(void *)");
  const getCount = foundation.func("long CFArrayGetCount(void *)");
  const getItem = foundation.func("void *CFArrayGetValueAtIndex(void *, long)");
  const release = foundation.func("void CFRelease(void *)");
  const retain = foundation.func("void *CFRetain(void *)");

  const isTrusted = appServices.func("bool AXIsProcessTrusted()");
  const createApp = appServices.func("void *AXUIElementCreateApplication(int)");
  const setMessagingTimeout = appServices.func("int AXUIElementSetMessagingTimeout(void *, float)");
  const copyAttr = appServices.func("int AXUIElementCopyAttributeValue(void *, void *, _Out_ void **)");
  const setAttr = appServices.func("int AXUIElementSetAttributeValue(void *, void *, void *)");
  const performAction = appServices.func("int AXUIElementPerformAction(void *, void *)");
  const axValueGetPoint = appServices.func("bool AXValueGetValue(void *, int, _Out_ CGPoint *)");
  const axValueGetSize = appServices.func("bool AXValueGetValue(void *, int, _Out_ CGSize *)");

  const cgCreateMouse = appServices.func("void *CGEventCreateMouseEvent(void *, uint32_t, CGPoint, uint32_t)");
  const cgCreateKey = appServices.func("void *CGEventCreateKeyboardEvent(void *, uint16_t, bool)");
  const cgSetFlags = appServices.func("void CGEventSetFlags(void *, uint64_t)");
  const cgPost = appServices.func("void CGEventPost(uint32_t, void *)");

  const getClass = objc.func("void *objc_getClass(const char *)");
  const selector = objc.func("void *sel_registerName(const char *)");
  const msg = objc.func("void *objc_msgSend(void *, void *)");
  const msgObject = objc.func("void *objc_msgSend(void *, void *, void *)");
  const msgIndex = objc.func("void *objc_msgSend(void *, void *, unsigned long)");
  const msgInt = objc.func("int objc_msgSend(void *, void *)");
  const msgBoolRet = objc.func("bool objc_msgSend(void *, void *)");
  const msgBoolArg = objc.func("void *objc_msgSend(void *, void *, bool)");
  const msgULongRet = objc.func("unsigned long objc_msgSend(void *, void *)");
  const msgActivate = objc.func("bool objc_msgSend(void *, void *, unsigned long)");

  const pool = msg(msg(getClass("NSAutoreleasePool"), selector("alloc")), selector("init"));
  const cfStrings = new Map();
  const cfTrue = msgBoolArg(getClass("NSNumber"), selector("numberWithBool:"), true);

  function cfStr(text) {
    if (!cfStrings.has(text)) cfStrings.set(text, createString(null, text, K_UTF8));
    return cfStrings.get(text);
  }

  function getAttr(el, name) {
    const out = [null];
    return copyAttr(el, cfStr(name), out) === 0 ? out[0] : null;
  }

  function getText(el, name) {
    const val = getAttr(el, name);
    if (!val) return "";
    try {
      if (getType(val) !== stringType) return "";
      const buf = Buffer.alloc(8192);
      if (!getString(val, buf, buf.length, K_UTF8)) return "";
      const end = buf.indexOf(0);
      return buf.subarray(0, end === -1 ? buf.length : end).toString("utf8").trim();
    } finally {
      release(val);
    }
  }

  function getBool(el, name) {
    const val = getAttr(el, name);
    if (!val) return null;
    try {
      return getType(val) === boolType ? boolVal(val) : null;
    } finally {
      release(val);
    }
  }

  function getFrame(el) {
    const posVal = getAttr(el, "AXPosition");
    const sizeVal = getAttr(el, "AXSize");
    if (!posVal || !sizeVal) {
      if (posVal) release(posVal);
      if (sizeVal) release(sizeVal);
      return null;
    }
    try {
      const pt = { x: 0, y: 0 };
      const sz = { width: 0, height: 0 };
      const okPt = axValueGetPoint(posVal, K_AX_VALUE_CGPOINT, pt);
      const okSz = axValueGetSize(sizeVal, K_AX_VALUE_CGSIZE, sz);
      if (!okPt || !okSz || sz.width <= 0 || sz.height <= 0) return null;
      return { x: pt.x, y: pt.y, width: sz.width, height: sz.height };
    } finally {
      release(posVal);
      release(sizeVal);
    }
  }

  function findRunningApp(bundleId) {
    const cfBid = createString(null, bundleId, K_UTF8);
    try {
      const list = msgObject(getClass("NSRunningApplication"), selector("runningApplicationsWithBundleIdentifier:"), cfBid);
      const count = list ? Number(msgULongRet(list, selector("count"))) : 0;
      if (!count) return null;
      const inst = msgIndex(list, selector("objectAtIndex:"), 0);
      return {
        inst,
        pid: msgInt(inst, selector("processIdentifier")),
        isHidden: msgBoolRet(inst, selector("isHidden")),
        isActive: msgBoolRet(inst, selector("isActive")),
      };
    } finally {
      release(cfBid);
    }
  }

  function activateRunningApp(running, bundleId, axApp) {
    // 1. LaunchServices `open -b` reliably switches macOS Spaces and activates
    //    background apps on macOS 14+ where NSRunningApplication.activateWithOptions
    //    is ignored for non-frontmost callers.
    if (bundleId) {
      try {
        execFileSync("/usr/bin/open", ["-b", bundleId], { timeout: 4000 });
      } catch {}
    }
    if (running && running.inst) {
      try {
        if (running.isHidden) msg(running.inst, selector("unhide"));
        msgActivate(running.inst, selector("activateWithOptions:"), 3);
      } catch {}
    }
    if (axApp) {
      try { setAttr(axApp, cfStr("AXFrontmost"), cfTrue); } catch {}
    }
  }

  function isAppFrontmost(axApp) {
    if (!axApp) return false;
    return getBool(axApp, "AXFrontmost") === true;
  }

  function readElementTextDeep(el) {
    if (!el) return "";
    const parts = [];
    const direct = getText(el, "AXValue");
    if (direct) parts.push(direct);
    walkTree(el, (node) => {
      if (node === el) return null;
      const role = getText(node, "AXRole");
      if (role === "AXStaticText" || role === "AXTextArea" || role === "AXTextField") {
        const v = getText(node, "AXValue") || getText(node, "AXTitle");
        if (v) parts.push(v);
      }
      return null;
    }, { maxDepth: 8, maxNodes: 120, timeoutMs: 400 });
    return normalizeLabel(parts.join(" "));
  }

  // Collects candidate windows including AXMainWindow / AXFocusedWindow so apps
  // on another macOS Space are STILL inspectable when AXWindows returns empty!
  function getAppWindows(axApp) {
    const out = [];
    const seenTitles = new Set();
    const tryAdd = (w) => {
      if (!w) return;
      const subrole = getText(w, "AXSubrole");
      const title = getText(w, "AXTitle");
      const frame = getFrame(w);
      const key = `${subrole}|${title}|${frame ? `${Math.round(frame.x)},${Math.round(frame.y)}` : ""}`;
      if (seenTitles.has(key)) { release(w); return; }
      seenTitles.add(key);
      out.push({ el: w, title, subrole, frame });
    };
    const mainWin = getAttr(axApp, "AXMainWindow");
    if (mainWin) tryAdd(mainWin);
    const focusedWin = getAttr(axApp, "AXFocusedWindow");
    if (focusedWin) tryAdd(focusedWin);
    const winsRef = getAttr(axApp, "AXWindows");
    if (winsRef) {
      try {
        if (getType(winsRef) === arrayType) {
          const count = Math.min(Number(getCount(winsRef)), 12);
          for (let i = 0; i < count; i++) {
            const item = getItem(winsRef, i);
            if (item) tryAdd(retain(item));
          }
        }
      } finally {
        release(winsRef);
      }
    }
    // Prefer standard windows first
    out.sort((a, b) => (b.subrole === "AXStandardWindow" ? 1 : 0) - (a.subrole === "AXStandardWindow" ? 1 : 0));
    return out;
  }

  function walkTree(root, visitor, { maxDepth = 42, maxNodes = 4200, timeoutMs = 2600 } = {}) {
    let visited = 0;
    const deadline = Date.now() + timeoutMs;
    function dfs(el, depth) {
      if (!el || depth > maxDepth || visited >= maxNodes || Date.now() >= deadline) return null;
      visited += 1;
      const stop = visitor(el, depth);
      if (stop) return stop;
      const children = getAttr(el, "AXChildren");
      if (!children) return null;
      try {
        if (getType(children) !== arrayType) return null;
        const count = Math.min(Number(getCount(children)), 180);
        for (let i = 0; i < count; i++) {
          const res = dfs(getItem(children, i), depth + 1);
          if (res) return res;
        }
      } finally {
        release(children);
      }
      return null;
    }
    const found = dfs(root, 0);
    return { found, visited };
  }

  function enableManualAccessibility(axApp) {
    setMessagingTimeout(axApp, 0.5);
    setAttr(axApp, cfStr("AXManualAccessibility"), cfTrue);
    setAttr(axApp, cfStr("AXEnhancedUserInterface"), cfTrue);
  }

  function clickAt(x, y) {
    const pt = { x, y };
    const down = cgCreateMouse(null, K_CG_EVENT_LEFT_MOUSE_DOWN, pt, K_CG_MOUSE_BUTTON_LEFT);
    const up = cgCreateMouse(null, K_CG_EVENT_LEFT_MOUSE_UP, pt, K_CG_MOUSE_BUTTON_LEFT);
    if (down) { cgPost(K_CG_HID_EVENT_TAP, down); release(down); }
    sleepSync(30);
    if (up) { cgPost(K_CG_HID_EVENT_TAP, up); release(up); }
  }

  function sendKey(keycode, flags = 0) {
    const down = cgCreateKey(null, keycode, true);
    const up = cgCreateKey(null, keycode, false);
    if (down) {
      if (flags) cgSetFlags(down, flags);
      cgPost(K_CG_HID_EVENT_TAP, down);
      release(down);
    }
    sleepSync(25);
    if (up) {
      if (flags) cgSetFlags(up, flags);
      cgPost(K_CG_HID_EVENT_TAP, up);
      release(up);
    }
  }

  function readClipboardText() {
    try { return execFileSync("/usr/bin/pbpaste", [], { timeout: 1500 }).toString("utf8"); } catch { return null; }
  }

  function writeClipboardText(text) {
    execFileSync("/usr/bin/pbcopy", [], { input: Buffer.from(String(text), "utf8"), timeout: 1500 });
  }

  function cleanup() {
    for (const s of cfStrings.values()) release(s);
    cfStrings.clear();
    if (pool) msg(pool, selector("drain"));
  }

  return {
    isTrusted,
    createApp,
    release,
    retain,
    cfStr,
    cfTrue,
    getAttr,
    setAttr,
    performAction,
    getText,
    getBool,
    getFrame,
    findRunningApp,
    activateRunningApp,
    isAppFrontmost,
    readElementTextDeep,
    getAppWindows,
    walkTree,
    enableManualAccessibility,
    clickAt,
    sendKey,
    readClipboardText,
    writeClipboardText,
    cleanup,
  };
}

function normalizeLabel(str) {
  return String(str || "").replace(/\s+/g, " ").trim();
}

function isAntigravityComposer(role, desc, title, placeholder) {
  if (role !== "AXTextArea" && role !== "AXTextField") return false;
  if (/message input|ask|prompt|reply|chat|输入/i.test(`${desc} ${title} ${placeholder}`)) return true;
  return role === "AXTextArea";
}

function isCodexComposer(role, desc, title, placeholder) {
  if (role !== "AXTextArea" && role !== "AXTextField") return false;
  if (/搜索|search|filter|查找/i.test(`${desc} ${title} ${placeholder}`)) return false;
  if (/随心输入|ask anything|message|prompt|输入|回复|follow.?up|reply/i.test(`${desc} ${title} ${placeholder}`)) return true;
  return role === "AXTextArea";
}

function parseAntigravityWebTitle(webAreaTitle) {
  // Real format observed: "<Conversation Title> - <project-name> - Antigravity"
  // or "<project-name> - Antigravity" / "Antigravity"
  const raw = normalizeLabel(webAreaTitle);
  if (!raw) return { title: "", project: "", isBlank: false };
  const stripped = raw.replace(/\s*[-–—]\s*Antigravity\s*$/i, "").trim();
  if (!stripped || /^Antigravity$/i.test(stripped)) {
    return { title: "", project: "", isBlank: true };
  }
  const idx = stripped.lastIndexOf(" - ");
  if (idx > 0) {
    const title = stripped.slice(0, idx).trim();
    const project = stripped.slice(idx + 3).trim();
    const isBlank = /^new conversation$/i.test(title) || /^新对话$/i.test(title);
    return { title, project, isBlank };
  }
  return { title: stripped, project: "", isBlank: /^new conversation$/i.test(stripped) };
}

function inspectSnapshot(ax, { bundleId, clientType }) {
  const trusted = Boolean(ax.isTrusted());
  const running = ax.findRunningApp(bundleId);
  if (!running || running.pid <= 0) {
    return { status: "ok", trusted, running: false, pid: null, windows: [] };
  }
  if (!trusted) {
    return {
      status: "ok",
      trusted: false,
      running: true,
      pid: running.pid,
      isHidden: running.isHidden,
      isActive: running.isActive,
      windows: [],
    };
  }

  const axApp = ax.createApp(running.pid);
  if (!axApp) return { status: "ok", trusted, running: true, pid: running.pid, windows: [] };

  try {
    ax.enableManualAccessibility(axApp);
    const wins = ax.getAppWindows(axApp);
    const result = {
      status: "ok",
      trusted: true,
      running: true,
      pid: running.pid,
      isHidden: running.isHidden,
      isActive: running.isActive,
      windowCount: wins.length,
      activeWindowTitle: "",
      webAreaTitle: "",
      activeConversationTitle: "",
      activeProjectName: "",
      isBlankDraft: false,
      hasComposer: false,
      composerHint: "",
      sidebarProjects: [],
      sidebarSessions: [],
    };

    const primary = wins.find((w) => w.subrole === "AXStandardWindow") || wins[0];
    if (primary) {
      result.activeWindowTitle = primary.title;
      const seenProjects = new Set();
      const seenSessions = new Set();
      const staticTexts = [];
      let blankSignals = 0;
      let isGenerating = false;

      ax.walkTree(primary.el, (el, depth) => {
        const role = ax.getText(el, "AXRole");
        const title = ax.getText(el, "AXTitle");
        const desc = ax.getText(el, "AXDescription");
        const ph = ax.getText(el, "AXPlaceholderValue");
        const label = normalizeLabel(title || desc);

        if (role === "AXWebArea" && title && !result.webAreaTitle) {
          result.webAreaTitle = title;
        }
        if (role === "AXButton" && /^(Stop|Stop generating|Cancel|停止|停止生成|中止)$/i.test(label)) {
          isGenerating = true;
        }

        if (clientType === "antigravity") {
          if (isAntigravityComposer(role, desc, title, ph) && !result.hasComposer) {
            result.hasComposer = true;
            result.composerHint = desc || title || ph || "Message input";
          }
          if (role === "AXButton" && /^Conversation:\s*/i.test(label)) {
            const convTitle = label.replace(/^Conversation:\s*/i, "").trim();
            if (convTitle && !seenSessions.has(convTitle)) {
              seenSessions.add(convTitle);
              result.sidebarSessions.push({ title: convTitle, label });
            }
          }
          if ((role === "AXLink" || role === "AXButton") && /^Project:\s*/i.test(label)) {
            const proj = label.replace(/^Project:\s*/i, "").trim();
            if (proj && !seenProjects.has(proj)) {
              seenProjects.add(proj);
              result.sidebarProjects.push(proj);
            }
          }
        } else if (clientType === "codex") {
          if (isCodexComposer(role, desc, title, ph) && !result.hasComposer) {
            result.hasComposer = true;
            result.composerHint = desc || title || ph || "Composer";
          }
          if (role === "AXStaticText") {
            const val = normalizeLabel(ax.getText(el, "AXValue"));
            if (val) {
              if (staticTexts.length < 120) staticTexts.push(val);
              if (/^(你想让我们在|中构建什么？|What would you like to build|Let'?s build|开始构建)/i.test(val)) {
                blankSignals += 1;
              }
            }
          }
          if (role === "AXButton" && label) {
            const newChatMatch = /^在\s+(.+?)\s+中开始新聊天$|^Start new chat in\s+(.+)$/i.exec(label);
            if (newChatMatch) {
              const proj = (newChatMatch[1] || newChatMatch[2] || "").trim();
              if (proj && !seenProjects.has(proj)) {
                seenProjects.add(proj);
                result.sidebarProjects.push(proj);
              }
            } else if (
              depth >= 29
              && label.length >= 2
              && label.length <= 120
              && !/^(置顶聊天|归档聊天|删除|更多|新聊天|首页|图像|定时任务|资料库|插件|代码审查|站点|项目|添加新项目|有可用更新|不在项目中工作|添加文件等内容|听写|开始新的语音聊天|帮我批准|完全访问|自动批准|Pin chat|Archive chat|New chat|Settings|Send|Stop|Dictate|Attach|Voice|Start voice chat|Work outside a project)$/i.test(label)
              && !seenProjects.has(label)
            ) {
              if (!seenSessions.has(label)) {
                seenSessions.add(label);
                result.sidebarSessions.push({ title: label, label });
              }
            }
          }
        }
        return null;
      });

      result.isGenerating = isGenerating;
      if (clientType === "codex") {
        // Remove project-folder header buttons that were visited before their "Start new chat in <proj>" child.
        result.sidebarSessions = result.sidebarSessions.filter((s) => !seenProjects.has(s.title));
      }

      if (clientType === "antigravity") {
        const parsed = parseAntigravityWebTitle(result.webAreaTitle || result.activeWindowTitle);
        result.activeConversationTitle = parsed.title;
        result.activeProjectName = parsed.project || result.sidebarProjects[0] || "";
        result.isBlankDraft = parsed.isBlank;
      } else if (clientType === "codex") {
        // First check whether an existing sidebar conversation is visibly open in the main pane
        // (its title appears both in the sidebar and the main thread header).
        let matchedActiveTitle = "";
        for (const sess of result.sidebarSessions) {
          const hits = staticTexts.filter((s) => s === sess.title).length;
          if (hits >= 2) {
            matchedActiveTitle = sess.title;
            break;
          }
        }
        if (matchedActiveTitle) {
          result.isBlankDraft = false;
          result.activeConversationTitle = matchedActiveTitle;
        } else {
          result.isBlankDraft = blankSignals > 0;
          if (result.isBlankDraft) {
            const idx = staticTexts.findIndex((s) => /^你想让我们在|What would you like to build/i.test(s));
            if (idx >= 0) {
              for (const proj of result.sidebarProjects) {
                if (staticTexts.slice(idx, idx + 4).some((s) => s.includes(proj))) {
                  result.activeProjectName = proj;
                  break;
                }
              }
            }
            result.activeConversationTitle = "";
          }
        }
      }
    }

    for (const w of wins) ax.release(w.el);
    return result;
  } finally {
    ax.release(axApp);
  }
}

function findButtonByTitle(ax, winEl, matcher) {
  const { found } = ax.walkTree(winEl, (el) => {
    const role = ax.getText(el, "AXRole");
    if (role !== "AXButton" && role !== "AXLink") return null;
    const label = normalizeLabel(ax.getText(el, "AXTitle") || ax.getText(el, "AXDescription"));
    if (label && matcher(label)) return ax.retain(el);
    return null;
  });
  return found;
}

function findComposerElement(ax, winEl, clientType) {
  const { found } = ax.walkTree(winEl, (el) => {
    const role = ax.getText(el, "AXRole");
    const desc = ax.getText(el, "AXDescription");
    const title = ax.getText(el, "AXTitle");
    const ph = ax.getText(el, "AXPlaceholderValue");
    const ok = clientType === "antigravity"
      ? isAntigravityComposer(role, desc, title, ph)
      : isCodexComposer(role, desc, title, ph);
    if (ok) return ax.retain(el);
    return null;
  });
  return found;
}

function focusSessionWindow(ax, { bundleId, clientType, targetTitle, isBlankDraft }) {
  if (!ax.isTrusted()) return { status: "needs_accessibility" };
  const running = ax.findRunningApp(bundleId);
  if (!running || running.pid <= 0) return { status: "app_not_running" };

  const axApp = ax.createApp(running.pid);
  if (!axApp) return { status: "unavailable" };

  try {
    ax.enableManualAccessibility(axApp);
    ax.activateRunningApp(running, bundleId, axApp);
    for (let i = 0; i < 10; i++) {
      sleepSync(180);
      if (ax.isAppFrontmost(axApp)) break;
    }
    const wins = ax.getAppWindows(axApp);
    const primary = wins.find((w) => w.subrole === "AXStandardWindow") || wins[0];
    if (!primary) return { status: "window_not_found" };
    ax.performAction(primary.el, ax.cfStr("AXRaise"));
    ax.setAttr(primary.el, ax.cfStr("AXMain"), ax.cfTrue);
    sleepSync(140);

    let switched = false;
    if (targetTitle && !isBlankDraft) {
      const needle = normalizeLabel(targetTitle).toLowerCase();
      const btn = findButtonByTitle(ax, primary.el, (label) => {
        const clean = label.replace(/^Conversation:\s*/i, "").trim().toLowerCase();
        return clean === needle || clean.includes(needle) || needle.includes(clean);
      });
      if (btn) {
        ax.performAction(btn, ax.cfStr("AXPress"));
        ax.release(btn);
        switched = true;
        sleepSync(350);
      }
    }
    for (const w of wins) ax.release(w.el);
    return { status: "ok", switched, frontmost: ax.isAppFrontmost(axApp) };
  } finally {
    ax.release(axApp);
  }
}

function checkConversationContainsSnippet(ax, winEl, snippet) {
  const needle = normalizeLabel(snippet).slice(0, 36).toLowerCase();
  if (!needle) return false;
  const { found } = ax.walkTree(winEl, (el) => {
    const role = ax.getText(el, "AXRole");
    if (role === "AXTextArea" || role === "AXTextField") return null;
    const text = normalizeLabel(ax.getText(el, "AXValue") || ax.getText(el, "AXTitle") || ax.getText(el, "AXDescription")).toLowerCase();
    if (text && text.includes(needle)) return true;
    return null;
  }, { maxDepth: 42, maxNodes: 5200, timeoutMs: 2200 });
  return Boolean(found);
}

function findSendButton(ax, winEl) {
  return findButtonByTitle(ax, winEl, (label) =>
    /^(Send|Send message|Submit|发送|发送消息|提交)$/i.test(label)
  );
}

function deliverMessage(ax, { bundleId, clientType, targetTitle, isBlankDraft, message }) {
  if (!ax.isTrusted()) {
    return { status: "error", deliveryStatus: "needs_accessibility", error: "Accessibility permission is required." };
  }
  const running = ax.findRunningApp(bundleId);
  if (!running || running.pid <= 0) {
    return { status: "error", deliveryStatus: "app_not_running", error: `Target app (${bundleId}) is not running.` };
  }

  const axApp = ax.createApp(running.pid);
  if (!axApp) {
    return { status: "error", deliveryStatus: "unavailable", error: "Failed to attach Accessibility handle." };
  }

  let prevClipboard = null;
  let clipboardTouched = false;
  try {
    ax.enableManualAccessibility(axApp);
    const wasFrontmost = ax.isAppFrontmost(axApp);
    if (!wasFrontmost) {
      ax.activateRunningApp(running, bundleId, axApp);
      // Wait for macOS activation + cross-Space animation to complete.
      sleepSync(650);
      for (let i = 0; i < 10; i++) {
        if (ax.isAppFrontmost(axApp)) break;
        ax.activateRunningApp(running, bundleId, axApp);
        sleepSync(220);
      }
    }
    if (!ax.isAppFrontmost(axApp)) {
      return {
        status: "error",
        deliveryStatus: "activation_failed",
        error: `Could not bring target app (${bundleId}) to the foreground. Aborted before touching clipboard or keyboard.`,
      };
    }

    const wins = ax.getAppWindows(axApp);
    const primary = wins.find((w) => w.subrole === "AXStandardWindow") || wins[0];
    if (!primary) {
      return { status: "error", deliveryStatus: "window_not_found", error: "No open standard window found for target app." };
    }
    ax.performAction(primary.el, ax.cfStr("AXRaise"));
    ax.setAttr(primary.el, ax.cfStr("AXMain"), ax.cfTrue);
    sleepSync(180);

    // 1. Verify or switch to the requested conversation before touching the composer.
    const currentSnap = inspectSnapshot(ax, { bundleId, clientType });
    const wantTitle = normalizeLabel(targetTitle || "");
    const activeMatchesTitle = (snap) => {
      if (!wantTitle) return true;
      const cur = normalizeLabel(snap.activeConversationTitle || snap.webAreaTitle || snap.activeWindowTitle).toLowerCase();
      const target = wantTitle.toLowerCase();
      return Boolean(cur && (cur === target || cur.includes(target) || target.includes(cur)));
    };

    if (isBlankDraft) {
      if (!currentSnap.isBlankDraft) {
        for (const w of wins) ax.release(w.el);
        return {
          status: "error",
          deliveryStatus: "session_mismatch",
          error: "The target client is no longer on the blank draft conversation. Aborted to avoid sending to the wrong chat.",
        };
      }
    } else if (wantTitle && !activeMatchesTitle(currentSnap)) {
      const targetLower = wantTitle.toLowerCase();
      const btn = findButtonByTitle(ax, primary.el, (label) => {
        const clean = label.replace(/^Conversation:\s*/i, "").trim().toLowerCase();
        return clean === targetLower || clean.includes(targetLower) || targetLower.includes(clean);
      });
      if (!btn) {
        for (const w of wins) ax.release(w.el);
        return {
          status: "error",
          deliveryStatus: "session_not_found",
          error: `Could not locate target conversation "${wantTitle}" in sidebar. Aborted automatic send.`,
        };
      }
      ax.performAction(btn, ax.cfStr("AXPress"));
      ax.release(btn);
      // Wait up to 2.4s for the switched conversation to become active & verify!
      let verified = false;
      for (let i = 0; i < 6; i++) {
        sleepSync(400);
        const afterSwitch = inspectSnapshot(ax, { bundleId, clientType });
        if (activeMatchesTitle(afterSwitch)) {
          verified = true;
          break;
        }
      }
      if (!verified) {
        for (const w of wins) ax.release(w.el);
        return {
          status: "error",
          deliveryStatus: "session_verification_failed",
          error: `Switched sidebar item for "${wantTitle}", but could not confirm the active conversation identity. Aborted automatic send.`,
        };
      }
    }

    // 2. Locate and focus the exact composer AXTextArea inside the verified window.
    const composer = findComposerElement(ax, primary.el, clientType);
    if (!composer) {
      for (const w of wins) ax.release(w.el);
      return {
        status: "error",
        deliveryStatus: "composer_not_found",
        error: "Could not locate the message input field inside the target window.",
      };
    }

    try {
      const frame = ax.getFrame(composer);
      let isFocused = ax.getBool(composer, "AXFocused") === true;
      if (!isFocused) {
        ax.setAttr(composer, ax.cfStr("AXFocused"), ax.cfTrue);
        sleepSync(120);
        isFocused = ax.getBool(composer, "AXFocused") === true;
      }
      if (!isFocused && frame) {
        ax.clickAt(frame.x + Math.min(frame.width * 0.5, 120), frame.y + Math.min(frame.height * 0.5, 24));
        sleepSync(150);
        isFocused = ax.getBool(composer, "AXFocused") === true;
      }
      if (!isFocused) {
        ax.performAction(composer, ax.cfStr("AXPress"));
        sleepSync(120);
        isFocused = ax.getBool(composer, "AXFocused") === true;
      }
      const frontmostNow = ax.isAppFrontmost(axApp);
      if (!isFocused || !frontmostNow) {
        return {
          status: "error",
          deliveryStatus: "composer_not_focused",
          diagnostics: { isFocused, frontmost: frontmostNow, frame },
          error: `Located the composer input, but could not verify active keyboard focus in the foreground app (isFocused=${isFocused}, frontmost=${frontmostNow}). Aborted without pressing Return.`,
        };
      }

      // 3. Preserve clipboard, paste confirmed message, and VERIFY it actually entered the composer before submitting!
      const snippet18 = normalizeLabel(message).slice(0, 18).toLowerCase();
      const preText = ax.readElementTextDeep(composer);
      prevClipboard = ax.readClipboardText();
      ax.writeClipboardText(message);
      clipboardTouched = true;
      sleepSync(80);

      let pasteVerified = false;
      let observedComposerText = "";
      for (let tryPaste = 0; tryPaste < 2 && !pasteVerified; tryPaste++) {
        if (tryPaste > 0 && frame) {
          ax.clickAt(frame.x + Math.min(frame.width * 0.5, 120), frame.y + Math.min(frame.height * 0.5, 24));
          sleepSync(120);
        }
        ax.sendKey(KEYCODE_V, K_CG_EVENT_FLAG_MASK_COMMAND);
        for (let waitIdx = 0; waitIdx < 4; waitIdx++) {
          sleepSync(180);
          observedComposerText = ax.readElementTextDeep(composer);
          if (observedComposerText && (observedComposerText.toLowerCase().includes(snippet18) || observedComposerText.length >= preText.length + Math.min(8, message.length))) {
            pasteVerified = true;
            break;
          }
        }
      }

      if (!pasteVerified) {
        return {
          status: "error",
          deliveryStatus: "paste_not_observed",
          diagnostics: {
            frontmost: ax.isAppFrontmost(axApp),
            isFocused: ax.getBool(composer, "AXFocused") === true,
            preTextLen: preText.length,
            observedComposerTextLen: observedComposerText.length,
            frame,
          },
          error: "Focused composer and sent Cmd+V, but the pasted text was not observed in the composer. Aborted without pressing Return.",
        };
      }

      // 4. Submit with Return and verify composer cleared and/or transcript contains the message.
      ax.sendKey(KEYCODE_RETURN, 0);
      let composerCleared = false;
      let verifiedInConversation = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        sleepSync(450);
        const postVal = ax.readElementTextDeep(composer);
        composerCleared = !postVal || !postVal.toLowerCase().includes(snippet18);
        verifiedInConversation = checkConversationContainsSnippet(ax, primary.el, message);
        if (composerCleared && verifiedInConversation) break;
        // If text is still sitting in composer after 2 checks, try clicking an explicit Send button if present.
        if (attempt === 1 && !composerCleared) {
          const sendBtn = findSendButton(ax, primary.el);
          if (sendBtn) {
            ax.performAction(sendBtn, ax.cfStr("AXPress"));
            ax.release(sendBtn);
          }
        }
      }

      if (!composerCleared && !verifiedInConversation) {
        return {
          status: "error",
          deliveryStatus: "submit_not_verified",
          pasteVerified: true,
          composerCleared: false,
          verifiedInConversation: false,
          error: "Pasted text into composer, but neither composer clear nor message appearance in conversation was observed after Return.",
        };
      }

      return {
        status: "ok",
        deliveryStatus: "delivered",
        pasteVerified: true,
        verifiedInConversation,
        composerCleared,
        activeTitle: wantTitle || currentSnap.activeConversationTitle || "",
      };
    } finally {
      ax.release(composer);
      if (clipboardTouched && prevClipboard !== null) {
        try { ax.writeClipboardText(prevClipboard); } catch {}
      }
      for (const w of wins) ax.release(w.el);
    }
  } finally {
    ax.release(axApp);
  }
}

function run() {
  const ax = createAxRuntime();
  try {
    const cmd = workerData?.command;
    if (cmd === "inspect") return inspectSnapshot(ax, workerData);
    if (cmd === "focus") return focusSessionWindow(ax, workerData);
    if (cmd === "deliver") return deliverMessage(ax, workerData);
    return { status: "error", error: `Unknown worker command: ${cmd}` };
  } catch (err) {
    return { status: "error", error: err?.message || "Accessibility worker failed." };
  } finally {
    ax.cleanup();
  }
}

parentPort.postMessage(run());
