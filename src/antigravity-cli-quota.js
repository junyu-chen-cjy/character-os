"use strict";

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const os = require("node:os");
const path = require("node:path");
const run = promisify(execFile);
const SOURCE = "antigravity-cli-usage";
function normalizeCliGroup(input) {
  const { normalizeQuotaBucket } = require("../hooks/quota-bucket");
  if (!input || typeof input !== "object" || Object.keys(input).length > 128) return null;
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (!/^group\d+_\d+$/.test(key) || typeof value?.groupLabel !== "string") continue;
    const bucket = normalizeQuotaBucket(value);
    if (bucket) out[key] = { ...bucket, groupLabel: value.groupLabel.slice(0, 100),
      bucketLabel: String(value.bucketLabel || "").slice(0, 100), disabled: value.disabled === true };
  }
  return Object.keys(out).length ? out : null;
}

// Group/bucket mapping follows Mimir's AntigravityProvider.swift (MIT).
// See THIRD_PARTY_QUOTA.md. Never read the CLI's authentication files.
function parseCliUsage(payload, capturedAt = Date.now()) {
  if (payload?.status !== "SUCCESS" || payload.command?.name !== "usage") return null;
  const groups = payload.command.data?.groups;
  if (!Array.isArray(groups) || groups.length > 32) return null;
  const result = {};
  for (const [index, group] of groups.entries()) {
    if (typeof group.name !== "string" || !Array.isArray(group.buckets)) continue;
    for (const [bucketIndex, bucket] of group.buckets.entries()) {
      const fraction = bucket.remaining_fraction;
      if (typeof fraction !== "number" || fraction < 0 || fraction > 1) continue;
      const id = typeof bucket.id === "string" ? bucket.id : "";
      const window = bucket.window;
      const windowMinutes = /weekly|7d/i.test(id) || window === "weekly" ? 10080
        : /5h/i.test(id) || window === "5h" ? 300 : undefined;
      const resetAt = Date.parse(bucket.reset_time);
      const value = {
        usedPercent: 100 - fraction * 100, capturedAt,
        groupLabel: group.name.slice(0, 100), bucketLabel: String(bucket.name || id).slice(0, 100),
        disabled: bucket.disabled === true,
      };
      if (windowMinutes) value.windowMinutes = windowMinutes;
      if (Number.isFinite(resetAt) && resetAt > capturedAt) value.resetAt = resetAt;
      const key = `group${index}_${bucketIndex}`;
      result[key] = value;
    }
  }
  return Object.keys(result).length ? result : null;
}

function createCliQuotaRefresh({ publish, execute = run }) {
  let pending;
  let nextAttempt = 0;
  let lastResult = { status: "waiting" };
  return function refresh() {
    if (pending) return pending;
    if (Date.now() < nextAttempt) return Promise.resolve(lastResult);
    pending = (async () => {
      nextAttempt = Date.now() + 5 * 60000;
      try {
        const { stdout } = await execute(path.join(os.homedir(), ".gemini/bin/agy"),
          ["-p", "/usage", "--output-format", "json", "--print-timeout", "30s"], {
            timeout: 40000, maxBuffer: 512 * 1024, windowsHide: true,
            env: { ...process.env, AGY_CLI_DISABLE_AUTO_UPDATE: "true", CI: "true", BROWSER: "false" },
          });
        const group = parseCliUsage(JSON.parse(stdout));
        if (!group) return (lastResult = { status: "unrecognized" });
        publish(group);
        return (lastResult = { status: "ok" });
      } catch {
        return (lastResult = { status: "cli-unavailable" });
      }
    })().finally(() => { pending = null; });
    return pending;
  };
}
module.exports = { SOURCE, parseCliUsage, createCliQuotaRefresh, normalizeCliGroup };
