"use strict";

const STRINGS = {
  en: {
    windowTitle: "Character OS · Command",
    title: "Command",
    newChat: "New",
    newChatTitle: "New conversation (⌘N)",
    historyTitle: "History",
    recentThreads: "Recent",
    untitledThread: "Untitled",
    connectModel: "Connect model",
    editModelTitle: "Model settings",
    unconfiguredNotice: "No model configured.",
    configureButton: "Configure model",
    placeholder: "Type a command or question…",
    kbdHint: "↵ Send · ⇧↵ New line",
    send: "Send",
    stop: "Stop",
    generating: "Generating…",
    modalTitle: "Model Settings",
    baseUrl: "Base URL",
    modelId: "Model ID",
    apiKey: "API Key",
    apiKeyPlaceholder: "Optional for local endpoints",
    apiKeySavedPlaceholder: "Leave blank to keep saved key",
    keyHint: "Encrypted locally with system credential storage.",
    keySavedHint: "A key is saved for this endpoint. Enter a new key to replace it.",
    clearKey: "Remove saved key",
    systemPrompt: "System Prompt",
    systemPromptPlaceholder: "Optional system instructions",
    cancel: "Cancel",
    save: "Save",
    unreachable: "Could not reach the command window.",
  },
  zh: {
    windowTitle: "Character OS · 指令",
    title: "指令",
    newChat: "新对话",
    newChatTitle: "新建对话 (⌘N)",
    historyTitle: "历史记录",
    recentThreads: "最近对话",
    untitledThread: "未命名对话",
    connectModel: "未配置模型",
    editModelTitle: "模型配置",
    unconfiguredNotice: "尚未配置模型接口。",
    configureButton: "配置模型",
    placeholder: "输入指令或问题…",
    kbdHint: "↵ 发送 · ⇧↵ 换行",
    send: "发送",
    stop: "停止",
    generating: "生成中…",
    modalTitle: "模型配置",
    baseUrl: "接口地址 (Base URL)",
    modelId: "模型 ID",
    apiKey: "API 密钥",
    apiKeyPlaceholder: "本地免鉴权接口可留空",
    apiKeySavedPlaceholder: "留空则保留已保存的密钥",
    keyHint: "API 密钥通过系统钥匙串在本机加密存储。",
    keySavedHint: "当前接口已保存密钥，输入新密钥即可替换。",
    clearKey: "移除已保存密钥",
    systemPrompt: "系统提示词",
    systemPromptPlaceholder: "可选的全局指令",
    cancel: "取消",
    save: "保存",
    unreachable: "无法连接指令窗口。",
  },
  "zh-TW": {
    windowTitle: "Character OS · 指令",
    title: "指令",
    newChat: "新對話",
    newChatTitle: "新增對話 (⌘N)",
    historyTitle: "歷史記錄",
    recentThreads: "最近對話",
    untitledThread: "未命名對話",
    connectModel: "未設定模型",
    editModelTitle: "模型設定",
    unconfiguredNotice: "尚未設定模型介面。",
    configureButton: "設定模型",
    placeholder: "輸入指令或問題…",
    kbdHint: "↵ 傳送 · ⇧↵ 換行",
    send: "傳送",
    stop: "停止",
    generating: "產生中…",
    modalTitle: "模型設定",
    baseUrl: "介面位址 (Base URL)",
    modelId: "模型 ID",
    apiKey: "API 金鑰",
    apiKeyPlaceholder: "本機免驗證介面可留空",
    apiKeySavedPlaceholder: "留空則保留已儲存金鑰",
    keyHint: "API 金鑰透過系統鑰匙圈在本機加密儲存。",
    keySavedHint: "目前介面已儲存金鑰，輸入新金鑰即可取代。",
    clearKey: "移除已儲存金鑰",
    systemPrompt: "系統提示詞",
    systemPromptPlaceholder: "可選的全域指令",
    cancel: "取消",
    save: "儲存",
    unreachable: "無法連接指令視窗。",
  },
};

const el = id => document.getElementById(id);
const messageInput = el("message");
const transcript = el("transcript");
const viewport = el("viewport");
const settings = el("settings");
const historyDrawer = el("history-drawer");
const toggleHistoryBtn = el("toggle-history");

