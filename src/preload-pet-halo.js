"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const stateListeners = new Set();
const visibilityListeners = new Set();

ipcRenderer.on("pet-halo:state", (_event, payload) => {
  for (const cb of stateListeners) {
    try { cb(payload); } catch (err) { console.warn("pet-halo state listener threw:", err); }
  }
});

ipcRenderer.on("pet-halo:visibility", (_event, payload) => {
  for (const cb of visibilityListeners) {
    try { cb(payload); } catch (err) { console.warn("pet-halo visibility listener threw:", err); }
  }
});

contextBridge.exposeInMainWorld("petHaloAPI", {
  getState: () => ipcRenderer.invoke("pet-halo:get-state"),
  openWorkspace: () => ipcRenderer.send("pet-halo:action", { type: "open-workspace" }),
  openCommand: () => ipcRenderer.send("pet-halo:action", { type: "open-command" }),
  openSettings: () => ipcRenderer.send("pet-halo:action", { type: "open-settings" }),
  toggleDnd: () => ipcRenderer.invoke("pet-halo:command", { type: "toggle-dnd" }),
  toggleQuotaPinned: () => ipcRenderer.invoke("pet-halo:command", { type: "toggle-quota-pinned" }),
  launchClient: (clientId) => ipcRenderer.invoke("pet-halo:command", {
    type: "launch-client",
    clientId: typeof clientId === "string" ? clientId : "",
  }),
  reportLayout: (metrics) => ipcRenderer.send("pet-halo:layout", metrics),
  setHovered: (hovered) => ipcRenderer.send("pet-halo:hover-surface", {
    surface: "halo",
    hovered: !!hovered,
  }),
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
