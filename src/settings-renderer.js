"use strict";

const core = globalThis.ClawdSettingsCore;
const { helpers, ops, state } = core;
const t = helpers.t;

globalThis.ClawdSettingsTabGeneral.init(core);
globalThis.ClawdSettingsTabPet.init(core);
globalThis.ClawdSettingsTabPermissions.init(core);

const { buildLanguageRow } = core.tabs.general;
const { buildSizeSliderRow, buildPetAlwaysOnTopRow } = core.tabs.pet;
const { renderLocalBody: renderPermissions } = core.tabs.permissions;
delete core.tabs.pet;
delete core.tabs.permissions;

const tabs = [
  { id: "general", labelKey: "sidebarGeneral" },
  { id: "models", labelKey: "productModels" },
  { id: "agents", labelKey: "productAgents" },
  { id: "data", labelKey: "productData" },
  { id: "character", labelKey: "productCharacter" },
];
let navigation;
let themes = [];
let agents = [];

function switchRow(key, labelKey, options = {}) {
  return helpers.buildSwitchRow({ key, labelKey, ...options });
}

function actionRow(labelKey, buttonKey, action, payload) {
  const row = helpers.buildSettingRow({ labelKey });
  const button = helpers.buildButton({ labelKey: buttonKey });
  helpers.attachActivation(button, () => window.settingsAPI.command(action, payload));
  row.controlElement.appendChild(button);
  return row.element;
}

function buildThemeRow() {
  const row = helpers.buildSettingRow({ labelKey: "sidebarTheme" });
  if (!themes.length) return row.element;
  const selected = state.snapshot?.theme || themes.find(theme => theme.active)?.id;
  const select = helpers.buildSettingsSelect({
    value: selected,
    options: themes.map(theme => ({ value: theme.id, label: theme.name || theme.id })),
    ariaLabel: t("sidebarTheme"),
    onChange: async (themeId) => {
      const result = await window.settingsAPI.command("setThemeSelection", { themeId });
      if (result?.status === "ok") return true;
      ops.showToast(t("toastSaveFailed") + (result?.message || ""), { error: true });
      return false;
    },
  });
  row.controlElement.appendChild(select.element);
  return row.element;
}

function buildAgentRow(agent) {
  const flags = state.snapshot?.agents?.[agent.id] || {};
  const row = helpers.buildSettingRow({ label: agent.name });
  const toggle = helpers.buildButton({ labelKey: flags.enabled ? "productPause" : "productEnable" });
  helpers.attachActivation(toggle, () => window.settingsAPI.command("setAgentFlag", {
    agentId: agent.id, flag: "enabled", value: !flags.enabled,
  }));
  const hooks = helpers.buildButton({
    labelKey: flags.integrationInstalled ? "productRemoveHooks" : "productInstallHooks",
  });
  helpers.attachActivation(hooks, async () => {
    if (flags.integrationInstalled) {
      const result = await helpers.showSettingsConfirmModal({
        title: t("agentIntegrationUninstallConfirmTitle"),
        detail: t("agentIntegrationUninstallConfirm"),
        actions: [
          { id: "cancel", label: t("agentIntegrationUninstallCancel"), defaultFocus: true },
          { id: "remove", label: t("productRemoveHooks"), tone: "danger" },
        ],
      });
      if (result !== "remove") return { status: "ok" };
    }
    return window.settingsAPI.command(
      flags.integrationInstalled ? "uninstallAgentIntegration" : "installAgentIntegration",
      { agentId: agent.id },
    );
  });
  row.controlElement.append(toggle, hooks);
  return row.element;
}

function buildCodexModeRow() {
  const mode = core.readers.readAgentPermissionMode("codex");
  const row = helpers.buildSettingRow({
    labelKey: "rowCodexApprovalOwner",
    descriptionKey: mode === "intercept" ? "rowCodexApprovalOwnerInterceptDesc" : "rowCodexApprovalOwnerAutoDesc",
  });
  const select = helpers.buildSettingsSelect({
    value: mode === "intercept" ? "intercept" : "auto",
    options: [
      { value: "auto", label: t("productCodexAutomatic") },
      { value: "intercept", label: t("productCodexIntercept") },
    ],
    ariaLabel: t("rowCodexApprovalOwner"),
    onChange: async (mode) => {
      const result = await window.settingsAPI.command("setAgentPermissionMode", { agentId: "codex", mode });
      if (result?.status === "ok") return true;
      ops.showToast(t("toastSaveFailed") + (result?.message || ""), { error: true });
      return false;
    },
  });
  row.controlElement.appendChild(select.element);
  return row.element;
}