let state;
let currentLang = "en";
let settingsRequested = false;
let pending = false;
let sidebarKey = "";
let transcriptKey = "";
let historyOpen = false;

function t(key) {
  const dict = STRINGS[currentLang] || STRINGS.en;
  return dict[key] || STRINGS.en[key] || key;
}

function applyLocaleChrome() {
  document.documentElement.lang = currentLang;
  document.title = t("windowTitle");
  toggleHistoryBtn.title = t("historyTitle");
  toggleHistoryBtn.setAttribute("aria-label", t("historyTitle"));
  el("new-chat").title = t("newChatTitle");
  el("new-chat-label").textContent = t("newChat");
  el("drawer-title").textContent = t("recentThreads");
  el("setup-message").textContent = t("unconfiguredNotice");
  el("configure").textContent = t("configureButton");
  messageInput.placeholder = t("placeholder");
  messageInput.setAttribute("aria-label", t("title"));
  el("kbd-hint").textContent = t("kbdHint");
  el("stop").textContent = t("stop");
  el("send").setAttribute("aria-label", t("send"));
  el("modal-title").textContent = t("modalTitle");
  el("lbl-base-url").textContent = t("baseUrl");
  el("lbl-model-id").textContent = t("modelId");
  el("lbl-api-key").textContent = t("apiKey");
  el("lbl-clear-key").textContent = t("clearKey");
  el("lbl-system-prompt").textContent = t("systemPrompt");
  el("system-prompt").placeholder = t("systemPromptPlaceholder");
  el("cancel-settings").textContent = t("cancel");
  el("save-model").textContent = t("save");
}

function showError(target, message = "") {
  target.hidden = !message;
  target.textContent = message;
}

function syncTextareaHeight() {
  messageInput.style.height = "auto";
  messageInput.style.height = `${Math.min(150, Math.max(24, messageInput.scrollHeight))}px`;
}

function setHistoryOpen(next) {
  historyOpen = Boolean(next);
  historyDrawer.hidden = !historyOpen;
  toggleHistoryBtn.setAttribute("aria-expanded", historyOpen ? "true" : "false");
}

function updateComposer() {
  const generating = Boolean(state?.generating);
  el("send").hidden = generating;
  el("send").disabled = pending || !state || !messageInput.value.trim();
  el("stop").hidden = !generating;
  el("stop").disabled = pending;
  el("chat-status").textContent = generating ? t("generating") : "";
}

function render(next) {
  if (!next || (state && next.revision <= state.revision)) return;
  const changedSession = next.selectedId !== state?.selectedId;
  const follow = changedSession || viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 72;
  state = next;
  if (typeof state.lang === "string" && state.lang) {
    currentLang = state.lang;
  }
  applyLocaleChrome();

  const selected = state.sessions.find(session => session.id === state.selectedId);
  el("title").textContent = selected?.title || t("title");

  const navKey = JSON.stringify([currentLang, state.selectedId, state.sessions]);
  if (navKey !== sidebarKey) {
    sidebarKey = navKey;
    const buttons = state.sessions.map(session => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "session";
      button.dataset.sessionId = session.id;
      button.textContent = session.title || t("untitledThread");
      button.title = button.textContent;
      if (session.id === state.selectedId) button.setAttribute("aria-current", "true");
      button.addEventListener("click", async () => {
        setHistoryOpen(false);
        if (await action(() => window.chat.select(session.id))) {
          messageInput.focus();
        }
      });
      return button;
    });
    el("sessions").replaceChildren(...buttons);
  }

  const messageKey = JSON.stringify(state.messages);
  if (messageKey !== transcriptKey) {
    transcriptKey = messageKey;
    const rows = state.messages.map(message => {
      const row = document.createElement("article");
      row.className = message.role === "assistant" ? "message assistant" : "message user";
      if (message.role !== "assistant") {
        row.textContent = message.text;
        return row;
      }
      const body = document.createElement("div");
      body.className = "markdown";
      body.innerHTML = message.html;
      row.append(body);
      if (message.detail) {
        const detail = document.createElement("p");
        detail.className = message.status === "error" ? "reply-detail error" : "reply-detail";
        detail.textContent = message.detail;
        row.append(detail);
      }
      return row;
    });
    transcript.replaceChildren(...rows);
  }

  const configured = Boolean(state.model.baseUrl && state.model.model);
  el("empty").hidden = configured || state.messages.length > 0;
  el("model-dot").classList.toggle("is-ready", configured);
  el("model-label").textContent = configured ? state.model.model : t("connectModel");
  el("model-settings").title = configured
    ? `${state.model.model} · ${t("editModelTitle")}`
    : t("editModelTitle");
  showError(el("chat-error"), state.notice);
  updateComposer();
  if (follow) viewport.scrollTop = viewport.scrollHeight;
  if (settingsRequested) showSettings();
}

