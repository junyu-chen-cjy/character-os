"use strict";

// Observe the two official quota surfaces without changing app focus or menus.
const { parentPort, workerData } = require("node:worker_threads");
const koffi = require("koffi");

const K_UTF8 = 0x08000100;
const GEMINI_BUNDLE = "com.google.GeminiMacOS";
const CHROME_BUNDLE = "com.google.Chrome";

function read() {
  const foundation = koffi.load("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation");
  const appServices = koffi.load("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices");
  const appKit = koffi.load("/System/Library/Frameworks/AppKit.framework/AppKit");
  const objc = koffi.load("/usr/lib/libobjc.A.dylib");
  const createString = foundation.func("void *CFStringCreateWithCString(void *, const char *, uint32_t)");
  const getString = foundation.func("bool CFStringGetCString(void *, void *, long, uint32_t)");
  const getType = foundation.func("unsigned long CFGetTypeID(void *)");
  const urlType = foundation.func("unsigned long CFURLGetTypeID()")();
  const urlString = foundation.func("void *CFURLGetString(void *)");
  const stringType = foundation.func("unsigned long CFStringGetTypeID()")();
  const arrayType = foundation.func("unsigned long CFArrayGetTypeID()")();
  const getCount = foundation.func("long CFArrayGetCount(void *)");
  const getItem = foundation.func("void *CFArrayGetValueAtIndex(void *, long)");
  const release = foundation.func("void CFRelease(void *)");
  const retain = foundation.func("void *CFRetain(void *)");
  const createApp = appServices.func("void *AXUIElementCreateApplication(int)");
  const setTimeout = appServices.func("int AXUIElementSetMessagingTimeout(void *, float)");
  const copyAttr = appServices.func("int AXUIElementCopyAttributeValue(void *, void *, _Out_ void **)");
  const getClass = objc.func("void *objc_getClass(const char *)");
  const selector = objc.func("void *sel_registerName(const char *)");
  const msg = objc.func("void *objc_msgSend(void *, void *)");
  const msgObject = objc.func("void *objc_msgSend(void *, void *, void *)");
  const msgIndex = objc.func("void *objc_msgSend(void *, void *, unsigned long)");
  const msgInt = objc.func("int objc_msgSend(void *, void *)");
  const msgCount = objc.func("unsigned long objc_msgSend(void *, void *)");
  const drain = objc.func("void objc_msgSend(void *, void *)");
  const pool = msg(msg(getClass("NSAutoreleasePool"), selector("alloc")), selector("init"));
  // Hold the framework handle for the lifetime of the Objective-C calls.
  void appKit;
  const isChat = workerData?.service === "gemini-chat";
  const bundle = createString(null, isChat ? CHROME_BUNDLE : GEMINI_BUNDLE, K_UTF8);
  const attributes = new Map();
  let app;

  function axName(name) {
    if (!attributes.has(name)) attributes.set(name, createString(null, name, K_UTF8));
    return attributes.get(name);
  }
  function attribute(element, name) {
    const value = [null];
    return copyAttr(element, axName(name), value) === 0 ? value[0] : null;
  }

  function getText(element, name) {
    const value = attribute(element, name);
    if (!value) return "";
    try {
      const type = getType(value);
      if (type !== stringType && type !== urlType) return "";
      const buffer = Buffer.alloc(4096);
      if (!getString(type === urlType ? urlString(value) : value, buffer, buffer.length, K_UTF8)) return "";
      const end = buffer.indexOf(0);
      return buffer.subarray(0, end === -1 ? buffer.length : end).toString("utf8").trim();
    } finally {
      release(value);
    }
  }

  const deadline = Date.now() + 2700;
  let remaining = 700;
  function visit(element, fn, depth = 0, childrenName = "AXChildren", skipWebContent = false) {
    if (!element || --remaining < 0 || depth > 26 || Date.now() >= deadline) return null;
    const result = fn(element);
    if (result) return result;
    if (skipWebContent && getText(element, "AXRole") === "AXWebArea") return null;
    const children = attribute(element, childrenName);
    if (!children) return null;
    try {
      if (getType(children) !== arrayType) return null;
      for (let i = 0, count = Math.min(getCount(children), 200); i < count && remaining > 0; i++) {
        const found = visit(getItem(children, i), fn, depth + 1, "AXChildren", skipWebContent);
        if (found) return found;
      }
    } finally {
      release(children);
    }
    return null;
  }

  try {
    const instances = msgObject(
      getClass("NSRunningApplication"), selector("runningApplicationsWithBundleIdentifier:"), bundle,
    );
    if (!instances || msgCount(instances, selector("count")) !== 1) return { status: isChat ? "open-usage" : "open-gemini" };
    const instance = msgIndex(instances, selector("objectAtIndex:"), 0);
    const pid = msgInt(instance, selector("processIdentifier"));
    if (pid <= 0) return { status: "open-gemini" };
    app = createApp(pid);
    if (!app) return { status: "unavailable" };
    setTimeout(app, 0.22);

    const role = element => getText(element, "AXRole");
    const labelMatches = (element, pattern) => ["AXTitle", "AXDescription"]
      .some(name => pattern.test(getText(element, name)));
    function readPanel(root) {
      const words = [];
      const panel = visit(root, element => role(element) === "AXGroup"
        && labelMatches(element, /^View Usage$/i) && retain(element));
      if (!panel) return { status: "open-usage" };
      try {
        visit(panel, row => {
          const type = role(row);
          const names = type === "AXGroup" ? ["AXTitle", "AXDescription"]
            : type === "AXStaticText" ? ["AXValue", "AXTitle", "AXDescription"] : [];
          const text = names.map(name => getText(row, name)).find(Boolean);
          if (text) words.push(text);
          return null;
        });
      } finally { release(panel); }
      if (words.some(word => /^Refreshing\b/i.test(word))) return { status: "refreshing" };
      return { status: "ok", text: words.join(" ") };
    }
    function visitWindow(name, match, skipWebContent = false) {
      const window = attribute(app, name);
      if (!window) return null;
      try { return visit(window, match, 0, "AXChildren", skipWebContent); } finally { release(window); }
    }
    if (isChat) {
      const usagePage = element => {
        if (role(element) !== "AXWebArea") return null;
        try {
          const address = getText(element, "AXURL") || getText(element, "AXDocument");
          const url = new URL(address);
          if (url.origin === "https://gemini.google.com" && url.pathname === "/usage") return retain(element);
        } catch { /* Other pages never enter the quota reader. */ }
        return null;
      };
      const page = visitWindow("AXFocusedWindow", usagePage, true) || visitWindow("AXMainWindow", usagePage, true)
        || visit(app, usagePage, 0, "AXWindows", true);
      if (!page) return { status: "open-usage" };
      try {
        const list = visit(page, element => role(element) === "AXList"
          && labelMatches(element, /^(?:用量周期|用量週期|Usage (?:periods|windows))$/i) && retain(element));
        if (!list) return { status: "unrecognized" };
        try {
          const words = [];
          visit(list, element => {
            if (role(element) === "AXStaticText") words.push(getText(element, "AXValue"));
            return null;
          });
          let updated = null;
          const container = attribute(list, "AXParent");
          if (container) {
            try {
              if (role(container) !== "AXWebArea") {
                updated = visit(container, element => {
                  if (role(element) !== "AXStaticText") return null;
                  const value = getText(element, "AXValue");
                  return /(?:分钟前更新|分鐘前更新|刚刚更新|剛剛更新|^Updated\b)/i.test(value) ? value : null;
                });
              }
            } finally { release(container); }
          }
          return { status: "ok", text: words.join(" "), updated };
        } finally { release(list); }
      } finally { release(page); }
    }
    const match = element => role(element) === "AXWebArea"
      && labelMatches(element, /^Antigravity$/i) && retain(element);
    const webArea = visitWindow("AXFocusedWindow", match) || visitWindow("AXMainWindow", match)
      || visit(app, match, 0, "AXWindows");
    if (!webArea) return { status: "open-usage" };
    try { return readPanel(webArea); } finally { release(webArea); }
  } finally {
    if (app) release(app);
    for (const value of attributes.values()) if (value) release(value);
    if (bundle) release(bundle);
    if (pool) drain(pool, selector("drain"));
  }
}

try { parentPort.postMessage(read()); } catch {
  parentPort.postMessage({ status: "unavailable" });
}
