"use strict";

// Sessions tab: the session HUD, quota reminders, the session
// dashboard, and the timeout cleanup group. patchInPlace only accepts
// SESSIONS_IN_PLACE_KEYS; it never patches notification or pet controls.
(function initSettingsTabSessions(root) {
  const SESSIONS_IN_PLACE_KEYS = new Set([
    "sessionHudEnabled",
    "sessionHudShowStateLabels",
    "sessionHudShowElapsed",
    "sessionHudShowContextUsage",
    "sessionHudCleanupDetached",
    "sessionHudHideCompletedCodexEphemeral",
    "sessionHudHideActiveCodexEphemeral",
    "quotaMergeSources",
    "quotaAlertsEnabled",
    "quotaAlertThresholds",
    "quotaRecoveryAlertsEnabled",
    "sessionStaleMs",
    "workingStaleMs",
    "codexWorkingStaleMs",
    "detachedIdleStaleMs",
  ]);
  const SESSION_CLEANUP_NUMBER_KEYS = new Set([
    "sessionStaleMs",
    "workingStaleMs",
    "codexWorkingStaleMs",
    "detachedIdleStaleMs",
  ]);
  const SESSION_CLEANUP_DEFAULTS = {
    sessionStaleMs: 600_000,
    workingStaleMs: 300_000,
    codexWorkingStaleMs: 1_200_000,
    detachedIdleStaleMs: 30_000,
  };
  const SESSION_HUD_CHILD_SWITCH_KEYS = [
    "sessionHudShowStateLabels",
    "sessionHudShowElapsed",
    "sessionHudShowContextUsage",
    "sessionHudCleanupDetached",
    "sessionHudHideCompletedCodexEphemeral",
    "sessionHudHideActiveCodexEphemeral",
  ];

  let state = null;
  let readers = null;
  let helpers = null;
  let ops = null;
  let i18n = null;

  function t(key) {
    return helpers.t(key);
  }

  function buildDashboardRow() {
    const row = document.createElement("div");
    row.className = "row";
    const text = document.createElement("div");
    text.className = "row-text";
    const label = document.createElement("span");
    label.className = "row-label";
    label.textContent = t("rowSessionDashboard");
    const desc = document.createElement("span");
    desc.className = "row-desc";
    desc.textContent = t("rowSessionDashboardDesc");
    text.append(label, desc);
    const control = document.createElement("div");
    control.className = "row-control";
    const btn = helpers.buildButton({
      labelKey: "actionOpenDashboard",
      tone: "accent",
    });
    btn.addEventListener("click", () => {
      if (window.settingsAPI && typeof window.settingsAPI.openDashboard === "function") {
        window.settingsAPI.openDashboard();
      }
    });
    control.appendChild(btn);
    row.append(text, control);
    return row;
  }

  function buildQuotaControls() {
    const mergeRow = helpers.buildSwitchRow({
      key: "quotaMergeSources",
      labelKey: "rowQuotaMergeSources",
      descKey: "rowQuotaMergeSourcesDesc",
    });
    // "Merge across machines" only matters with more than one reporting source
    // (WSL / SSH remotes). Hidden by default so single-machine users never see
    // a confusing no-op switch; revealed once multiple sources are confirmed.
    mergeRow.style.display = state.snapshot && state.snapshot.quotaMergeSources === true
      ? ""
      : "none";
    const alertsEnabledRow = helpers.buildSwitchRow({
      key: "quotaAlertsEnabled",
      labelKey: "quotaEnabled",
      descKey: "quotaDescription",
    });
    const thresholdsRow = buildQuotaAlertThresholdsRow();
    const recoveryRow = helpers.buildSwitchRow({
      key: "quotaRecoveryAlertsEnabled",
      labelKey: "quotaRecovery",
      descKey: "quotaRecoveryDesc",
    });
    const testRow = buildQuotaNotificationTestRow();
    // Visibility of these rows follows the master switch; see syncReminderRowsVisibility.
    const reminderRows = [thresholdsRow, recoveryRow, testRow];
    const rows = [
      mergeRow,
      alertsEnabledRow,
      thresholdsRow,
      recoveryRow,
      testRow,
    ];
    // The three reminder rows only make sense while the master switch is on.
    // Hide them rather than gray them out, so the section stays compact and
    // never shows a hidden control in its disabled style.
    function syncReminderRowsVisibility() {
      const visible = !!(state.snapshot && state.snapshot.quotaAlertsEnabled === true);
      for (const row of reminderRows) {
        row.hidden = !visible;
        row.setAttribute("aria-hidden", visible ? "false" : "true");
      }
    }
    if (state.mountedControls.quotaAlertThresholds) {
      state.mountedControls.quotaAlertThresholds.syncVisibility = syncReminderRowsVisibility;
    }
    syncReminderRowsVisibility();
    if (window.settingsAPI && typeof window.settingsAPI.getQuotaSourceCount === "function") {
      Promise.resolve(window.settingsAPI.getQuotaSourceCount())
        .then((count) => {
          if (Number(count) <= 1) return;
          mergeRow.style.display = "";
        })
        .catch(() => {});
    }
    return rows;
  }

  function buildQuotaAlertThresholdsRow() {
    const row = document.createElement("div");
    row.className = "row quota-alert-thresholds-row";
    const text = document.createElement("div");
    text.className = "row-text";
    const label = document.createElement("span");
    label.className = "row-label";
    label.textContent = t("quotaThresholds");
    const desc = document.createElement("span");
    desc.className = "row-desc";
    desc.textContent = t("quotaThresholdHelp");
    text.append(label, desc);
    const host = document.createElement("div");
    host.className = "row-control";
    row.append(text, host);

    // The select's option value is the canonical, descending threshold list, so
    // a preset is both the write payload and the selected value.
    const presets = [
      { value: "10", thresholds: [10], labelKey: "quotaPreset10" },
      { value: "20,10", thresholds: [20, 10], labelKey: "quotaPreset20_10" },
      { value: "30,20,10", thresholds: [30, 20, 10], labelKey: "quotaPreset30_20_10" },
      { value: "50,20,10", thresholds: [50, 20, 10], labelKey: "quotaPreset50_20_10" },
    ];

    let pending = false;
    let control = null;
    // Canonical form of the custom option currently built into `control`, or null
    // when that control has no custom option. The select cannot add or remove
    // options in place, so a change forces a rebuild and not just a setValue.
    let customSignature = undefined;

    function readValues() {
      const values = state.snapshot && state.snapshot.quotaAlertThresholds;
      return Array.isArray(values) && values.length ? values : [20, 10];
    }

    function canonical(values) {
      return [...values].sort((a, b) => b - a).join(",");
    }

    function matchPreset(values) {
      const target = canonical(values);
      return presets.find((preset) => preset.value === target) || null;
    }

    function customLabel(values) {
      const list = [...values].sort((a, b) => b - a)
        .map((value) => `${value}%`)
        .join(t("quotaListSeparator"));
      return t("quotaPresetCustom").replace("{list}", list);
    }

    function buildControl(values) {
      if (control) {
        // The old control may be replaced while its own onChange is still in
        // flight. Disposing it makes that pending settle a no-op, and the new
        // control reads the committed snapshot instead of the stale click.
        control.dispose();
        state.mountedControls.settingsSelects.delete(control);
        control.element.remove();
      }
      const preset = matchPreset(values);
      const options = presets.map((presetOption) => ({
        value: presetOption.value,
        label: t(presetOption.labelKey),
      }));
      if (!preset) options.push({ value: "custom", label: customLabel(values) });
      customSignature = preset ? null : canonical(values);
      control = helpers.buildSettingsSelect({
        value: preset ? preset.value : "custom",
        options,
        ariaLabel: t("quotaThresholds"),
        onChange: (next) => save(next),
      });
      host.appendChild(control.element);
      control.setDisabled(pending);
    }

    function syncFromSnapshot() {
      const values = readValues();
      const preset = matchPreset(values);
      const signature = preset ? null : canonical(values);
      if (!control || signature !== customSignature) buildControl(values);
      else control.setValue(preset ? preset.value : "custom");
      if (control) control.setDisabled(pending);
    }

    async function save(next) {
      if (pending) return false;
      // The custom option is only ever the already-committed value, so choosing
      // it changes nothing and writes nothing.
      if (next === "custom") return true;
      const preset = presets.find((entry) => entry.value === next);
      if (!preset) return false;
      pending = true;
      if (control) control.setDisabled(true);
      try {
        const result = await window.settingsAPI.update("quotaAlertThresholds", preset.thresholds);
        if (!result || result.status !== "ok") throw new Error((result && result.message) || "unknown error");
        const values = result.snapshot ? result.snapshot.quotaAlertThresholds : preset.thresholds;
        const changes = { quotaAlertThresholds: values };
        ops.applyChanges({ changes, ...(result.snapshot ? { snapshot: result.snapshot } : {}) });
        return true;
      } catch (err) {
        ops.showToast(t("toastSaveFailed") + (err && err.message), { error: true });
        return false;
      } finally {
        pending = false;
        // On success applyChanges has already synced the value through
        // syncFromSnapshot. On failure we deliberately leave the value alone so
        // the picker's own onChange(false) revert is what restores it.
        if (control) control.setDisabled(false);
      }
    }

    state.mountedControls.quotaAlertThresholds = { row, syncFromSnapshot };
    syncFromSnapshot();
    return row;
  }

  function buildQuotaNotificationTestRow() {
    const row = document.createElement("div");
    row.className = "row quota-notification-test-row";
    const text = document.createElement("div");
    text.className = "row-text";
    const label = document.createElement("span");
    label.className = "row-label";
    label.textContent = t("notificationTest");
    const desc = document.createElement("span");
    desc.className = "row-desc";
    const descKey = i18n && i18n.IS_MAC
      ? "notificationTestDescMac"
      : (i18n && i18n.IS_WIN ? "notificationTestDescWin" : "notificationTestDescLinux");
    desc.textContent = t(descKey);
    text.append(label, desc);
    const control = document.createElement("div");
    control.className = "row-control";
    const button = helpers.buildButton({ labelKey: "notificationTestSend", size: "compact" });
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      helpers.setButtonState(button, { pending: true });
      try {
        const result = await window.settingsAPI.testQuotaNotification();
        ops.showToast(t(result && result.ok === true ? "notificationTestSent" : "notificationTestFailed"),
          { error: !(result && result.ok === true) });
      } catch {
        ops.showToast(t("notificationTestFailed"), { error: true });
      } finally {
        helpers.setButtonState(button, { pending: false });
      }
    });
    control.appendChild(button);
    row.append(text, control);
    return row;
  }


  function buildOptionList(className, rows) {
    const list = document.createElement("div");
    list.className = `settings-option-list ${className || ""}`.trim();
    for (const row of rows) {
      row.classList.add("settings-option-item");
      list.appendChild(row);
    }
    return list;
  }

  // Returns the row array directly so the Session HUD section can lay them out
  // as ordinary rows; the name is kept for the original call site.
  function buildSessionHudOptionsList(sessionHudControlsEnabled) {
    return [
      helpers.buildSwitchRow({
        key: "sessionHudEnabled",
        labelKey: "rowSessionHudMaster",
      }),
      helpers.buildSwitchRow({
        key: "sessionHudShowStateLabels",
        labelKey: "rowSessionHudStateLabels",
        descKey: "rowSessionHudStateLabelsDesc",
        disabled: !sessionHudControlsEnabled,
      }),
      helpers.buildSwitchRow({
        key: "sessionHudShowElapsed",
        labelKey: "rowSessionHudElapsed",
        descKey: "rowSessionHudElapsedDesc",
        disabled: !sessionHudControlsEnabled,
      }),
      helpers.buildSwitchRow({
        key: "sessionHudShowContextUsage",
        labelKey: "rowSessionHudContextUsage",
        descKey: "rowSessionHudContextUsageDesc",
        disabled: !sessionHudControlsEnabled,
      }),
      helpers.buildSwitchRow({
        key: "sessionHudCleanupDetached",
        labelKey: "rowSessionHudCleanupDetached",
        descKey: "rowSessionHudCleanupDetachedDesc",
        disabled: !sessionHudControlsEnabled,
      }),
      helpers.buildSwitchRow({
        key: "sessionHudHideCompletedCodexEphemeral",
        labelKey: "rowSessionHudHideCompletedCodexEphemeral",
        descKey: "rowSessionHudHideCompletedCodexEphemeralDesc",
        disabled: !sessionHudControlsEnabled,
      }),
      helpers.buildSwitchRow({
        key: "sessionHudHideActiveCodexEphemeral",
        labelKey: "rowSessionHudHideActiveCodexEphemeral",
        descKey: "rowSessionHudHideActiveCodexEphemeralDesc",
        disabled: !sessionHudControlsEnabled,
      }),
    ];
  }

  function buildSessionCleanupGroup() {
    const optionList = buildOptionList("session-cleanup-option-list", [
      helpers.buildNumberInputRow({
        key: "sessionStaleMs",
        labelKey: "rowStaleSession",
        descKey: "rowStaleSessionDesc",
        unitKey: "unitMinutes",
        toDisplay: (ms) => Math.round(ms / 60_000),
        fromDisplay: (min) => Math.max(0, Math.round(min * 60_000)),
        min: 0,
        max: 1440,
        zeroLabelKey: "valueDisabled",
      }).row,
      helpers.buildNumberInputRow({
        key: "workingStaleMs",
        labelKey: "rowStaleWorking",
        descKey: "rowStaleWorkingDesc",
        unitKey: "unitSeconds",
        toDisplay: (ms) => Math.round(ms / 1000),
        fromDisplay: (sec) => Math.max(30_000, Math.min(86_400_000, Math.round(sec * 1000))),
        min: 30,
        max: 86_400,
      }).row,
      helpers.buildNumberInputRow({
        key: "codexWorkingStaleMs",
        labelKey: "rowCodexStaleWorking",
        descKey: "rowCodexStaleWorkingDesc",
        unitKey: "unitMinutes",
        toDisplay: (ms) => Math.round(ms / 60_000),
        fromDisplay: (min) => min === 0
          ? 0
          : Math.max(30_000, Math.min(86_400_000, Math.round(min * 60_000))),
        min: 0,
        max: 1440,
        zeroLabelKey: "valueDisabled",
      }).row,
      helpers.buildNumberInputRow({
        key: "detachedIdleStaleMs",
        labelKey: "rowStaleDetached",
        descKey: "rowStaleDetachedDesc",
        unitKey: "unitSeconds",
        toDisplay: (ms) => Math.round(ms / 1000),
        fromDisplay: (sec) => Math.max(5_000, Math.min(300_000, Math.round(sec * 1000))),
        min: 5,
        max: 300,
      }).row,
    ]);

    // Reset lives in its own row outside the option-list so it doesn't render
    // as a card; mirrors how Sound group puts the volume slider on its own row.
    const resetRow = document.createElement("div");
    resetRow.className = "row session-cleanup-reset-row";
    const resetButton = helpers.buildButton({
      labelKey: "actionResetSessionCleanup",
      size: "compact",
    });
    resetButton.addEventListener("click", async () => {
      helpers.setButtonState(resetButton, { pending: true });
      try {
        const result = await window.settingsAPI.command(
          "sessionCleanup.setTriple",
          { ...SESSION_CLEANUP_DEFAULTS }
        );
        if (!result || result.status !== "ok") {
          const msg = (result && result.message) || "unknown error";
          ops.showToast(t("toastSaveFailed") + msg, { error: true });
        }
      } catch (err) {
        ops.showToast(t("toastSaveFailed") + (err && err.message), { error: true });
      } finally {
        helpers.setButtonState(resetButton, { pending: false });
      }
    });
    resetRow.appendChild(resetButton);

    return helpers.buildCollapsibleGroup({
      id: "sessions:timeouts",
      title: t("rowSessionCleanupGroup"),
      desc: t("rowSessionCleanupGroupDesc"),
      defaultCollapsed: true,
      className: "session-cleanup-collapsible",
      children: [optionList, resetRow],
    });
  }


  function getMountedGeneralSwitch(key) {
    const meta = state.mountedControls.generalSwitches.get(key);
    if (!meta || !document.body.contains(meta.element)) return null;
    return meta;
  }

  function setGeneralSwitchDisabled(key, disabled) {
    const meta = getMountedGeneralSwitch(key);
    if (!meta) return false;
    meta.control.setState({ disabled: !!disabled });
    return true;
  }

  function syncSessionHudChildSwitchesDisabled() {
    const disabled = !(state.snapshot && state.snapshot.sessionHudEnabled);
    for (const key of SESSION_HUD_CHILD_SWITCH_KEYS) {
      if (!setGeneralSwitchDisabled(key, disabled)) return false;
    }
    return true;
  }

  function render(parent) {
    const h1 = document.createElement("h1");
    h1.textContent = t("sessionsTitle");
    parent.appendChild(h1);

    const subtitle = document.createElement("p");
    subtitle.className = "subtitle";
    subtitle.textContent = t("sessionsSubtitle");
    parent.appendChild(subtitle);

    parent.appendChild(helpers.buildSection("", [buildDashboardRow()]));

    const hudEnabled = !!(state.snapshot && state.snapshot.sessionHudEnabled);
    parent.appendChild(helpers.buildSection(t("sectionSessionHud"), [
      ...buildSessionHudOptionsList(hudEnabled),
    ]));

    parent.appendChild(helpers.buildSection(t("sectionQuotaAlerts"), buildQuotaControls()));

    parent.appendChild(helpers.buildSection(t("sectionAdvanced"), [
      buildSessionCleanupGroup(),
    ]));
  }

  function patchInPlace(changes) {
    const keys = changes ? Object.keys(changes) : [];
    if (keys.length === 0) return false;
    if (!keys.every((key) => SESSIONS_IN_PLACE_KEYS.has(key))) return false;
    if (keys.includes("sessionHudEnabled")
      && !SESSION_HUD_CHILD_SWITCH_KEYS.every((key) => getMountedGeneralSwitch(key))) {
      return false;
    }
    if (keys.includes("quotaAlertThresholds") || keys.includes("quotaAlertsEnabled")) {
      const control = state.mountedControls.quotaAlertThresholds;
      if (!control || !document.body.contains(control.row)) return false;
    }
    if (keys.some((key) => SESSION_CLEANUP_NUMBER_KEYS.has(key))) {
      for (const key of keys) {
        if (!SESSION_CLEANUP_NUMBER_KEYS.has(key)) continue;
        const meta = state.mountedControls.sessionCleanupControls.get(key);
        if (!meta || !document.body.contains(meta.row)) return false;
      }
    }
    for (const key of keys) {
      if (key === "quotaAlertThresholds") continue;
      if (SESSION_CLEANUP_NUMBER_KEYS.has(key)) continue;
      const meta = state.mountedControls.generalSwitches.get(key);
      if (!meta || !document.body.contains(meta.element)) return false;
    }
    for (const key of keys) {
      if (key === "quotaAlertThresholds") continue;
      if (SESSION_CLEANUP_NUMBER_KEYS.has(key)) {
        state.mountedControls.sessionCleanupControls.get(key).syncFromSnapshot();
        continue;
      }
      const meta = state.mountedControls.generalSwitches.get(key);
      state.transientUiState.generalSwitches.delete(key);
      meta.control.setState({
        checked: readers.readGeneralSwitchVisual(key, meta.invert),
        pending: false,
      });
    }
    if (keys.includes("sessionHudEnabled") && !syncSessionHudChildSwitchesDisabled()) return false;
    if (keys.includes("quotaAlertThresholds") || keys.includes("quotaAlertsEnabled")) {
      state.mountedControls.quotaAlertThresholds.syncFromSnapshot();
      if (typeof state.mountedControls.quotaAlertThresholds.syncVisibility === "function") {
        state.mountedControls.quotaAlertThresholds.syncVisibility();
      }
    }
    return true;
  }

  function init(core) {
    state = core.state;
    readers = core.readers;
    helpers = core.helpers;
    ops = core.ops;
    i18n = core.i18n;
    core.tabs.sessions = {
      render,
      patchInPlace,
    };
  }

  root.ClawdSettingsTabSessions = { init };
})(globalThis);