async function action(run, errorTarget = el("chat-error")) {
  if (pending) return false;
  pending = true;
  updateComposer();
  showError(errorTarget);
  try {
    const result = await run();
    if (result.error) {
      showError(errorTarget, result.error);
      return false;
    }
    render(result.state);
    return true;
  } catch {
    showError(errorTarget, t("unreachable"));
    return false;
  } finally {
    pending = false;
    updateComposer();
  }
}

function showSettings() {
  if (!state) {
    settingsRequested = true;
    return;
  }
  settingsRequested = false;
  setHistoryOpen(false);
  el("base-url").value = state.model.baseUrl;
  el("model-id").value = state.model.model;
  el("api-key").value = "";
  el("api-key").placeholder = state.model.hasKey ? t("apiKeySavedPlaceholder") : t("apiKeyPlaceholder");
  el("key-hint").textContent = state.model.hasKey ? t("keySavedHint") : t("keyHint");
  el("clear-key").checked = false;
  el("clear-key-row").hidden = !state.model.hasKey;
  el("system-prompt").value = state.model.systemPrompt;
  showError(el("settings-error"));
  if (!settings.open) settings.showModal();
  el("base-url").focus();
}

async function submitMessage() {
  const text = messageInput.value;
  if (!text.trim() || state?.generating) return;
  if (await action(() => window.chat.send(text))) {
    messageInput.value = "";
    syncTextareaHeight();
    updateComposer();
    messageInput.focus();
  }
}

toggleHistoryBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  setHistoryOpen(!historyOpen);
});

document.addEventListener("click", (event) => {
  if (!historyOpen) return;
  if (historyDrawer.contains(event.target) || toggleHistoryBtn.contains(event.target)) return;
  setHistoryOpen(false);
});

el("new-chat").addEventListener("click", async () => {
  setHistoryOpen(false);
  if (await action(() => window.chat.create())) {
    messageInput.focus();
  }
});

el("configure").addEventListener("click", showSettings);
el("model-settings").addEventListener("click", showSettings);
el("cancel-settings").addEventListener("click", () => settings.close());
el("stop").addEventListener("click", () => void action(() => window.chat.stop()));

el("composer").addEventListener("submit", event => {
  event.preventDefault();
  void submitMessage();
});

messageInput.addEventListener("input", () => {
  syncTextareaHeight();
  updateComposer();
});

messageInput.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void submitMessage();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && historyOpen) {
    setHistoryOpen(false);
    messageInput.focus();
  } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n" && !settings.open) {
    event.preventDefault();
    setHistoryOpen(false);
    void action(() => window.chat.create()).then((ok) => {
      if (ok) messageInput.focus();
    });
  }
});

el("model-form").addEventListener("submit", async event => {
  event.preventDefault();
  const ok = await action(() => window.chat.saveModel({
    baseUrl: el("base-url").value,
    model: el("model-id").value,
    apiKey: el("api-key").value,
    clearKey: el("clear-key").checked,
    systemPrompt: el("system-prompt").value,
  }), el("settings-error"));
  if (ok) {
    settings.close();
    messageInput.focus();
  }
});

transcript.addEventListener("click", event => {
  const link = event.target.closest("a[href]");
  if (!link) return;
  event.preventDefault();
  void window.chat.openLink(link.href);
});

window.chat.onChanged(render);
window.chat.onOpenModelSettings(showSettings);
if (typeof window.chat.onFocusInput === "function") {
  window.chat.onFocusInput(() => {
    if (!settings.open) messageInput.focus();
  });
}

applyLocaleChrome();
void action(() => window.chat.get()).then((ok) => {
  if (ok && !settings.open) messageInput.focus();
});
