"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(name) {
  return fs.readFileSync(path.join(__dirname, "..", "src", name), "utf8");
}

test("workbench quota bars use Graphite severity tokens", () => {
  const css = read("dashboard.css");
  const renderer = read("dashboard-renderer.js");
  assert.match(css, /\.quota-bar-fill\.sev-warn\s*\{[^}]*var\(--warn\)/);
  assert.match(css, /\.quota-bar-fill\.sev-hot\s*\{[^}]*var\(--bad\)/);
  assert.match(renderer, /QUOTA_WARN_AT = 60/);
  assert.match(renderer, /QUOTA_HOT_AT = 85/);
});
