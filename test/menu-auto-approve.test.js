"use strict";

const assert = require("node:assert");
const Module = require("node:module");
const { it } = require("node:test");

const MENU_MODULE_PATH = require.resolve("../src/menu");

function loadMenuWithElectron(fakeElectron) {
  delete require.cache[MENU_MODULE_PATH];
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request) {
    if (request === "electron") return fakeElectron;
    return originalLoad.apply(this, arguments);
  };
  try {
    return require("../src/menu");
  } finally {
    Module._load = originalLoad;
  }
}

function makeFakeElectron() {
  return {
    app: { quit() {}, setActivationPolicy() {}, dock: { show() {}, hide() {} } },
    BrowserWindow: function BrowserWindow() {},
    Menu: { buildFromTemplate(template) { return { template }; } },
    Tray: function Tray() {},
    nativeImage: { createFromPath() { return { resize() { return this; }, setTemplateImage() {} }; } },
    screen: {
      getAllDisplays: () => [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }],
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ id: 1 }),
    },
  };
}

it("keeps permission handling, mini mode, meeting mode and updates out of the tray menu", () => {
  let template;
  const ctx = {
    lang: "en",
    tray: { setContextMenu: menu => { template = menu.template; } },
    getMiniMode: () => false,
    getMiniTransitioning: () => false,
    getUpdateMenuItem: () => ({ label: "Check for Updates" }),
    getMeetingMode: () => ({ active: true, endsAt: Date.now() + 60000 }),
    setPermissionAutomationMode() {},
  };
  loadMenuWithElectron(makeFakeElectron())(ctx).buildTrayMenu();

  const labels = template.map(item => item.label || "");
  assert.ok(labels.includes("Settings…"));
  assert.ok(labels.every(label => !/Permission handling|Mini Mode|Meeting Mode|Check for Updates/.test(label)));
});
