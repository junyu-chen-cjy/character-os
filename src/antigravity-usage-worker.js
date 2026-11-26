"use strict";

// Read-only AX client for Gemini's open Antigravity model menu. The worker
// shares Electron's accessibility grant and keeps cross-process AX calls off
// the main thread. It never presses controls or opens Gemini.
const { parentPort } = require("node:worker_threads");
const koffi = require("koffi");

const K_UTF8 = 0x08000100;
const GEMINI_BUNDLE = "com.google.GeminiMacOS";

function read() {
  const foundation = koffi.load("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation");
  const appServices = koffi.load("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices");
  const appKit = koffi.load("/System/Library/Frameworks/AppKit.framework/AppKit");
  const objc = koffi.load("/usr/lib/libobjc.A.dylib");
  const createString = foundation.func("void *CFStringCreateWithCString(void *, const char *, uint32_t)");
  const getString = foundation.func("bool CFStringGetCString(void *, void *, long, uint32_t)");
  const getType = foundation.func("unsigned long CFGetTypeID(void *)");
  const stringType = foundation.func("unsigned long CFStringGetTypeID()")();
  const arrayType = foundation.func("unsigned long CFArrayGetTypeID()")();
  const getCount = foundation.func("long CFArrayGetCount(void *)");
  const getItem = foundation.func("void *CFArrayGetValueAtIndex(void *, long)");
  const release = foundation.func("void CFRelease(void *)");
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
  const bundle = createString(null, GEMINI_BUNDLE, K_UTF8);
  const attributes = new Map();
  let app;

  function attribute(element, name) {
    if (!attributes.has(name)) attributes.set(name, createString(null, name, K_UTF8));
    const value = [null];
    return copyAttr(element, attributes.get(name), value) === 0 ? value[0] : null;
  }

  function getText(element, name) {
    const value = attribute(element, name);
    if (!value) return "";
    try {
      if (getType(value) !== stringType) return "";
      const buffer = Buffer.alloc(4096);
      if (!getString(value, buffer, buffer.length, K_UTF8)) return "";
      const end = buffer.indexOf(0);
      return buffer.subarray(0, end === -1 ? buffer.length : end).toString("utf8").trim();
    } finally {
      release(value);
    }
  }

  const deadline = Date.now() + 2700;
  let remaining = 550;
  function visit(element, fn, depth = 0, childrenName = "AXChildren") {
    if (!element || --remaining < 0 || depth > 26 || Date.now() >= deadline) return null;
    const result = fn(element);
    if (result) return result;
    const children = attribute(element, childrenName);
    if (!children) return null;
    try {
      if (getType(children) !== arrayType) return null;
      for (let i = 0, count = Math.min(getCount(children), 200); i < count && remaining > 0; i++) {
        const found = visit(getItem(children, i), fn, depth + 1);
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
    if (!instances || msgCount(instances, selector("count")) !== 1) return { status: "open-gemini" };
    const pid = msgInt(msgIndex(instances, selector("objectAtIndex:"), 0), selector("processIdentifier"));
    if (pid <= 0) return { status: "open-gemini" };
    app = createApp(pid);
    if (!app) return { status: "unavailable" };
    setTimeout(app, 0.22);

    const words = [];
    function locatePanel(element) {
      if (getText(element, "AXRole") !== "AXGroup"
          || !["AXTitle", "AXDescription"].some(name => getText(element, name) === "View Usage")) return null;
      visit(element, row => {
        const role = getText(row, "AXRole");
        const names = role === "AXGroup" ? ["AXTitle", "AXDescription"]
          : role === "AXStaticText" ? ["AXValue", "AXTitle", "AXDescription"] : [];
        const text = names.map(name => getText(row, name)).find(Boolean);
        if (text) words.push(text);
        return null;
      });
      return true;
    }
    function visitWindow(name) {
      const window = attribute(app, name);
      if (!window) return null;
      try { return visit(window, locatePanel); } finally { release(window); }
    }
    const found = visitWindow("AXFocusedWindow") || visitWindow("AXMainWindow")
      || visit(app, locatePanel, 0, "AXWindows");
    if (!found) return { status: "open-usage" };
    if (words.some(word => /^Refreshing\b/i.test(word))) return { status: "refreshing" };
    return { status: "ok", text: words.join(" ") };
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
