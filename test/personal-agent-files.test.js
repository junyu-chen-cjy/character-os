"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createFileTools, isSensitivePath } = require("../src/personal-agent-files");

describe("Phase B2: local file search_files and open_file tools", () => {
  it("finds recent PDFs in Downloads and project folders in Projects, and blocks sensitive dirs", async () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "char-files-"));
    try {
      const downloads = path.join(tmpHome, "Downloads");
      const projects = path.join(tmpHome, "Projects");
      const sshDir = path.join(tmpHome, ".ssh");
      fs.mkdirSync(downloads, { recursive: true });
      fs.mkdirSync(path.join(projects, "AlphaZero"), { recursive: true });
      fs.mkdirSync(sshDir, { recursive: true });

      const pdfPath = path.join(downloads, "paper-2026.pdf");
      fs.writeFileSync(pdfPath, "%PDF-1.4\n", "utf8");
      fs.writeFileSync(path.join(sshDir, "id_rsa"), "secret", "utf8");

      const opened = [];
      const tools = createFileTools({
        homeDir: tmpHome,
        platform: "linux", // exercise bounded local scan deterministically
        openPathFn: async (p) => { opened.push(p); return ""; },
      });

      const pdfRes = await tools.search_files.execute({ directory: "downloads", extension: "pdf" });
      assert.equal(pdfRes.status, "ok");
      assert.equal(pdfRes.results.length, 1);
      assert.equal(pdfRes.results[0].name, "paper-2026.pdf");
      assert.equal(pdfRes.results[0].extension, "pdf");

      const projRes = await tools.search_files.execute({ query: "AlphaZero", type: "directory" });
      assert.equal(projRes.status, "ok");
      assert.ok(projRes.results.some((r) => r.name === "AlphaZero" && r.type === "directory"));

      const openOk = await tools.open_file.execute({ path: pdfRes.results[0].path });
      assert.equal(openOk.status, "ok");
      assert.equal(opened.length, 1);

      const blockedOpen = await tools.open_file.execute({ path: path.join(sshDir, "id_rsa") });
      assert.equal(blockedOpen.status, "error");
      assert.equal(isSensitivePath(path.join(tmpHome, "Library", "Keychains"), tmpHome), true);
      assert.equal(isSensitivePath("/etc/passwd", tmpHome), true);
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it("uses macOS mdfind when running on darwin and deduplicates with safe filtering", async () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "char-mdfind-"));
    try {
      const docs = path.join(tmpHome, "Documents");
      fs.mkdirSync(docs, { recursive: true });
      const target = path.join(docs, "thesis-notes.pdf");
      fs.writeFileSync(target, "pdf", "utf8");

      let sawMdfind = false;
      const tools = createFileTools({
        homeDir: tmpHome,
        platform: "darwin",
        execFileFn: async (bin, args) => {
          sawMdfind = bin === "/usr/bin/mdfind" && args.includes("-onlyin");
          return { stdout: `${target}\n/etc/hosts\n` };
        },
        openPathFn: async () => "",
      });

      const res = await tools.search_files.execute({ query: "thesis", extension: "pdf" });
      assert.equal(sawMdfind, true);
      assert.equal(res.backend, "spotlight");
      assert.equal(res.results.length, 1);
      assert.equal(res.results[0].name, "thesis-notes.pdf");
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});
