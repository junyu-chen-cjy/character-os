"use strict";

// Uses the normal /usage document and Chrome's own logged-in session.
// No cookies API, private RPC, response-header changes, or chat pages.
const USAGE_URL = "https://gemini.google.com/usage";
const PERIODIC_ALARM = "quota";
const RETRY_ALARM = "quota-retry";
const PERIOD_MINUTES = 10;
const RETRY_MINUTES = 2;

let pending;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function extractUsage() {
  const list = document.querySelector('[aria-label="用量周期"], [aria-label="用量週期"], [aria-label="Usage periods"], [aria-label="Usage windows"]');
  if (!list) return null;
  const parent = list.parentElement;
  const updated = [...parent.querySelectorAll('*')].filter(el => !el.children.length)
    .map(el => el.textContent.trim()).find(text => /^(?:刚刚更新|剛剛更新|\d+\s*(?:分钟|分鐘|小时|小時)前更新|Updated\s+(?:just now|\d+\s+(?:minutes?|hours?)\s+ago))$/i.test(text));
  return updated ? { text: list.innerText.slice(0, 3000), updated } : null;
}

async function deliver(report) {
  const saved = await chrome.storage.local.get("port");
  const ports = [...new Set([saved.port, ...Array.from({ length: 20 }, (_, i) => 23333 + i)].filter(Boolean))];
  for (const port of ports) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/quota/gemini-browser`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Character-Quota": "1" },
        body: JSON.stringify(report),
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok && response.headers.get("X-Character-Quota") === "1") {
        await chrome.storage.local.set({ port });
        return true;
      }
    } catch { /* Try the app's next supported port. */ }
  }
  return false;
}

async function sync() {
  let tab;
  try {
    // An inactive top-level tab preserves Google's normal frame/auth policies.
    tab = await chrome.tabs.create({ url: USAGE_URL, active: false });
    let report;
    let authNeeded = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      await wait(1000);
      const current = await chrome.tabs.get(tab.id).catch(() => null);
      if (!current) break;
      if (current.url && /accounts\.google\.com/i.test(current.url)) {
        authNeeded = true;
        break;
      }
      if (!current.url || new URL(current.url).origin !== "https://gemini.google.com"
          || new URL(current.url).pathname !== "/usage") continue;
      const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractUsage }).catch(() => null);
      report = results?.[0]?.result;
      if (report) break;
    }
    const delivered = report ? await deliver({ ...report, observedAt: Date.now() }) : false;
    const status = delivered ? "ok" : authNeeded ? "auth-required" : "unavailable";
    await chrome.storage.local.set({
      status,
      checkedAt: Date.now(),
      ...(delivered ? { lastOkAt: Date.now() } : {}),
    });
    await chrome.action.setBadgeText({ text: delivered ? "" : "!" });
    if (delivered) {
      await chrome.alarms.clear(RETRY_ALARM);
    } else if (!authNeeded) {
      // Transient failure (e.g. Mac waking from sleep / Wi-Fi reconnecting): retry in 2 min.
      chrome.alarms.create(RETRY_ALARM, { delayInMinutes: RETRY_MINUTES });
    }
  } finally {
    if (tab) {
      // Leave the tab if the user navigated to it or started signing in.
      const current = await chrome.tabs.get(tab.id).catch(() => null);
      if (current && !current.active && current.url?.startsWith(USAGE_URL)) {
        await chrome.tabs.remove(tab.id).catch(() => {});
      }
    }
  }
}

function poll() {
  pending ??= sync().catch(async () => {
    await chrome.action.setBadgeText({ text: "!" }).catch(() => {});
    chrome.alarms.create(RETRY_ALARM, { delayInMinutes: RETRY_MINUTES });
  }).finally(() => { pending = null; });
  return pending;
}

async function ensureAlarm() {
  const existing = await chrome.alarms.get(PERIODIC_ALARM);
  if (!existing) {
    chrome.alarms.create(PERIODIC_ALARM, { periodInMinutes: PERIOD_MINUTES, delayInMinutes: 1 });
  }
}

function start() {
  chrome.alarms.create(PERIODIC_ALARM, { periodInMinutes: PERIOD_MINUTES, delayInMinutes: 1 });
  void poll();
}

// Self-heal the periodic alarm whenever Chrome wakes the MV3 service worker.
void ensureAlarm();

chrome.runtime.onInstalled.addListener(start);
chrome.runtime.onStartup.addListener(start);
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === PERIODIC_ALARM || alarm.name === RETRY_ALARM) {
    void ensureAlarm();
    void poll();
  }
});
chrome.action.onClicked.addListener(() => { void poll(); });
