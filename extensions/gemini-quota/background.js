"use strict";

// Uses the normal /usage document and Chrome's own logged-in session.
// No cookies API, private RPC, response-header changes, or chat pages.
//
// Dynamic non-intrusive cadence:
//  - Checks lightweight local policy (`GET /quota/gemini-browser`) every 2 min
//    without opening any Chrome tab.
//  - Opens an inactive background tab ONLY when Character OS reports data is due
//    (2 min while active/near-reset, 10 min while idle), or reuses an already-open
//    gemini.google.com/usage tab without opening/closing anything.
const USAGE_URL = "https://gemini.google.com/usage";
const PERIODIC_ALARM = "quota";
const RETRY_ALARM = "quota-retry";
const CHECK_PERIOD_MINUTES = 2;
const RETRY_MINUTES = 2;
const MIN_SYNC_INTERVAL_MS = 60_000;
const FALLBACK_IDLE_INTERVAL_MS = 10 * 60_000;

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

async function getCandidatePorts() {
  const saved = await chrome.storage.local.get("port");
  return [...new Set([saved.port, ...Array.from({ length: 20 }, (_, i) => 23333 + i)].filter(Boolean))];
}

// Lightweight local check — zero browser tabs touched.
async function fetchRefreshPolicy() {
  const ports = await getCandidatePorts();
  for (const port of ports) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/quota/gemini-browser`, {
        method: "GET",
        headers: { "X-Character-Quota": "1" },
        signal: AbortSignal.timeout(1200),
      });
      if (response.ok && response.headers.get("X-Character-Quota") === "1") {
        await chrome.storage.local.set({ port });
        return await response.json();
      }
    } catch { /* Try next local port */ }
  }
  return null;
}

async function deliver(report) {
  const ports = await getCandidatePorts();
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

async function findExistingUsageTab() {
  try {
    const tabs = await chrome.tabs.query({ url: "https://gemini.google.com/usage*" });
    return Array.isArray(tabs) && tabs.length ? tabs[0] : null;
  } catch {
    return null;
  }
}

async function sync({ force = false } = {}) {
  const stored = await chrome.storage.local.get(["lastSyncAttemptAt", "lastOkAt"]);
  const now = Date.now();
  if (!force && stored.lastSyncAttemptAt && now - stored.lastSyncAttemptAt < MIN_SYNC_INTERVAL_MS) {
    return;
  }

  if (!force) {
    const policy = await fetchRefreshPolicy();
    if (policy) {
      if (!policy.shouldRefresh) return;
    } else if (stored.lastOkAt && now - stored.lastOkAt < FALLBACK_IDLE_INTERVAL_MS) {
      // Character OS not reachable: fall back conservatively to 10-minute cadence.
      return;
    }
  }

  await chrome.storage.local.set({ lastSyncAttemptAt: Date.now() });

  let createdTab = null;
  let targetTab = await findExistingUsageTab();
  try {
    if (!targetTab) {
      // Inactive background tab preserves Google's normal frame/auth policies without stealing focus.
      createdTab = await chrome.tabs.create({ url: USAGE_URL, active: false });
      targetTab = createdTab;
    }
    let report;
    let authNeeded = false;
    const maxAttempts = createdTab ? 20 : 4;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await wait(createdTab ? 1000 : 400);
      const current = await chrome.tabs.get(targetTab.id).catch(() => null);
      if (!current) break;
      if (current.url && /accounts\.google\.com/i.test(current.url)) {
        authNeeded = true;
        break;
      }
      if (!current.url || new URL(current.url).origin !== "https://gemini.google.com"
          || new URL(current.url).pathname !== "/usage") continue;
      const results = await chrome.scripting.executeScript({ target: { tabId: targetTab.id }, func: extractUsage }).catch(() => null);
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
      chrome.alarms.create(RETRY_ALARM, { delayInMinutes: RETRY_MINUTES });
    }
  } finally {
    if (createdTab) {
      // Leave the tab if the user navigated to it or started signing in.
      const current = await chrome.tabs.get(createdTab.id).catch(() => null);
      if (current && !current.active && current.url?.startsWith(USAGE_URL)) {
        await chrome.tabs.remove(createdTab.id).catch(() => {});
      }
    }
  }
}

function poll(options = {}) {
  pending ??= sync(options).catch(async () => {
    await chrome.action.setBadgeText({ text: "!" }).catch(() => {});
    chrome.alarms.create(RETRY_ALARM, { delayInMinutes: RETRY_MINUTES });
  }).finally(() => { pending = null; });
  return pending;
}

async function ensureAlarm() {
  const existing = await chrome.alarms.get(PERIODIC_ALARM);
  if (!existing || existing.periodInMinutes !== CHECK_PERIOD_MINUTES) {
    chrome.alarms.create(PERIODIC_ALARM, { periodInMinutes: CHECK_PERIOD_MINUTES, delayInMinutes: 1 });
  }
}

function start() {
  chrome.alarms.create(PERIODIC_ALARM, { periodInMinutes: CHECK_PERIOD_MINUTES, delayInMinutes: 1 });
  void poll({ force: true });
}

void ensureAlarm();

chrome.runtime.onInstalled.addListener(start);
chrome.runtime.onStartup.addListener(start);
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === PERIODIC_ALARM || alarm.name === RETRY_ALARM) {
    void ensureAlarm();
    void poll();
  }
});
chrome.action.onClicked.addListener(() => { void poll({ force: true }); });
