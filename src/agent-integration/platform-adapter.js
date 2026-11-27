"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { Worker } = require("node:worker_threads");

const execFileAsync = promisify(execFile);

const MAC_ACCESSIBILITY_SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
const WORKER_PATH = path.join(__dirname, "platform-adapter-macos-worker.js");

function resolveMacAppBundleFromExecPath(execPath = process.execPath) {
  const normalized = String(execPath || "");
  const match = /^(.+?\.app)(?:\/|$)/.exec(normalized);
  if (match) {
    const bundlePath = match[1];
    return {
      appBundlePath: bundlePath,
      appDisplayName: path.basename(bundlePath, ".app"),
      isDevElectron: path.basename(bundlePath) === "Electron.app",
    };
  }
  return {
    appBundlePath: normalized,
    appDisplayName: path.basename(normalized || "Character OS"),
    isDevElectron: false,
  };
}

function runMacWorker(workerData, timeoutMs = 12_000) {
  return new Promise((resolve) => {
    let worker;
    try {
      worker = new Worker(WORKER_PATH, { workerData });
    } catch (err) {
      resolve({ status: "error", error: err?.message || "Failed to start macOS platform worker." });
      return;
    }
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { void worker.terminate(); } catch {}
      resolve(value);
    };
    const timer = setTimeout(() => {
      finish({ status: "error", deliveryStatus: "timeout", error: "Desktop UI operation timed out." });
    }, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();
    worker.once("message", finish);
    worker.once("error", (err) => finish({ status: "error", error: err?.message || "Worker error." }));
    worker.once("exit", (code) => finish({ status: "error", error: `Worker exited (${code}).` }));
  });
}

// Encapsulates OS-specific app detection, Accessibility permissions, window focus,
// and desktop UI delegation. Future Windows/Linux backends can implement this same contract.
function createPlatformAdapter({
  platform = process.platform,
  systemPreferences = null,
  shell = null,
  execPath = process.execPath,
  existsSync = fs.existsSync,
  execFileFn = execFileAsync,
  runWorkerFn = runMacWorker,
} = {}) {
  const isMac = platform === "darwin";

  function getAccessibilityStatus({ prompt = false } = {}) {
    if (!isMac) {
      return {
        platform,
        supported: false,
        trusted: false,
        processPath: execPath,
        appBundlePath: execPath,
        appDisplayName: path.basename(execPath || "Character OS"),
        isDevElectron: false,
        settingsUrl: "",
      };
    }
    let trusted = false;
    try {
      if (systemPreferences && typeof systemPreferences.isTrustedAccessibilityClient === "function") {
        trusted = Boolean(systemPreferences.isTrustedAccessibilityClient(Boolean(prompt)));
      }
    } catch {
      trusted = false;
    }
    const bundle = resolveMacAppBundleFromExecPath(execPath);
    return {
      platform,
      supported: true,
      trusted,
      processPath: execPath,
      ...bundle,
      settingsUrl: MAC_ACCESSIBILITY_SETTINGS_URL,
    };
  }

  async function openAccessibilitySettings() {
    if (!isMac) return { status: "unsupported" };
    // Trigger macOS's standard Accessibility trust prompt if supported, then open Privacy pane.
    const status = getAccessibilityStatus({ prompt: true });
    if (shell && typeof shell.openExternal === "function") {
      try {
        await shell.openExternal(MAC_ACCESSIBILITY_SETTINGS_URL);
        return { status: "ok", accessibility: status };
      } catch (err) {
        return { status: "error", error: err?.message || "Failed to open System Settings.", accessibility: status };
      }
    }
    return { status: "unavailable", accessibility: status };
  }

  function revealAuthorizedAppInFinder() {
    const status = getAccessibilityStatus();
    if (!status.appBundlePath || !shell || typeof shell.showItemInFolder !== "function") {
      return { status: "unavailable", accessibility: status };
    }
    try {
      shell.showItemInFolder(status.appBundlePath);
      return { status: "ok", path: status.appBundlePath, accessibility: status };
    } catch (err) {
      return { status: "error", error: err?.message || "Failed to reveal application.", accessibility: status };
    }
  }

  function findInstalledAppPath(candidates = []) {
    for (const candidate of candidates) {
      try {
        if (candidate && existsSync(candidate)) return candidate;
      } catch {}
    }
    return null;
  }

  async function launchApp({ bundleId, appPath }) {
    if (!isMac) return { status: "unsupported" };
    const args = bundleId ? ["-b", bundleId] : (appPath ? [appPath] : []);
    if (!args.length) return { status: "error", error: "No application target specified." };
    try {
      await execFileFn("/usr/bin/open", args, { timeout: 6000 });
      return { status: "ok" };
    } catch (err) {
      // If bundleId failed (e.g. Spotlight database stale), retry by explicit appPath.
      if (bundleId && appPath && existsSync(appPath)) {
        try {
          await execFileFn("/usr/bin/open", [appPath], { timeout: 6000 });
          return { status: "ok" };
        } catch {}
      }
      return { status: "error", error: err?.message || "Failed to open application." };
    }
  }

  async function openUrl(url) {
    if (!url || typeof url !== "string") return { status: "error", error: "Invalid URL." };
    if (shell && typeof shell.openExternal === "function") {
      try {
        await shell.openExternal(url);
        return { status: "ok" };
      } catch (err) {
        return { status: "error", error: err?.message || "Failed to open URL." };
      }
    }
    return { status: "unavailable" };
  }

  async function inspectDesktopApp({ bundleId, clientType }) {
    if (!isMac) return { status: "unsupported", trusted: false, running: false };
    return runWorkerFn({ command: "inspect", bundleId, clientType }, 6500);
  }

  async function focusDesktopSession({ bundleId, clientType, targetTitle, isBlankDraft }) {
    if (!isMac) return { status: "unsupported" };
    return runWorkerFn({ command: "focus", bundleId, clientType, targetTitle, isBlankDraft }, 8000);
  }

  async function deliverDesktopMessage({ bundleId, clientType, targetTitle, isBlankDraft, message }) {
    if (!isMac) {
      return { status: "error", deliveryStatus: "unsupported_platform", error: "Desktop delegation requires macOS." };
    }
    return runWorkerFn({ command: "deliver", bundleId, clientType, targetTitle, isBlankDraft, message }, 14_000);
  }

  return {
    platform,
    isMac,
    getAccessibilityStatus,
    openAccessibilitySettings,
    revealAuthorizedAppInFinder,
    findInstalledAppPath,
    launchApp,
    openUrl,
    inspectDesktopApp,
    focusDesktopSession,
    deliverDesktopMessage,
  };
}

module.exports = {
  MAC_ACCESSIBILITY_SETTINGS_URL,
  resolveMacAppBundleFromExecPath,
  createPlatformAdapter,
};
