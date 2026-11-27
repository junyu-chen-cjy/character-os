"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { randomUUID } = require("node:crypto");
const MarkdownIt = require("markdown-it");
const { atomicWriteJson } = require("./quota-credential-store");
const { ChatError, parseEndpoint, streamReply } = require("./chat-provider");
const { runAgentTurn } = require("./personal-agent-core");
const { applyActiveSpaceWindowBehavior } = require("./mac-window");

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

const CMD_WIDTH = 520;
const CMD_MIN_HEIGHT = 60;
const CMD_MAX_HEIGHT = 640;

function summarizeStepForUi(step) {
  if (!step || typeof step !== "object") return null;
  const out = {
    id: String(step.id || ""),
    tool: String(step.tool || ""),
    status: String(step.status || "running"),
  };
  if (step.code) out.code = String(step.code);
  if (step.error) out.error = String(step.error).slice(0, 300);
  if (step.confirmation) out.confirmation = step.confirmation;
  const r = step.result;
  if (r && typeof r === "object") {
    if (step.tool === "search_files" && Array.isArray(r.results)) {
      out.totalFound = Number(r.totalFound) || r.results.length;
      out.files = r.results.slice(0, 8).map((f) => ({
        path: f.path,
        name: f.name,
        type: f.type,
        extension: f.extension || null,
        modifiedAt: f.modifiedAt || null,
      }));
    } else if (step.tool === "open_file") {
      out.file = { action: r.action, path: r.path, name: r.name };
    } else if (step.tool === "list_agent_sessions") {
      out.liveCount = Number(r.liveCount) || 0;
      out.recentCount = Number(r.recentCount) || 0;
      out.onlineClientCount = Array.isArray(r.clients) ? r.clients.filter((c) => c && c.running).length : 0;
    } else if (step.tool === "get_agent_status") {
      out.sessionCount = Array.isArray(r.sessions) ? r.sessions.length : 0;
    } else if (step.tool === "get_quota") {
      out.serviceCount = Array.isArray(r.services) ? r.services.length : 0;
    } else if (step.tool === "send_agent_message") {
      out.stage = r.stage || "";
      out.deliveryStatus = r.deliveryStatus || r.status || "";
      out.executionStatus = r.executionStatus || "";
      out.verifiedInConversation = Boolean(r.verifiedInConversation);
      out.clientLabel = r.clientLabel || r.client || "";
      out.project = r.project || "";
      out.sessionTitle = r.sessionTitle || "";
      out.isBlankDraft = Boolean(r.isBlankDraft);
      if (r.status === "ambiguous" && Array.isArray(r.candidates)) {
        out.ambiguousCount = r.candidates.length;
      }
    }
  }
  return out;
}

