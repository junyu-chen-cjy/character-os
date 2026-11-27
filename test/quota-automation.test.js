"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createQuotaMonitor, parseUsagePanel } = require("../src/antigravity-usage-reader");
const { parseUsageRows, GEMINI_CHAT_SOURCE } = require("../src/gemini-chat-quota");
const { createAccountQuotaStore } = require("../src/state-account-quota");
const { sessionSnapshotSignature } = require("../src/state-session-snapshot");
const { primaryWindow } = require("../src/quota-view-model");

const now = new Date(2026, 10, 27, 18, 48).getTime();
const minute = 60000;

test("keeps Gemini Chat separate and preserves the official source timestamp", () => {
  const rows = "当前用量 已使用 1% 重置时间：19:23 每周限额 重置时间：12月1日12:23 已使用 2%";
  const parsed = parseUsageRows(rows, "5 分钟前更新", now);
  assert.equal(parsed.geminiChatFiveHour.capturedAt, now - 5 * minute);
  assert.equal(parsed.geminiChatFiveHour.usedPercent, 1);
  assert.equal(parsed.geminiChatFiveHour.resetAt, new Date(2026, 10, 27, 19, 23).getTime());
  assert.equal(parsed.geminiChatWeekly.usedPercent, 2);
  assert.equal(parsed.geminiChatWeekly.resetAt, new Date(2026, 11, 1, 12, 23).getTime());
  assert.equal(parseUsageRows(rows, null, now), null);
  const store = createAccountQuotaStore({ persistPath: null, now: () => now });
  store.update(GEMINI_CHAT_SOURCE, { geminiChatQuota: parsed });
  store.update(null, { antigravityQuota: { geminiFiveHour: { usedPercent: 80 } } });
  const sources = store.snapshot({ mergeSources: true });
  assert.equal(sources.length, 2);
  assert.equal(sources.find(s => s.geminiChatQuota).geminiChatQuota.lastSeenAt, now - 5 * minute);
  assert.equal(primaryWindow(sources, "geminiChatQuota", now).remaining, 98);
  assert.equal(primaryWindow(sources, "antigravityQuota", now).remaining, 20);
  const first = sessionSnapshotSignature({ sessions: [], accountQuota: sources });
  const entry = sources.find(s => s.geminiChatQuota);
  entry.geminiChatQuota.lastSeenAt += minute;
  assert.notEqual(sessionSnapshotSignature({ sessions: [], accountQuota: sources }), first);
});

test("matches Antigravity's actual shared model groups separately", () => {
  const sample = "Gemini Models 5h limit 60% left Claude and GPT Models Weekly limit 25% left";
  const parsed = parseUsagePanel(sample, now);
  assert.equal(parsed.geminiFiveHour.usedPercent, 40);
  assert.equal(parsed.thirdPartyWeekly.usedPercent, 75);
  assert.deepEqual(Object.keys(parsed), ["geminiFiveHour", "thirdPartyWeekly"]);
});

test("prefers the most depleted confirmed window and preserves the last figure after reset", () => {
  const accountQuota = [{ codexQuota: { group: {
    codexFiveHour: { usedPercent: 95, resetAt: now + minute, lastSeenAt: now },
    codexWeekly: { usedPercent: 90, resetAt: now + 2 * minute, lastSeenAt: now },
  } } }];
  assert.equal(primaryWindow(accountQuota, "codexQuota", now).windowMinutes, 300);
  assert.equal(primaryWindow(accountQuota, "codexQuota", now + minute).windowMinutes, 10080);
  const expired = primaryWindow(accountQuota, "codexQuota", now + 2 * minute);
  assert.equal(expired.expired, true);
  assert.equal(expired.remaining, 5);
});

test("polls passively during use, defers when locked, and advances the next refresh after completion", async () => {
  let time = now;
  let idle = "locked";
  const calls = [];
  const monitor = createQuotaMonitor({
    now: () => time,
    systemIdleState: () => idle,
    refresh: async mode => { calls.push(mode); return { status: "ok" }; },
  });
  await monitor.poll();
  assert.deepEqual(calls, []);
  idle = "active";
  await monitor.poll();
  await monitor.poll();
  assert.deepEqual(calls, [undefined]);
  time += 2 * minute;
  idle = "idle";
  monitor.observeSessions([{ id: "a", agentId: "antigravity-cli", badge: "running" }]);
  monitor.observeSessions([{ id: "a", agentId: "antigravity-cli", badge: "done" }]);
  await monitor.poll();
  assert.deepEqual(calls, [undefined]);
  time += 15000;
  await monitor.poll();
  assert.deepEqual(calls, [undefined, undefined]);
});
