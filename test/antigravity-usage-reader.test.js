"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createAntigravityUsageRefresh, parseUsagePanel, GEMINI_ANTIGRAVITY_QUOTA_SOURCE } = require("../src/antigravity-usage-reader");
const { createAccountQuotaStore } = require("../src/state-account-quota");

const when = Date.UTC(2026, 10, 27, 1);
const observed = "Usage Gemini Models Weekly limit 77 % left Resets in 6d 20h 5h limit 7 % left Resets in 1h 23m";

test("maps the observed Antigravity display into existing quota buckets", () => {
  assert.deepEqual(parseUsagePanel(observed, when), {
    geminiWeekly: { usedPercent: 23, capturedAt: when, windowMinutes: 10080, resetAt: when + 164 * 3600000 },
    geminiFiveHour: { usedPercent: 93, capturedAt: when, windowMinutes: 300, resetAt: when + 83 * 60000 },
  });
  assert.deepEqual(parseUsagePanel("Third-party Models 5h limit 0% left", when), {
    thirdPartyFiveHour: { usedPercent: 100, capturedAt: when, windowMinutes: 300 },
  });
  assert.equal(parseUsagePanel("Gemini chat usage Weekly limit 99% left", when), null);
  assert.equal(parseUsagePanel("Gemini Models 5h limit 110% left", when), null);
  assert.equal(parseUsagePanel("Gemini Models 5h limit 7% left 5h limit 10% left", when), null);
  assert.deepEqual(parseUsagePanel("Gemini Models Weekly limit 77% left New Models 5h limit 4% left", when), {
    geminiWeekly: { usedPercent: 23, capturedAt: when, windowMinutes: 10080 },
  });
});

test("reads only on demand, requires trust, and keeps previous data on failure", async () => {
  let trusted = false;
  let tick = when;
  let reads = 0;
  let source = { status: "ok", text: observed };
  const reports = [];
  const refresh = createAntigravityUsageRefresh({
    isTrusted: () => trusted,
    now: () => tick,
    read: async () => { reads++; return source; },
    publish: group => reports.push(group),
  });
  assert.deepEqual(await refresh(), { status: "permission-required" });
  assert.equal(reads, 0);
  trusted = true;
  const first = refresh();
  assert.equal(refresh(), first);
  assert.deepEqual(await first, { status: "ok", capturedAt: when });
  assert.deepEqual(await refresh(), { status: "try-later" });
  tick += 6000;
  source = { status: "open-usage" };
  assert.deepEqual(await refresh(), { status: "open-usage" });
  assert.equal(reports.length, 1);
  assert.equal(reads, 2);
});

test("Gemini panel snapshots replace only their own Antigravity buckets", () => {
  let tick = when;
  const store = createAccountQuotaStore({ persistPath: null, now: () => tick });
  const input = parseUsagePanel(observed, tick);
  store.update(null, {
    codexQuota: { codexFiveHour: { usedPercent: 42 } },
    antigravityQuota: { thirdPartyFiveHour: { usedPercent: 55 } },
  });
  store.update(GEMINI_ANTIGRAVITY_QUOTA_SOURCE, { displayHost: "Gemini App", antigravityQuota: input });
  tick += 60000;
  store.update(GEMINI_ANTIGRAVITY_QUOTA_SOURCE, {
    displayHost: "Gemini App",
    antigravityQuota: parseUsagePanel("Gemini Models Weekly limit 75% left", tick),
  });
  const snapshot = store.snapshot();
  assert.equal(snapshot.find(source => source.host === "Gemini App").antigravityQuota.group.geminiFiveHour, undefined);
  const local = snapshot.find(source => !source.host);
  assert.equal(local.codexQuota.group.codexFiveHour.usedPercent, 42);
  assert.equal(local.antigravityQuota.group.thirdPartyFiveHour.usedPercent, 55);
});
