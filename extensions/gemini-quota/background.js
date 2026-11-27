"use strict";

// Uses the normal /usage document and Chrome's own logged-in session.
// No cookies API, private RPC, response-header changes, or chat pages.
const USAGE_URL = "https://gemini.google.com/usage";
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
  const saved = await chrome.storage.local.get('port');
  const ports = [...new Set([saved.port, ...Array.from({length: 20}, (_, i) => 23333 + i)].filter(Boolean))];
  for (const port of ports) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/quota/gemini-browser`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Character-Quota': '1' },
        body: JSON.stringify(report), signal: AbortSignal.timeout(1500),
      });
      if (response.ok && response.headers.get('X-Character-Quota') === '1') {
        await chrome.storage.local.set({port}); return true;
      }
    } catch { /* Try the app's next supported port. */ }
  }
  return false;
}

async function sync() {
  let tab;
  try {
    // An inactive top-level tab preserves Google's normal frame/auth policies.
    tab = await chrome.tabs.create({url: USAGE_URL, active: false});
    let report;
    for (let attempt = 0; attempt < 20; attempt++) {
      await wait(1000);
      const current = await chrome.tabs.get(tab.id);
      if (!current.url || new URL(current.url).origin !== 'https://gemini.google.com'
          || new URL(current.url).pathname !== '/usage') continue;
      const results = await chrome.scripting.executeScript({target:{tabId:tab.id},func:extractUsage});
      report = results[0]?.result;
      if (report) break;
    }
    const delivered = report ? await deliver({...report, observedAt:Date.now()}) : false;
    await chrome.storage.local.set({status:delivered ? 'ok' : 'unavailable', checkedAt:Date.now()});
    await chrome.action.setBadgeText({text:delivered ? '' : '!'});
  } finally {
    if (tab) {
      // Leave the tab if the user navigated to it or started signing in.
      const current = await chrome.tabs.get(tab.id).catch(() => null);
      if (current && !current.active && current.url?.startsWith(USAGE_URL)) await chrome.tabs.remove(tab.id);
    }
  }
}
function poll() {
  pending ??= sync().catch(() => chrome.action.setBadgeText({text:'!'})).finally(() => {pending=null;});
  return pending;
}
function start() {
  chrome.alarms.create('quota',{periodInMinutes:10,delayInMinutes:1});
  void poll();
}
chrome.runtime.onInstalled.addListener(start);
chrome.runtime.onStartup.addListener(start);
chrome.alarms.onAlarm.addListener(alarm => {if(alarm.name==='quota') void poll();});
chrome.action.onClicked.addListener(() => {void poll();});
