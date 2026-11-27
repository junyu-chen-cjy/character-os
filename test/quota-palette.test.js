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
  assert.match(css, /\.quota-bar-fill\.sev-warn\s*\{[^}]*var\(--warn\)/);
  assert.match(css, /\.quota-bar-fill\.sev-hot\s*\{[^}]*var\(--bad\)/);
  const { severity } = require("../src/quota-view-model");
  assert.equal(severity(59), "ok");
  assert.equal(severity(60), "warn");
  assert.equal(severity(86), "hot");
});
