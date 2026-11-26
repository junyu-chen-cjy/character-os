"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("chat", {
  get: () => ipcRenderer.invoke("chat:get"),
  select: id => ipcRenderer.invoke("chat:select", id),
  create: () => ipcRenderer.invoke("chat:create"),
  send: text => ipcRenderer.invoke("chat:send", text),
  stop: () => ipcRenderer.invoke("chat:stop"),
  saveModel: model => ipcRenderer.invoke("chat:save-model", model),
  openLink: url => ipcRenderer.invoke("chat:open-link", url),
  onChanged: listener => ipcRenderer.on("chat:changed", (_event, state) => listener(state)),
  onOpenModelSettings: listener => ipcRenderer.on("chat:open-model-settings", () => listener()),
});
