"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
const MDFIND_TIMEOUT_MS = 8000;
const MAX_SCAN_DEPTH = 3;
const MAX_SCAN_ENTRIES = 1200;

const BLOCKED_SEGMENTS = new Set([
  ".ssh",
  ".gnupg",
  ".aws",
  ".kube",
  ".docker",
  ".npm",
  ".clawd",
  ".Trash",
  "Keychains",
  "Cookies",
  "Passwords",
  "Private",
]);

const SKIP_WALK_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  ".venv",
  "venv",
  "__pycache__",
  ".next",
  ".nuxt",
  "dist",
  "build",
  "target",
  ".cache",
  "Library",
]);

const DEFAULT_HOME_SUBDIRS = [
  "Downloads",
  "Documents",
  "Desktop",
  "Projects",
  "projects",
  "Code",
  "Developer",
  "Workspace",
];

const DIRECTORY_ALIASES = {
  downloads: "Downloads",
  download: "Downloads",
  下载: "Downloads",
  documents: "Documents",
  document: "Documents",
  docs: "Documents",
  文档: "Documents",
  desktop: "Desktop",
  桌面: "Desktop",
  projects: "Projects",
  project: "Projects",
  项目: "Projects",
};

function expandHome(inputPath, homeDir) {
  if (typeof inputPath !== "string" || !inputPath.trim()) return "";
  const trimmed = inputPath.trim();
  if (trimmed === "~") return homeDir;
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.join(homeDir, trimmed.slice(2));
  }
  return trimmed;
}

