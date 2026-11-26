"use strict";

const el = id => document.getElementById(id);
const messageInput = el("message");
const transcript = el("transcript");
const viewport = el("viewport");
const settings = el("settings");
let state;
let settingsRequested = false;
let pending = false;
let sidebarKey = "";
let transcriptKey = "";

function showError(target, message = "") {
  target.hidden = !message;
  target.textContent = message;
}

function updateComposer() {
  const generating = Boolean(state?.generating);
  el("send").hidden = generating;
  el("send").disabled = pending || !state || !messageInput.value.trim();
  el("stop").hidden = !generating;
  el("stop").disabled = pending;
  el("chat-status").textContent = generating ? "Generating…" : "";
}

function render(next) {
  if (!next || (state && next.revision <= state.revision)) return;
  const changedSession = next.selectedId !== state?.selectedId;
  const follow = changedSession || viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 72;
  state = next;
  const selected = state.sessions.find(session => session.id === state.selectedId);
  el("title").textContent = selected?.title || "Chat";

  const navKey = JSON.stringify([state.selectedId, state.sessions]);
  if (navKey !== sidebarKey) {
    sidebarKey = navKey;
    const selectedButton = document.activeElement?.dataset.sessionId;
    const buttons = state.sessions.map(session => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "session";
      button.dataset.sessionId = session.id;
      button.textContent = session.title || "New chat";
      button.title = button.textContent;
      if (session.id === state.selectedId) button.setAttribute("aria-current", "true");
      button.addEventListener("click", () => action(() => window.chat.select(session.id)));
      return button;
    });
    el("sessions").replaceChildren(...buttons);
    buttons.find(button => button.dataset.sessionId === selectedButton)?.focus();
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
      // Supplied by the main process from markdown-it with raw HTML and images disabled.
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

  el("empty").hidden = state.messages.length > 0;
  const configured = Boolean(state.model.baseUrl && state.model.model);
  el("setup-message").hidden = configured;
  el("configure").hidden = configured;
  el("model-settings").title = state.model.model || "Connect a model";
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
    showError(errorTarget, "Could not reach the chat window.");
    return false;
  } finally {
    pending = false;
    updateComposer();
  }
}

function showSettings() {
  if (!state) return;
  settingsRequested = false;
  if (settings.open) return;
  el("base-url").value = state.model.baseUrl;
  el("model-id").value = state.model.model;
  el("system-prompt").value = state.model.systemPrompt;
  el("api-key").value = "";
  el("api-key").placeholder = state.model.hasKey ? "Saved · enter a new key to replace"
    : "Optional for endpoints without authentication";
  el("key-hint").textContent = state.model.hasKey
    ? "Key saved securely. Changing the endpoint clears this key unless you enter a replacement."
    : "Keys are encrypted using your system’s secure storage.";
  el("clear-key").checked = false;
  el("clear-key-row").hidden = !state.model.hasKey;
  showError(el("settings-error"));
  settings.showModal();
}

window.chat.onChanged(render);
window.chat.onOpenModelSettings(() => {
  settingsRequested = true;
  showSettings();
});
void action(window.chat.get);

el("new-chat").addEventListener("click", async () => {
  if (await action(window.chat.create)) messageInput.focus();
});
el("model-settings").addEventListener("click", showSettings);
el("configure").addEventListener("click", showSettings);
el("cancel-settings").addEventListener("click", () => settings.close());
settings.addEventListener("close", () => { el("api-key").value = ""; });
el("model-form").addEventListener("submit", async event => {
  event.preventDefault();
  el("save-model").disabled = true;
  const saved = await action(() => window.chat.saveModel({
    baseUrl: el("base-url").value,
    model: el("model-id").value,
    systemPrompt: el("system-prompt").value,
    apiKey: el("api-key").value,
    clearKey: el("clear-key").checked,
  }), el("settings-error"));
  el("api-key").value = "";
  el("save-model").disabled = false;
  if (saved) {
    settings.close();
    messageInput.focus();
  }
});

messageInput.addEventListener("input", updateComposer);
messageInput.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    el("composer").requestSubmit();
  }
});
el("composer").addEventListener("submit", async event => {
  event.preventDefault();
  const value = messageInput.value;
  if (pending || !state || state.generating || !value.trim()) return;
  if (!state.model.baseUrl || !state.model.model) {
    showSettings();
    return;
  }
  if (await action(() => window.chat.send(value))) {
    if (messageInput.value === value) messageInput.value = "";
    viewport.scrollTop = viewport.scrollHeight;
  }
  updateComposer();
});
el("stop").addEventListener("click", () => action(window.chat.stop));

transcript.addEventListener("click", event => {
  const link = event.target.closest("a");
  if (!link) return;
  event.preventDefault();
  void window.chat.openLink(link.href);
});
