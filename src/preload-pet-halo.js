"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const stateListeners = new Set();
const visibilityListeners = new Set();

ipcRenderer.on("pet-halo:state", (_event, payload) => {
  for (const cb of stateListeners) {
    try { cb(payload); } catch {}
  }
});

ipcRenderer.on("pet-halo:visibility", (_event, payload) => {
  for (const cb of visibilityListeners) {
    try { cb(payload); } catch {}
  }
});

contextBridge.exposeInMainWorld("petHaloAPI", {
  getState: () => ipcRenderer.invoke("pet-halo:get-state"),
  setHovering: (hovering) => ipcRenderer.send("pet-halo:hover", !!hovering),
  reportLayout: (metrics) => ipcRenderer.send("pet-halo:layout", metrics),
  openCommand: () => ipcRenderer.invoke("pet-halo:action", { type: "open-command" }),
  openWorkspace: (view) => ipcRenderer.invoke("pet-halo:action", { type: "open-workspace", view }),
  launchClient: (clientId) => ipcRenderer.invoke("pet-halo:action", { type: "launch-client", clientId }),
  onState: (cb) => {
    if (typeof cb !== "function") return () => {};
    stateListeners.add(cb);
    return () => stateListeners.delete(cb);
  },
  onVisibility: (cb) => {
    if (typeof cb !== "function") return () => {};
    visibilityListeners.add(cb);
    return () => visibilityListeners.delete(cb);
  },
});