function createChatWindow({ app, BrowserWindow, ipcMain, nativeTheme, safeStorage, shell, getLang, screen, isAppQuitting, toolsRegistry }) {
  const isQuitting = typeof isAppQuitting === "function" ? isAppQuitting : () => false;
  const hasToolsRegistry = Boolean(toolsRegistry && typeof toolsRegistry === "object" && Object.keys(toolsRegistry).length > 0);
  let win;
  let history;
  let settings;
  let active;
  const pendingConfirmations = new Map();
  let notice = "";
  let revision = 0;
  let modelSettingsRequested = false;
  const rendered = new WeakMap();
  const isCaseInsensitiveFs = process.platform === "darwin" || process.platform === "win32";
  const PAGE_URL_LOWER = PAGE_URL.toLowerCase();

  function resolveLang() {
    try {
      const value = typeof getLang === "function" ? getLang() : "en";
      return typeof value === "string" && value ? value : "en";
    } catch {
      return "en";
    }
  }

  function resolveWindowTitle() {
    const l = resolveLang();
    if (l === "zh") return "Character OS · 指令";
    if (l === "zh-TW") return "Character OS · 指令";
    if (l === "ja") return "Character OS · コマンド";
    if (l === "ko") return "Character OS · 명령";
    return "Character OS · Command";
  }

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
      return {
        role: "assistant",
        html: rendered.get(message),
        status: message.status,
        detail: message.detail,
        ...(Array.isArray(message.steps) && message.steps.length ? { steps: message.steps } : {}),
      };
    });
    if (session && active?.sessionId === session.id) {
      messages.push({
        role: "assistant",
        html: markdown.render(active.text),
        status: "streaming",
        ...(Array.isArray(active.steps) && active.steps.length ? { steps: active.steps } : {}),
      });
    }
    return {
      revision: ++revision,
      lang: resolveLang(),
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
    for (const [, resolver] of pendingConfirmations) {
      try { resolver(false); } catch {}
    }
    pendingConfirmations.clear();
    const session = history.sessions.find(item => item.id === request.sessionId);
    const savedSteps = Array.isArray(request.steps) && request.steps.length
      ? request.steps.map((s) => (s.status === "confirming" ? { ...s, status: "cancelled" } : s))
      : undefined;
    const assistant = {
      role: "assistant",
      text: request.text,
      status,
      detail,
      ...(savedSteps ? { steps: savedSteps } : {}),
    };
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
    for (const [, resolver] of pendingConfirmations) {
      try { resolver(false); } catch {}
    }
    pendingConfirmations.clear();
    request.controller.abort();
    finish(request, "stopped", "Generation stopped.");
  }

  function confirmTool(payload) {
    const stepId = typeof payload?.stepId === "string" ? payload.stepId : "";
    const approved = payload?.approved === true;
    const resolver = pendingConfirmations.get(stepId);
    if (!resolver) return;
    pendingConfirmations.delete(stepId);
    resolver(approved);
  }

  async function openFileFromUi(payload) {
    if (!hasToolsRegistry || !toolsRegistry.open_file) {
      throw new ChatError("File opener is unavailable.");
    }
    const res = await toolsRegistry.open_file.execute({
      path: typeof payload?.path === "string" ? payload.path : "",
      reveal: payload?.reveal === true,
    });
    if (res?.status === "error") {
      throw new ChatError(res.error || "Could not open file.");
    }
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
    const request = { sessionId: session.id, controller: new AbortController(), text: "", steps: [], timer: null };
    active = request;
    const timeout = AbortSignal.timeout(5 * 60 * 1000);
    const combinedSignal = AbortSignal.any([request.controller.signal, timeout]);
    const schedulePublish = () => {
      request.timer ??= setTimeout(() => {
        request.timer = null;
        if (active === request) publish();
      }, 80);
    };
    const onDelta = (delta) => {
      if (active !== request) return;
      request.text += delta;
      schedulePublish();
    };

    const runPromise = hasToolsRegistry
      ? runAgentTurn({
        endpoint,
        model: settings.model,
        apiKey,
        messages,
        userSystemPrompt: settings.systemPrompt,
        registry: toolsRegistry,
        signal: combinedSignal,
        onDelta,
        onStep(nextSteps) {
          if (active !== request) return;
          request.steps = nextSteps.map(summarizeStepForUi).filter(Boolean);
          publish();
        },
        requestConfirmation(stepId, _confirm, sig) {
          return new Promise((resolve) => {
            if (sig?.aborted) { resolve(false); return; }
            const done = (val) => {
              pendingConfirmations.delete(stepId);
              resolve(Boolean(val));
            };
            pendingConfirmations.set(stepId, done);
            if (sig) sig.addEventListener("abort", () => done(false), { once: true });
          });
        },
      })
      : (() => {
        const plainMessages = settings.systemPrompt
          ? [{ role: "system", content: settings.systemPrompt }, ...messages]
          : messages;
        return streamReply({
          endpoint,
          model: settings.model,
          apiKey,
          messages: plainMessages,
          signal: combinedSignal,
          onDelta,
        });
      })();

    void runPromise.then(
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
      const frameUrl = frame && typeof frame.url === "string" ? frame.url : "";
      const urlOk = frameUrl === PAGE_URL || (isCaseInsensitiveFs && frameUrl.toLowerCase() === PAGE_URL_LOWER);
      if (!win || event.sender !== win.webContents || !frame || frame.parent || !urlOk) {
        return { error: "Chat window is unavailable." };
      }
      try {
        if (!history || !settings) loadData();
        const maybePromise = action(value);
        if (maybePromise && typeof maybePromise.then === "function") {
          return maybePromise.then(
            () => ({ state: snapshot() }),
            (error) => ({ error: error instanceof ChatError ? error.message : "The chat action failed." }),
          );
        }
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
  handle("confirm-tool", confirmTool);
  handle("open-file", openFileFromUi);

  function fromWindow(event) {
    return Boolean(win && !win.isDestroyed() && event.sender === win.webContents);
  }

  // Place the box like a launcher: horizontally centred, in the upper third of
  // the display the pointer is on.
  function placeNearTop() {
    if (!win || win.isDestroyed() || !screen || typeof screen.getCursorScreenPoint !== "function") return;
    try {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const area = display.workArea;
      const [, height] = win.getSize();
      win.setPosition(
        Math.round(area.x + (area.width - CMD_WIDTH) / 2),
        Math.round(area.y + Math.min(area.height * 0.2, Math.max(40, area.height - height - 40))),
      );
    } catch {}
  }

  function resizeTo(height) {
    if (!win || win.isDestroyed() || !Number.isFinite(height)) return;
    const next = Math.round(Math.min(CMD_MAX_HEIGHT, Math.max(CMD_MIN_HEIGHT, height)));
    const [width, current] = win.getContentSize();
    if (width !== CMD_WIDTH || current !== next) win.setContentSize(CMD_WIDTH, next);
  }

  function hide() {
    if (!win || win.isDestroyed()) return;
    if (typeof win.isVisible === "function" && !win.isVisible()) return;
    try {
      if (process.platform === "darwin" && typeof win.setAlwaysOnTop === "function") {
        win.setAlwaysOnTop(false);
      }
      win.hide();
    } catch {}
  }

  if (ipcMain && typeof ipcMain.on === "function") {
    ipcMain.on("chat:resize", (event, height) => { if (fromWindow(event)) resizeTo(Number(height)); });
    ipcMain.on("chat:dismiss", (event) => { if (fromWindow(event)) hide(); });
    ipcMain.on("chat:blurred", (event) => {
      // The box behaves like a launcher and leaves when focus does.
      if (fromWindow(event) && Date.now() - openedAt > 250) hide();
    });
  }

  let openedAt = 0;
  function open() {
    openedAt = Date.now();
    if (win && !win.isDestroyed()) {
      // Detach from any previous Space before showing so macOS opens the
      // launcher cleanly in the active Space (ordinary or fullscreen) without
      // using CanJoinAllSpaces (which causes flashing during 4-finger Space swipes).
      if (process.platform === "darwin") {
        if (typeof win.isVisible === "function" && win.isVisible() && typeof win.hide === "function") {
          win.hide();
        }
        applyActiveSpaceWindowBehavior(win);
      }
      placeNearTop();
      if (typeof win.setTitle === "function") win.setTitle(resolveWindowTitle());
      if (typeof win.setAlwaysOnTop === "function") win.setAlwaysOnTop(true, "floating");
      if (typeof win.isMinimized === "function" && win.isMinimized()) win.restore();
      if (typeof win.show === "function") win.show();
      if (typeof win.focus === "function") win.focus();
      if (win.webContents && typeof win.webContents.send === "function") {
        win.webContents.send("chat:focus-input");
      }
      return;
    }
    const window = new BrowserWindow({
      title: resolveWindowTitle(),
      width: CMD_WIDTH, height: CMD_MIN_HEIGHT, useContentSize: true,
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      ...(process.platform === "darwin"
        ? { acceptFirstMouse: true, hiddenInMissionControl: true, vibrancy: "popover", visualEffectState: "active", backgroundColor: "#00000000", hasShadow: true }
        : { backgroundColor: nativeTheme.shouldUseDarkColors ? "#1d1e22" : "#fcfcfa" }),
      webPreferences: {
        preload: path.join(__dirname, "preload-chat.js"),
        contextIsolation: true, sandbox: true, nodeIntegration: false,
        spellcheck: false,
      },
    });
    win = window;
    // Use MoveToActiveSpace | FullScreenAuxiliary (identical to Workspace) instead
    // of CanJoinAllSpaces so 4-finger trackpad Space swipes never flash the launcher.
    if (process.platform === "darwin") {
      applyActiveSpaceWindowBehavior(window);
    }
    if (typeof window.setAlwaysOnTop === "function") window.setAlwaysOnTop(true, "floating");
    placeNearTop();
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", event => event.preventDefault());
    window.once("ready-to-show", () => {
      window.show();
      if (typeof window.focus === "function") window.focus();
    });
    window.webContents.once("did-finish-load", showRequestedModelSettings);
    window.on("blur", () => {
      if (win === window && Date.now() - openedAt > 250) hide();
    });
    window.on("close", (event) => {
      if (win === window && !isQuitting()) {
        if (event && typeof event.preventDefault === "function") event.preventDefault();
        hide();
      }
    });
    window.on("closed", () => {
      win = null;
      stop();
    });
    void window.loadFile(PAGE).catch(() => { if (!window.isDestroyed()) window.close(); });
  }

  function syncLang() {
    if (win && !win.isDestroyed() && typeof win.setTitle === "function") {
      win.setTitle(resolveWindowTitle());
    }
    publish();
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

  return { open, hide, openModelSettings, stop, syncLang };
}

module.exports = { createChatWindow };
