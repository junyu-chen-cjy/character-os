"use strict";

// Keep legacy descriptors and hook scripts readable without activating them.
const activeAgents = new Set(["codex", "antigravity-cli"]);

function isProductAgent(agentId) {
  return activeAgents.has(agentId);
}

module.exports = { isProductAgent };
