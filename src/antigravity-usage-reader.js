"use strict";

const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { anchorRelativeResetAt } = require("../hooks/quota-bucket");

const GEMINI_ANTIGRAVITY_QUOTA_SOURCE = "gemini-app-antigravity";
const GROUPS = /\b(Gemini Models|Claude and GPT Models|Third[- ]Party Models|Partner Models)\b/gi;
const WINDOW = /\s*(Weekly|5\s*h(?:our)?)\s+limit\s+(\d{1,3}(?:\.\d+)?)\s*%\s+left\b(?:\s+Resets in\s+((?:\d+\s*[dhms]\b(?!\s+limit\b)\s*)+))?/giy;

function parseUsagePanel(text, capturedAt = Date.now()) {
  if (typeof text !== "string" || !text || !Number.isFinite(capturedAt)) return null;
  const groups = [...text.matchAll(GROUPS)];
  const result = {};
  for (const [index, match] of groups.entries()) {
    const prefix = /^gemini/i.test(match[0]) ? "gemini" : "thirdParty";
    const contents = text.slice(match.index + match[0].length, groups[index + 1]?.index);
    // A group's usage rows are consecutive. Stop before an unknown heading.
    for (const [, label, percent, duration] of contents.matchAll(WINDOW)) {
      const remaining = Number(percent);
      if (remaining < 0 || remaining > 100) continue;
      const weekly = /^weekly/i.test(label);
      const field = prefix + (weekly ? "Weekly" : "FiveHour");
      const windowMinutes = weekly ? 7 * 24 * 60 : 5 * 60;
      const bucket = { usedPercent: 100 - remaining, capturedAt, windowMinutes };
      if (duration) {
        const multipliers = { d: 86400, h: 3600, m: 60, s: 1 };
        const seconds = [...duration.matchAll(/(\d+)\s*([dhms])/gi)]
          .reduce((sum, [, amount, unit]) => sum + Number(amount) * multipliers[unit.toLowerCase()], 0);
        if (seconds > 0 && seconds <= windowMinutes * 60) {
          bucket.resetAt = anchorRelativeResetAt(seconds, capturedAt);
        }
      }
      // Conflicting rows cannot be assigned to the same provider bucket.
      if (result[field] && (result[field].usedPercent !== bucket.usedPercent
          || result[field].resetAt !== bucket.resetAt)) return null;
      result[field] = bucket;
    }
  }
  return Object.keys(result).length ? result : null;
}

function readUsagePanel() {
  return new Promise(resolve => {
    let worker;
    try {
      worker = new Worker(path.join(__dirname, "antigravity-usage-worker.js"));
    } catch {
      resolve({ status: "unavailable" });
      return;
    }
    let settled = false;
    const timer = setTimeout(() => finish({ status: "unavailable" }), 4500);
    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(result);
    }
    worker.once("message", finish);
    worker.once("error", () => finish({ status: "unavailable" }));
    worker.once("exit", () => finish({ status: "unavailable" }));
  });
}

function createAntigravityUsageRefresh({ isTrusted, publish, read = readUsagePanel, now = Date.now }) {
  let pending;
  let lastAttempt = -Infinity;

  async function run() {
    try {
      const result = await read();
      if (result.status !== "ok") return { status: result.status };
      const capturedAt = now();
      const group = parseUsagePanel(result.text, capturedAt);
      if (!group) return { status: "unrecognized" };
      publish(group);
      return { status: "ok", capturedAt };
    } catch {
      return { status: "unavailable" };
    }
  }

  return function refresh() {
    if (pending) return pending;
    if (!isTrusted()) return Promise.resolve({ status: "permission-required" });
    const timestamp = now();
    if (timestamp - lastAttempt < 5000) return Promise.resolve({ status: "try-later" });
    lastAttempt = timestamp;
    pending = run().finally(() => { pending = null; });
    return pending;
  };
}

module.exports = { GEMINI_ANTIGRAVITY_QUOTA_SOURCE, createAntigravityUsageRefresh, parseUsagePanel };
