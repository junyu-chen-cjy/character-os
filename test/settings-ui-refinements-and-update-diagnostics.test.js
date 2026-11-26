const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const settingsCss = fs.readFileSync(path.join(__dirname, "..", "src", "settings.css"), "utf8");
const settingsTabAgents = fs.readFileSync(path.join(__dirname, "..", "src", "settings-tab-agents.js"), "utf8");
const settingsTabPermissions = fs.readFileSync(path.join(__dirname, "..", "src", "settings-tab-permissions.js"), "utf8");
const settingsI18n = fs.readFileSync(path.join(__dirname, "..", "src", "settings-i18n.js"), "utf8");

describe("Settings UI refinements and update diagnostics (5-point refinement plan)", () => {
  it("Codex approval settings: removes the retired mode slider CSS", () => {
    assert.doesNotMatch(settingsCss, /codex-permission-mode-segmented|--codex-permission-mode-active-index/);
  });

  it("Point 2: uses vertical column layout for CodeBuddy custom permission URL row to prevent text squeezing", () => {
    assert.match(
      settingsCss,
      /\.agent-text-input-row \{[\s\S]*flex-direction:\s*column;[\s\S]*align-items:\s*stretch;[\s\S]*gap:\s*10px;/
    );
    assert.match(
      settingsCss,
      /\.agent-text-input-row \.row-text \{[\s\S]*width:\s*100%;[\s\S]*flex:\s*1 1 auto;[\s\S]*\}/
    );
    assert.match(
      settingsCss,
      /\.agent-text-input-control \{[\s\S]*width:\s*100%;[\s\S]*flex:\s*1 1 auto;[\s\S]*min-width:\s*0;[\s\S]*\}/
    );
  });

  it("Point 3: uses in-app showSettingsConfirmModal for agent integration uninstall with full i18n support", () => {
    assert.match(settingsTabAgents, /showSettingsConfirmModal\(\{/);
    assert.match(settingsTabAgents, /title:\s*t\("agentIntegrationUninstallConfirmTitle"\)/);
    assert.match(settingsTabAgents, /detail:\s*t\("agentIntegrationUninstallConfirm"\)/);
    assert.match(settingsTabAgents, /label:\s*t\("agentIntegrationUninstallCancel"\)/);

    const locales = ["en", "zh", "zh-TW", "ko", "ja", "pt-BR", "es"];
    for (const locale of locales) {
      assert.match(settingsI18n, new RegExp(`agentIntegrationUninstallConfirmTitle: "[^"]+"`));
      assert.match(settingsI18n, new RegExp(`agentIntegrationUninstallCancel: "[^"]+"`));
    }
  });

  it("Point 4: styles 'Codex 设置' button in Permissions tab using helpers.buildButton", () => {
    assert.doesNotMatch(
      settingsTabPermissions,
      /button\.className = "btn"/,
      "must not use unstyled raw button.className = 'btn'"
    );
    assert.match(
      settingsTabPermissions,
      /helpers\.buildButton\(\{[\s\S]*size:\s*"compact"[\s\S]*label:\s*t\("codexApprovalSettingsLink"\)[\s\S]*className:\s*"codex-approval-settings-btn"/
    );
  });
});
