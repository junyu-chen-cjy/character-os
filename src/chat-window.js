"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { randomUUID } = require("node:crypto");
const MarkdownIt = require("markdown-it");
const { atomicWriteJson } = require("./quota-credential-store");
const { ChatError, parseEndpoint, streamReply } = require("./chat-provider");

const PAGE = path.join(__dirname, "chat.html");
const PAGE_URL = pathToFileURL(PAGE).href;
const SETTINGS_DEFAULT = { baseUrl: "", model: "", systemPrompt: "", encryptedKey: "" };
const markdown = new MarkdownIt({ html: false, linkify: true }).disable("image");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw new ChatError("Chat data could not be read from disk.");
  }
}

function createChatWindow({ app, BrowserWindow, ipcMain, nativeTheme, safeStorage, shell }) {
  let win;
  let history;
  let settings;
  let active;
  let notice = "";
  let revision = 0;
  let modelSettingsRequested = false;
  const rendered = new WeakMap();

  function dataPath(name) {
    return path.join(app.getPath("userData"), "chat", name);
  }

  function loadData() {
    const nextHistory = readJson(dataPath("history.json"), { version: 1, selectedId: null, sessions: [] });
    if (nextHistory?.version !== 1 || !Array.isArray(nextHistory.sessions)
        || nextHistory.sessions.some(session => typeof session?.id !== "string"
          || typeof session.title !== "string" || !Array.isArray(session.messages)
          || session.messages.some(message => !["user", "assistant"].includes(message?.role)
            || typeof message.text !== "string"))) {
      throw new ChatError("The chat history format is unsupported.");
    }
    const nextSettings = readJson(dataPath("model.json"), SETTINGS_DEFAULT);
    if (!nextSettings || Object.keys(SETTINGS_DEFAULT).some(key => typeof nextSettings[key] !== "string")) {
      throw new ChatError("The model settings file is invalid.");
    }
    history = nextHistory;
    settings = nextSettings;
    if (!history.sessions.some(session => session.id === history.selectedId)) {
      history.selectedId = history.sessions[0]?.id ?? null;
    }
  }

  function saveHistory(next) {
    try { atomicWriteJson(dataPath("history.json"), next); } catch {
      throw new ChatError("Chat history could not be saved.");
    }
    history = next;
  }

  function snapshot() {
    const session = history.sessions.find(item => item.id === history.selectedId);
    const messages = (session?.messages || []).map(message => {
      if (message.role !== "assistant") return message;
      if (!rendered.has(message)) rendered.set(message, markdown.render(message.text));
      return { role: "assistant", html: rendered.get(message), status: message.status, detail: message.detail };
    });
    if (session && active?.sessionId === session.id) {
      messages.push({ role: "assistant", html: markdown.render(active.text), status: "streaming" });
    }
    return {
      revision: ++revision,
      sessions: history.sessions.map(({ id, title }) => ({ id, title })),
      selectedId: history.selectedId,
      messages,
      generating: Boolean(active),
      notice,
      model: {
        baseUrl: settings.baseUrl,
        model: settings.model,
        systemPrompt: settings.systemPrompt,
        hasKey: Boolean(settings.encryptedKey),
      },
    };
  }

  function publish() {
    if (win && !win.isDestroyed() && history && settings) win.webContents.send("chat:changed", snapshot());
  }

  function newSession() {
    return { id: randomUUID(), title: "", messages: [] };
  }

  function select(id) {
    if (!history.sessions.some(session => session.id === id)) throw new ChatError("Chat not found.");
    saveHistory({ ...history, selectedId: id });
    notice = "";
  }

  function create() {
    const existing = history.sessions.find(session => session.id === history.selectedId);
    if (existing && !existing.messages.length) return;
    const session = newSession();
    saveHistory({ ...history, sessions: [session, ...history.sessions], selectedId: session.id });
    notice = "";
  }

  function requireSecureStorage() {
    if (!safeStorage.isEncryptionAvailable()
        || ["basic_text", "plaintext"].includes(safeStorage.getSelectedStorageBackend?.())) {
      throw new ChatError("System credential storage is unavailable. The API key was not saved or read.");
    }
  }

  function saveModel(input) {
    const baseUrl = typeof input?.baseUrl === "string" ? input.baseUrl.trim() : "";
    const model = typeof input?.model === "string" ? input.model.trim() : "";
    const systemPrompt = input?.systemPrompt;
    const apiKey = input?.apiKey;
    if (!baseUrl || baseUrl.length > 2048 || !model || model.length > 512
        || typeof systemPrompt !== "string" || systemPrompt.length > 16000
        || typeof apiKey !== "string" || apiKey.length > 4096 || /[^\x21-\x7e]/.test(apiKey)
        || typeof input.clearKey !== "boolean") {
      throw new ChatError("Enter a Base URL and Model ID. Check the length and formatting of the other fields.");
    }
    const endpoint = parseEndpoint(baseUrl);
    const sameEndpoint = Boolean(settings.baseUrl) && parseEndpoint(settings.baseUrl) === endpoint;
    // A saved key belongs to this endpoint. Changing it requires a fresh key.
    let encryptedKey = sameEndpoint && !input.clearKey ? settings.encryptedKey : "";
    if (apiKey) {
      requireSecureStorage();
      try { encryptedKey = safeStorage.encryptString(apiKey).toString("base64"); } catch {
        throw new ChatError("The system could not encrypt the API key.");
      }
    }
    const next = { baseUrl, model, systemPrompt, encryptedKey };
    try { atomicWriteJson(dataPath("model.json"), next); } catch {
      throw new ChatError("Model settings could not be saved.");
    }
    settings = next;
    notice = "";
  }

  function finish(request, status, detail = "") {
    if (active !== request) return;
    clearTimeout(request.timer);
    active = null;
    const session = history.sessions.find(item => item.id === request.sessionId);
    const assistant = { role: "assistant", text: request.text, status, detail };
    try {
      saveHistory({
        ...history,
        sessions: history.sessions.map(item => item === session
          ? { ...item, messages: [...item.messages, assistant] } : item),
      });
    } catch (error) {
      // Keep the reply visible and allow a subsequent save to retry persistence.
      session.messages.push(assistant);
      notice = error.message;
    }
    publish();
  }

  function stop() {
    if (!active) return;
    const request = active;
    request.controller.abort();
    finish(request, "stopped", "Generation stopped.");
  }

  function send(text) {
    if (active) throw new ChatError("Stop the current reply before sending another message.");
    if (typeof text !== "string" || !text.trim() || text.length > 32000) {
      throw new ChatError("Enter a message of up to 32,000 characters.");
    }
    if (!settings.baseUrl || !settings.model) throw new ChatError("Configure your model before sending.");
    const endpoint = parseEndpoint(settings.baseUrl);
    let apiKey = "";
    if (settings.encryptedKey) {
      requireSecureStorage();
      try { apiKey = safeStorage.decryptString(Buffer.from(settings.encryptedKey, "base64")); } catch {
        throw new ChatError("The API key could not be read. Enter it again in model settings.");
      }
    }

    const previous = history.sessions.find(item => item.id === history.selectedId) || newSession();
    const message = { role: "user", text: text.trim() };
    const session = {
      id: previous.id,
      title: previous.title || message.text.replace(/\s+/g, " ").slice(0, 64),
      messages: [...previous.messages, message],
    };
    saveHistory({ ...history, selectedId: session.id,
      sessions: [session, ...history.sessions.filter(item => item.id !== session.id)] });
    notice = "";

    const messages = session.messages.filter(item => item.text).map(item => ({ role: item.role, content: item.text }));
    if (settings.systemPrompt) messages.unshift({ role: "system", content: settings.systemPrompt });
    const request = { sessionId: session.id, controller: new AbortController(), text: "", timer: null };
    active = request;
    const timeout = AbortSignal.timeout(5 * 60 * 1000);
    void streamReply({
      endpoint, model: settings.model, apiKey, messages,
      signal: AbortSignal.any([request.controller.signal, timeout]),
      onDelta(delta) {
        if (active !== request) return;
        request.text += delta;
        request.timer ??= setTimeout(() => {
          request.timer = null;
          if (active === request) publish();
        }, 80);
      },
    }).then(
      () => finish(request, "done"),
      error => finish(request, "error", error instanceof ChatError ? error.message
        : timeout.aborted ? "The model request timed out." : "Could not reach the model endpoint."),
    );
  }

  function openLink(link) {
    let url;
    try { url = new URL(link); } catch {}
    if (url && ["https:", "http:"].includes(url.protocol) && !url.username && !url.password) {
      void shell.openExternal(url.href).catch(() => {});
    }
  }

  function handle(channel, action) {
    ipcMain.handle(`chat:${channel}`, (event, value) => {
      const frame = event.senderFrame;
      if (!win || event.sender !== win.webContents || !frame || frame.parent || frame.url !== PAGE_URL) {
        return { error: "Chat window is unavailable." };
      }
      try {
        if (!history || !settings) loadData();
        action(value);
        return { state: snapshot() };
      } catch (error) {
        return { error: error instanceof ChatError ? error.message : "The chat action failed." };
      }
    });
  }
  handle("get", () => {});
  handle("select", select);
  handle("create", create);
  handle("send", send);
  handle("stop", stop);
  handle("save-model", saveModel);
  handle("open-link", openLink);

  function open() {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      return;
    }
    const window = new BrowserWindow({
      title: "Character OS Chat",
      width: 980, height: 730, minWidth: 620, minHeight: 470,
      show: false,
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#191c20" : "#fbf9f5",
      webPreferences: {
        preload: path.join(__dirname, "preload-chat.js"),
        contextIsolation: true, sandbox: true, nodeIntegration: false,
        spellcheck: false,
      },
    });
    win = window;
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", event => event.preventDefault());
    window.once("ready-to-show", () => window.show());
    window.webContents.once("did-finish-load", showRequestedModelSettings);
    window.on("closed", () => {
      win = null;
      stop();
    });
    void window.loadFile(PAGE).catch(() => { if (!window.isDestroyed()) window.close(); });
  }

  function showRequestedModelSettings() {
    if (!modelSettingsRequested || !win) return;
    modelSettingsRequested = false;
    win.webContents.send("chat:open-model-settings");
  }

  function openModelSettings() {
    modelSettingsRequested = true;
    open();
    if (!win?.webContents.isLoading()) showRequestedModelSettings();
  }

  return { open, openModelSettings, stop };
}

module.exports = { createChatWindow };
