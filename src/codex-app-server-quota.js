"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DEFAULT_TIMEOUT_MS = 15_000;
const CODEX_APP_SERVER_SOURCE_LABEL = "Codex app-server";

function findCodexBinary({
  existsSync = fs.existsSync,
  env = process.env,
  platform = process.platform,
  homeDir = os.homedir(),
} = {}) {
  const candidates = [];
  if (typeof env.CODEX_BIN === "string" && env.CODEX_BIN.trim()) {
    candidates.push(env.CODEX_BIN.trim());
  }
  if (platform === "darwin") {
    candidates.push(
      "/Applications/Codex.app/Contents/Resources/codex-cli/bin/codex",
      "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
      path.join(homeDir, "Applications/Codex.app/Contents/Resources/codex-cli/bin/codex"),
      path.join(homeDir, "Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"),
      "/opt/homebrew/bin/codex",
      "/usr/local/bin/codex",
    );
  }
  candidates.push(path.join(homeDir, ".local", "bin", "codex"));

  const pathVar = env.PATH || "";
  const sep = platform === "win32" ? ";" : ":";
  const binNames = platform === "win32" ? ["codex.exe", "codex.cmd", "codex"] : ["codex"];
  for (const dir of pathVar.split(sep)) {
    if (!dir) continue;
    for (const name of binNames) {
      candidates.push(path.join(dir, name));
    }
  }

  for (const candidate of candidates) {
    try {
      if (candidate && existsSync(candidate)) return candidate;
    } catch {}
  }
  return null;
}

function normalizeResetAtMs(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  // Codex app-server returns Unix seconds (e.g. 1795821000); handle ms defensively too.
  return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
}

function normalizeWindowBucket(raw, fallbackWindowMinutes, capturedAt) {
  if (!raw || typeof raw !== "object") return null;
  const used = Number(raw.usedPercent);
  if (!Number.isFinite(used) || used < 0 || used > 100) return null;
  const windowMinutes = Number(raw.windowDurationMins) > 0
    ? Math.round(Number(raw.windowDurationMins))
    : fallbackWindowMinutes;
  const resetAt = normalizeResetAtMs(raw.resetsAt);
  const bucket = {
    usedPercent: used,
    capturedAt,
    windowMinutes,
  };
  if (Number.isFinite(resetAt) && resetAt > capturedAt) {
    bucket.resetAt = resetAt;
  }
  return bucket;
}

// Parse official `account/rateLimits/read` JSON-RPC result into the store's codexQuota group shape.
function parseCodexAppServerRateLimits(result, capturedAt = Date.now()) {
  if (!result || typeof result !== "object") return null;
  const limits = result.rateLimits || result.rateLimitsByLimitId?.codex;
  if (!limits || typeof limits !== "object") return null;

  const group = {};
  const primary = normalizeWindowBucket(limits.primary, 300, capturedAt);
  const secondary = normalizeWindowBucket(limits.secondary, 10080, capturedAt);

  if (primary) {
    if (primary.windowMinutes >= 1440 && !secondary) {
      group.codexWeekly = primary;
    } else {
      group.codexFiveHour = primary;
    }
  }
  if (secondary) {
    group.codexWeekly = secondary;
  }
  return Object.keys(group).length ? group : null;
}