function section(parent, labelKey, rows) {
  parent.appendChild(helpers.buildSection(t(labelKey), rows));
}

core.tabs.general = { render(parent) {
  section(parent, "sidebarGeneral", [
    buildLanguageRow(),
    switchRow("openAtLogin", "rowOpenAtLogin"),
    buildThemeRow(),
  ]);
  section(parent, "sidebarNotifications", [
    switchRow("soundMuted", "rowSoundEnabled", { invert: true }),
  ]);
} };
core.tabs.models = { render(parent) {
  section(parent, "productModels", [
    actionRow("productModelConfiguration", "productConfigure", "openChatModelSettings"),
  ]);
} };
core.tabs.agents = { render(parent) {
  section(parent, "productAgents", agents.map(buildAgentRow));
  section(parent, "sidebarPermissions", [
    switchRow("permissionBubblesEnabled", "productPermissionBubbles"),
    ...(core.readers.readAgentIntegrationInstalled("codex") ? [buildCodexModeRow()] : []),
  ]);
  renderPermissions(parent, { includeCodexLink: false });
} };
core.tabs.data = { render(parent) {
  section(parent, "productData", [
    actionRow("productLocalData", "productOpenFolder", "openLocalDataFolder"),
  ]);
} };
core.tabs.character = { render(parent) {
  section(parent, "productCharacter", [
    buildSizeSliderRow(),
    switchRow("keepSizeAcrossDisplays", "rowKeepSizeAcrossDisplays"),
    buildPetAlwaysOnTopRow(),
    ...(core.i18n.IS_MAC || core.i18n.IS_WIN ? [
      switchRow("fullscreenAutoHide", "rowFullscreenAutoHide"),
    ] : []),
    actionRow("productPetPosition", "productRecoverPet", "recoverPetPosition"),
  ]);
} };

function renderSidebar() {
  const sidebar = document.getElementById("sidebar");
  const panels = navigation?.panels;
  navigation?.dispose();
  navigation = helpers.buildTabs({
    id: "settings-navigation",
    ariaLabel: t("settingsWindowTitle"),
    orientation: "vertical",
    className: "settings-sidebar-tabs",
    buttonClassName: "sidebar-item",
    value: state.activeTab,
    panels,
    options: tabs.map(({ id, labelKey }) => ({ value: id, label: t(labelKey) })),
    onChange: tab => ops.selectTab(tab),
  });
  sidebar.replaceChildren(navigation.element);
}

function renderContent() {
  document.title = t("settingsWindowTitle");
  const content = document.getElementById("content");
  ops.clearMountedControls();
  if (!navigation) renderSidebar();
  navigation.setValue(state.activeTab);
  content.replaceChildren(...navigation.panels.values());
  const panel = navigation.panels.get(state.activeTab);
  panel.replaceChildren();
  core.tabs[state.activeTab].render(panel);
}

ops.installRenderHooks({ sidebar: renderSidebar, content: renderContent });
ops.restoreNavigationState();
if (!tabs.some(tab => tab.id === state.activeTab)) ops.selectTab("general");
window.addEventListener("beforeunload", () => ops.persistNavigationState());
window.settingsAPI.onChanged(payload => ops.applyChanges(payload));
window.settingsAPI.onSizeContextChanged(() => ops.syncMountedSizeControl({ fromBroadcast: true }));

Promise.all([
  window.settingsAPI.getSnapshot(),
  window.settingsAPI.listThemes().catch(() => []),
  window.settingsAPI.listAgents().catch(() => []),
]).then(([snapshot, localThemes, localAgents]) => {
  themes = localThemes;
  agents = localAgents;
  ops.applyBootstrap(snapshot);
}).catch(() => {
  document.getElementById("content").textContent = t("toastSaveFailed");
});
