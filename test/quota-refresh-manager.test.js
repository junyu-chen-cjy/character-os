"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

const {
  parseCodexAppServerRateLimits,
  queryCodexAppServerRateLimits,
} = require("../src/codex-app-server-quota");
const { createCliQuotaRefresh, classifyCliError } = require("../src/antigravity-cli-quota");
const { createQuotaRefreshManager } = require("../src/quota-refresh-manager");

describe("Codex active app-server quota query", () => {
  it("parses official account/rateLimits/read primary (5h) and secondary (7d) windows", () => {
    const now = 1795803000000;
    const parsed = parseCodexAppServerRateLimits({
      rateLimits: {
        limitId: "codex",
        primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1795821000 },
        secondary: { usedPercent: 36, windowDurationMins: 10080, resetsAt: 1796143315 },
      },
    }, now);
    assert.ok(parsed);
    assert.equal(parsed.codexFiveHour.usedPercent, 12);
    assert.equal(parsed.codexFiveHour.windowMinutes, 300);
    assert.equal(parsed.codexFiveHour.resetAt, 1795821000000);
    assert.equal(parsed.codexWeekly.usedPercent, 36);
    assert.equal(parsed.codexWeekly.windowMinutes, 10080);
    assert.equal(parsed.codexWeekly.resetAt, 1796143315000);
  });

  it("speaks JSON-RPC initialize -> initialized -> account/rateLimits/read and classifies auth errors", async () => {
    const written = [];
    const fakeSpawn = () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = {
        write(str) {
          written.push(str);
          const msg = JSON.parse(str.trim());
          if (msg.id === 1) {
            child.stdout.write(JSON.stringify({ id: 1, result: { codexHome: "/tmp" } }) + "\n");
          } else if (msg.id === 2) {
            child.stdout.write(JSON.stringify({
              id: 2,
              result: {
                rateLimits: {
                  primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: 1795821000 },
                  secondary: { usedPercent: 36, windowDurationMins: 10080, resetsAt: 1796143315 },
                  planType: "plus",
                },
              },
            }) + "\n");
          }
        },
        end() {},
      };
      child.kill = () => { child.killed = true; };
      return child;
    };

    const ok = await queryCodexAppServerRateLimits({
      binaryPath: "/fake/codex",
      spawnFn: fakeSpawn,
      capturedAtFn: () => 1795803000000,
    });
    assert.equal(ok.status, "ok");
    assert.equal(ok.group.codexFiveHour.usedPercent, 0);
    assert.equal(ok.group.codexWeekly.usedPercent, 36);
    assert.equal(written.length, 3);

    const authSpawn = () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = {
        write(str) {
          const msg = JSON.parse(str.trim());
          if (msg.id === 1) child.stdout.write(JSON.stringify({ id: 1, result: {} }) + "\n");
          else if (msg.id === 2) child.stdout.write(JSON.stringify({ id: 2, error: { message: "401 unauthorized login required" } }) + "\n");
        },
        end() {},
      };
      child.kill = () => {};
      return child;
    };
    const authRes = await queryCodexAppServerRateLimits({ binaryPath: "/fake/codex", spawnFn: authSpawn });
    assert.equal(authRes.status, "auth-required");
  });
});

describe("Antigravity CLI & Unified Quota Refresh Manager", () => {
  it("classifies CLI timeout, network, and auth errors and deduplicates concurrent refreshes", async () => {
    assert.equal(classifyCliError({ code: "ETIMEDOUT", killed: true }), "timeout");
    assert.equal(classifyCliError({ stderr: "Error: 401 unauthorized sign in" }), "auth-required");
    assert.equal(classifyCliError({ message: "getaddrinfo ENOTFOUND" }), "network-error");

    let execCount = 0;
    const refresh = createCliQuotaRefresh({
      publish: () => {},
      execute: async () => {
        execCount += 1;
        await new Promise((r) => setTimeout(r, 15));
        return {
          stdout: JSON.stringify({
            status: "SUCCESS",
            command: {
              name: "usage",
              data: {
                groups: [{
                  name: "Gemini Models",
                  buckets: [{ id: "5h", remaining_fraction: 0.9, reset_time: new Date(Date.now() + 3600_000).toISOString() }],
                }],
              },
            },
          }),
        };
      },
    });
    const [a, b] = await Promise.all([refresh({ force: true }), refresh({ force: true })]);
    assert.equal(execCount, 1);
    assert.equal(a.status, "ok");
    assert.equal(b.status, "ok");
  });

  it("handles startup refresh, failure backoff, simulated Mac sleep/wake recovery, and honest manual refreshAll", async () => {
    let clock = 1_795_800_000_000;
    const powerMonitor = new EventEmitter();
    let codexCalls = 0;
    let agyCalls = 0;
    let agyFailNext = true;

    const mgr = createQuotaRefreshManager({
      powerMonitor,
      now: () => clock,
      startupDelayMs: 0,
      wakeSettleMs: 0,
      setIntervalFn: () => ({ unref() {} }),
      clearIntervalFn: () => {},
      sources: {
        codex: {
          kind: "active",
          intervalMs: 5 * 60_000,
          refresh: async () => {
            codexCalls += 1;
            return { status: "ok", capturedAt: clock };
          },
        },
        antigravity: {
          kind: "active",
          intervalMs: 5 * 60_000,
          refresh: async () => {
            agyCalls += 1;
            if (agyFailNext) {
              agyFailNext = false;
              return { status: "network-error", error: "offline" };
            }
            return { status: "ok", capturedAt: clock };
          },
        },
        geminiChat: {
          kind: "passive",
          intervalMs: 10 * 60_000,
        },
      },
    });

    // Startup triggers both active sources
    mgr.start();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(codexCalls, 1);
    assert.equal(agyCalls, 1);
    assert.equal(mgr.getStatusSnapshot().antigravity.state, "error");
    assert.equal(mgr.getStatusSnapshot().antigravity.failureCount, 1);

    // Simulated Mac sleep & wake: clears backoff and immediately refreshes both active sources
    clock += 2 * 60_000;
    powerMonitor.emit("resume");
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(codexCalls, 2);
    assert.equal(agyCalls, 2);
    assert.equal(mgr.getStatusSnapshot().antigravity.state, "ok");
    assert.equal(mgr.getStatusSnapshot().antigravity.failureCount, 0);

    // Manual refreshAll runs active sources and honestly reports Gemini Chat as extension-managed (passive)
    clock += 10_000;
    const manual = await mgr.refreshAll({ reason: "manual" });
    assert.equal(codexCalls, 3);
    assert.equal(agyCalls, 3);
    assert.equal(manual.results.codex.status, "ok");
    assert.equal(manual.results.antigravity.status, "ok");
    assert.equal(manual.results.geminiChat.passive, true);
    assert.equal(manual.results.geminiChat.status, "extension-managed");

    mgr.stop();
  });
});