function isPathWithin(targetPath, rootDir) {
  const rel = path.relative(rootDir, targetPath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function isSensitivePath(targetPath, homeDir) {
  const resolved = path.resolve(targetPath);
  if (!isPathWithin(resolved, homeDir)) return true;
  const rel = path.relative(homeDir, resolved);
  if (!rel) return false;
  const parts = rel.split(path.sep);
  if (parts[0] === "Library") return true;
  for (const part of parts) {
    if (BLOCKED_SEGMENTS.has(part)) return true;
    if (/^\.env(\.|$)/i.test(part)) return true;
  }
  return false;
}

function normalizeHomeDir(homeDir) {
  const resolved = path.resolve(homeDir);
  try { return fs.realpathSync(resolved); } catch { return resolved; }
}

function resolveSearchRoots(directory, homeDir) {
  const resolvedHome = normalizeHomeDir(homeDir);
  if (typeof directory === "string" && directory.trim()) {
    const raw = directory.trim();
    const alias = DIRECTORY_ALIASES[raw.toLowerCase()] || DIRECTORY_ALIASES[raw];
    const candidates = [];
    if (alias) {
      candidates.push(path.join(resolvedHome, alias));
      if (alias === "Projects") candidates.push(path.join(resolvedHome, "projects"));
    } else {
      const expanded = expandHome(raw, resolvedHome);
      candidates.push(path.isAbsolute(expanded) ? expanded : path.join(resolvedHome, expanded));
    }
    const existing = [];
    const seen = new Set();
    for (const candidate of candidates) {
      const full = path.resolve(candidate);
      if (isSensitivePath(full, resolvedHome)) continue;
      if (!fs.existsSync(full)) continue;
      let real = full;
      try { real = fs.realpathSync(full); } catch {}
      if (seen.has(real) || isSensitivePath(real, resolvedHome)) continue;
      seen.add(real);
      existing.push(real);
    }
    return existing;
  }

  const roots = [];
  const seen = new Set();
  for (const sub of DEFAULT_HOME_SUBDIRS) {
    const full = path.join(resolvedHome, sub);
    if (!fs.existsSync(full)) continue;
    let real = full;
    try { real = fs.realpathSync(full); } catch {}
    if (seen.has(real) || isSensitivePath(real, resolvedHome)) continue;
    seen.add(real);
    roots.push(real);
  }
  return roots.length ? roots : [resolvedHome];
}

function escapeMdfindString(str) {
  return String(str || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function normalizeExtension(ext) {
  if (typeof ext !== "string" || !ext.trim()) return "";
  return ext.trim().toLowerCase().replace(/^\.+/, "").replace(/[^a-z0-9]/g, "");
}

function buildMdfindQuery({ query, extension, type }) {
  const clauses = [];
  const trimmed = typeof query === "string" ? query.trim() : "";
  if (trimmed) {
    const escaped = escapeMdfindString(trimmed);
    clauses.push(`kMDItemFSName == '*${escaped}*'cdw`);
  }
  const ext = normalizeExtension(extension);
  if (ext) {
    clauses.push(`kMDItemFSName == '*.${ext}'cd`);
  }
  if (type === "directory") {
    clauses.push(`kMDItemContentType == 'public.folder'`);
  }
  if (!clauses.length) {
    clauses.push(`kMDItemFSName == '*'`);
  }
  return clauses.join(" && ");
}

function matchesFilter(fullPath, stat, { query, extension, type, cutoffMs }) {
  const name = path.basename(fullPath);
  const isDir = stat.isDirectory();
  if (type === "file" && isDir) return false;
  if (type === "directory" && !isDir) return false;
  if (cutoffMs && stat.mtimeMs < cutoffMs) return false;

  const ext = normalizeExtension(extension);
  if (ext) {
    if (isDir) return false;
    const actualExt = path.extname(name).toLowerCase().replace(/^\./, "");
    if (actualExt !== ext) return false;
  }

  const trimmed = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (trimmed) {
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    const haystack = name.toLowerCase();
    for (const token of tokens) {
      if (!haystack.includes(token)) return false;
    }
  }
  return true;
}

function quickWalkRoots(roots, filter, homeDir, maxHits) {
  const results = [];
  let visited = 0;

  function walk(dir, depth) {
    if (depth > MAX_SCAN_DEPTH || visited >= MAX_SCAN_ENTRIES || results.length >= maxHits) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (visited >= MAX_SCAN_ENTRIES || results.length >= maxHits) return;
      visited += 1;
      const name = entry.name;
      if (name.startsWith(".") && !filter.query?.startsWith(".")) continue;
      if (entry.isDirectory() && SKIP_WALK_DIRS.has(name)) continue;
      const fullPath = path.join(dir, name);
      if (isSensitivePath(fullPath, homeDir)) continue;
      let stat;
      try { stat = fs.statSync(fullPath); } catch { continue; }
      if (matchesFilter(fullPath, stat, filter)) {
        results.push({ fullPath, stat });
      }
      if (stat.isDirectory() && depth < MAX_SCAN_DEPTH) {
        walk(fullPath, depth + 1);
      }
    }
  }

  for (const root of roots) walk(root, 0);
  return results;
}

function createFileTools({
  homeDir = os.homedir(),
  platform = process.platform,
  execFileFn = execFileAsync,
  openPathFn,
  showItemInFolderFn,
} = {}) {
  const resolvedHome = normalizeHomeDir(homeDir);
  const recentFound = [];

  function rememberPaths(items) {
    for (const item of items) {
      if (!item?.path) continue;
      const idx = recentFound.indexOf(item.path);
      if (idx >= 0) recentFound.splice(idx, 1);
      recentFound.unshift(item.path);
    }
    if (recentFound.length > 40) recentFound.length = 40;
  }

  async function searchFiles(args = {}, { signal } = {}) {
    const query = typeof args.query === "string" ? args.query.trim().slice(0, 120) : "";
    const extension = normalizeExtension(args.extension);
    const type = ["file", "directory", "any"].includes(args.type) ? args.type : "any";
    const directory = typeof args.directory === "string" ? args.directory.trim() : "";
    const recentDays = Number.isFinite(Number(args.recent_days)) && Number(args.recent_days) > 0
      ? Math.min(365, Number(args.recent_days))
      : 0;
    const limit = Math.max(1, Math.min(MAX_LIMIT, Math.round(Number(args.limit) || DEFAULT_LIMIT)));

    const roots = resolveSearchRoots(directory, resolvedHome);
    if (!roots.length) {
      return {
        status: "error",
        error: "No accessible search directory was found inside your home folder.",
      };
    }

    const cutoffMs = recentDays > 0 ? Date.now() - recentDays * 86400 * 1000 : 0;
    const filter = { query, extension, type, cutoffMs };
    const foundByPath = new Map();
    let backend = "fs";

    // Primary on macOS: Spotlight (mdfind) scoped to safe user directories.
    if (platform === "darwin" && (query || extension || type === "directory")) {
      const mdQuery = buildMdfindQuery({ query, extension, type });
      const mdArgs = [];
      for (const root of roots) mdArgs.push("-onlyin", root);
      mdArgs.push(mdQuery);
      try {
        const { stdout } = await execFileFn("/usr/bin/mdfind", mdArgs, {
          timeout: MDFIND_TIMEOUT_MS,
          maxBuffer: 2 * 1024 * 1024,
          signal,
        });
        backend = "spotlight";
        const lines = String(stdout || "").split(/\r?\n/).filter(Boolean).slice(0, 300);
        for (const line of lines) {
          if (isSensitivePath(line, resolvedHome)) continue;
          let stat;
          try { stat = fs.statSync(line); } catch { continue; }
          if (!matchesFilter(line, stat, filter)) continue;
          foundByPath.set(line, stat);
        }
      } catch {
        // Spotlight unavailable or timed out — fall through to bounded fs scan.
      }
    }

    // Bounded filesystem walk ensures unindexed folders (e.g. fresh downloads or ~/Projects)
    // and non-macOS platforms still return accurate results quickly.
    if (foundByPath.size < limit) {
      const scanned = quickWalkRoots(roots, filter, resolvedHome, limit * 4);
      for (const { fullPath, stat } of scanned) {
        if (!foundByPath.has(fullPath)) foundByPath.set(fullPath, stat);
      }
    }

    const queryLower = query.toLowerCase();
    const items = Array.from(foundByPath.entries())
      .map(([fullPath, stat]) => {
        const name = path.basename(fullPath);
        const isDir = stat.isDirectory();
        const ext = isDir ? "" : path.extname(name).toLowerCase().replace(/^\./, "");
        return {
          path: fullPath,
          name,
          type: isDir ? "directory" : "file",
          extension: ext || null,
          sizeBytes: isDir ? null : stat.size,
          modifiedAt: new Date(stat.mtimeMs).toISOString(),
          _mtimeMs: stat.mtimeMs,
          _exact: queryLower ? (name.toLowerCase() === queryLower ? 2 : name.toLowerCase().startsWith(queryLower) ? 1 : 0) : 0,
        };
      })
      .sort((a, b) => {
        if (b._exact !== a._exact) return b._exact - a._exact;
        return b._mtimeMs - a._mtimeMs;
      })
      .slice(0, limit)
      .map(({ _mtimeMs, _exact, ...clean }) => clean);

    rememberPaths(items);

    return {
      status: "ok",
      backend,
      searchedDirectories: roots,
      totalFound: items.length,
      results: items,
    };
  }

  async function openFile(args = {}) {
    let rawPath = typeof args.path === "string" ? args.path.trim() : "";
    if (!rawPath && recentFound.length > 0) {
      rawPath = recentFound[0];
    }
    if (!rawPath) {
      return { status: "error", error: "Provide a file or folder path to open." };
    }
    const expanded = expandHome(rawPath, resolvedHome);
    const resolved = path.resolve(expanded);
    if (isSensitivePath(resolved, resolvedHome)) {
      return { status: "error", error: "Access to system or sensitive directories is blocked." };
    }
    if (!fs.existsSync(resolved)) {
      return { status: "error", error: `Path does not exist: ${resolved}` };
    }
    let realPath = resolved;
    try { realPath = fs.realpathSync(resolved); } catch {}
    if (isSensitivePath(realPath, resolvedHome)) {
      return { status: "error", error: "Target resolves outside allowed user folders." };
    }

    const reveal = args.reveal === true;
    if (reveal && typeof showItemInFolderFn === "function") {
      showItemInFolderFn(realPath);
      return { status: "ok", action: "revealed", path: realPath, name: path.basename(realPath) };
    }
    if (typeof openPathFn === "function") {
      const errMsg = await openPathFn(realPath);
      if (typeof errMsg === "string" && errMsg.trim()) {
        return { status: "error", error: errMsg.trim() };
      }
      return { status: "ok", action: "opened", path: realPath, name: path.basename(realPath) };
    }
    return { status: "error", error: "File opener is unavailable in this environment." };
  }

  return {
    search_files: {
      name: "search_files",
      description: "Search local files and project folders inside the user's home directories (Downloads, Documents, Desktop, Projects) using macOS Spotlight / bounded local search. Returns paths, types, and modified times without reading file contents.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "File or folder name keyword, e.g. 'AlphaZero' or 'report'." },
          extension: { type: "string", description: "Optional file extension filter without dot, e.g. 'pdf', 'md', 'docx'." },
          directory: { type: "string", description: "Optional folder name or path, e.g. 'downloads', 'documents', 'desktop', 'projects', or '~/Projects'." },
          type: { type: "string", enum: ["any", "file", "directory"], description: "Filter by file, directory, or any." },
          recent_days: { type: "number", description: "Only return items modified within the last N days." },
          limit: { type: "number", description: "Maximum number of results (1-20, default 10)." },
        },
      },
      timeoutMs: 12_000,
      execute: searchFiles,
    },
    open_file: {
      name: "open_file",
      description: "Open a local file or folder with the default OS application, or reveal it in Finder/Explorer.",
      parameters: {
        type: "object",
        required: ["path"],
        properties: {
          path: { type: "string", description: "Absolute path (or ~/...) of the file or folder to open." },
          reveal: { type: "boolean", description: "If true, reveal the item in Finder/Explorer instead of launching it." },
        },
      },
      timeoutMs: 8_000,
      execute: openFile,
    },
  };
}

module.exports = {
  createFileTools,
  isSensitivePath,
  resolveSearchRoots,
  buildMdfindQuery,
};