// Queries the official local `codex app-server` over JSON-RPC stdio using
// `account/rateLimits/read`. Does NOT start any coding task or spend inference tokens,
// and does NOT read or extract any credential files directly.
function queryCodexAppServerRateLimits({
  binaryPath,
  spawnFn = spawn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  capturedAtFn = Date.now,
} = {}) {
  const bin = binaryPath || findCodexBinary();
  if (!bin) {
    return Promise.resolve({ status: "cli-unavailable", error: "Codex CLI / App Server binary was not found." });
  }

  return new Promise((resolve) => {
    let settled = false;
    let stdoutBuf = "";
    let stderrBuf = "";
    let sentRead = false;
    let child;

    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child?.stdin?.end(); } catch {}
      try { if (child && !child.killed) child.kill("SIGTERM"); } catch {}
      resolve(outcome);
    };

    const timer = setTimeout(() => {
      finish({ status: "timeout", error: "Codex app-server rateLimits/read timed out." });
    }, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();

    try {
      child = spawnFn(bin, ["app-server"], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: { ...process.env, CI: "true", NO_COLOR: "1" },
      });
    } catch (err) {
      finish({ status: "cli-unavailable", error: err?.message || "Failed to spawn Codex app-server." });
      return;
    }

    const sendReadRequest = () => {
      if (sentRead || settled) return;
      sentRead = true;
      try {
        child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
        child.stdin.write(JSON.stringify({ method: "account/rateLimits/read", id: 2, params: {} }) + "\n");
      } catch (err) {
        finish({ status: "error", error: err?.message || "Failed to write JSON-RPC request." });
      }
    };

    const handleLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) return;
      let msg;
      try { msg = JSON.parse(trimmed); } catch { return; }

      if (msg.id === 1) {
        if (msg.error) {
          finish({ status: "error", error: msg.error.message || "Codex initialize failed." });
          return;
        }
        sendReadRequest();
        return;
      }

      if (msg.id === 2) {
        if (msg.error) {
          const errMsg = String(msg.error.message || "");
          const isAuth = /auth|login|unauth|token|sign.?in|credential|401|403/i.test(errMsg);
          const isNet = /network|fetch|dns|econn|enotfound|timed out|offline/i.test(errMsg);
          finish({
            status: isAuth ? "auth-required" : isNet ? "network-error" : "error",
            error: errMsg || "account/rateLimits/read failed.",
          });
          return;
        }
        const capturedAt = capturedAtFn();
        const group = parseCodexAppServerRateLimits(msg.result, capturedAt);
        if (!group) {
          finish({ status: "unrecognized", error: "Codex app-server returned no recognized rate limit windows." });
          return;
        }
        finish({ status: "ok", group, capturedAt, planType: msg.result?.rateLimits?.planType || null });
      }
    };

    child.stdout?.on("data", (chunk) => {
      stdoutBuf += chunk.toString("utf8");
      if (stdoutBuf.length > 512 * 1024) {
        finish({ status: "error", error: "Codex app-server output exceeded safety limit." });
        return;
      }
      const lines = stdoutBuf.split(/\r?\n/);
      stdoutBuf = lines.pop() || "";
      for (const line of lines) handleLine(line);
    });

    child.stderr?.on("data", (chunk) => {
      if (stderrBuf.length < 4096) stderrBuf += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      finish({ status: "cli-unavailable", error: err?.message || "Codex app-server error." });
    });

    child.on("exit", (code) => {
      if (stdoutBuf.trim()) handleLine(stdoutBuf);
      if (settled) return;
      const isAuth = /auth|login|unauth|sign.?in/i.test(stderrBuf);
      finish({
        status: isAuth ? "auth-required" : "error",
        error: stderrBuf.trim().slice(0, 200) || `Codex app-server exited with code ${code}.`,
      });
    });

    try {
      child.stdin.write(JSON.stringify({
        method: "initialize",
        id: 1,
        params: { clientInfo: { name: "character-os", version: "1.0.0" } },
      }) + "\n");
    } catch (err) {
      finish({ status: "error", error: err?.message || "Failed to initialize Codex app-server." });
    }
  });
}

function createCodexQuotaRefresh({ publish, queryFn = queryCodexAppServerRateLimits } = {}) {
  let pending = null;
  return function refresh() {
    if (pending) return pending;
    pending = (async () => {
      const res = await queryFn();
      if (res && res.status === "ok" && res.group) {
        if (typeof publish === "function") publish(res.group, res);
        return { status: "ok", capturedAt: res.capturedAt };
      }
      return {
        status: res?.status || "error",
        error: res?.error || "",
      };
    })().finally(() => { pending = null; });
    return pending;
  };
}

module.exports = {
  CODEX_APP_SERVER_SOURCE_LABEL,
  findCodexBinary,
  parseCodexAppServerRateLimits,
  queryCodexAppServerRateLimits,
  createCodexQuotaRefresh,
};
