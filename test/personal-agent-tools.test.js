"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { createAgentTools } = require("../src/personal-agent-tools");

describe("Phase B3: Agent session, quota, and delegation tools", () => {
  it("lists live and recent sessions, reads real 5-service quotas, and disambiguates ambiguous targets", async () => {
    const now = Date.parse("2026-11-27T12:00:00Z");
    const snapshot = {
      sessions: [
        {
          id: "codex-1",
          rawSessionId: "codex-1",
          agentId: "codex",
          agentName: "Codex",
          displayTitle: "Character OS backend",
          cwd: "/Users/cjy/projects/character-os",
          badge: "idle",
          lastEvent: "Stop",
          lastEventAt: now - 5000,
          canFocus: true,
        },
        {
          id: "codex-2",
          rawSessionId: "codex-2",
          agentId: "codex",
          agentName: "Codex",
          displayTitle: "AlphaZero experiments",
          cwd: "/Users/cjy/projects/AlphaZero",
          badge: "running",
          lastEvent: "PostToolUse",
          lastEventAt: now - 1000,
          canFocus: true,
        },
        {
          id: "agy-1",
          rawSessionId: "agy-1",
          agentId: "antigravity-cli",
          agentName: "Antigravity",
          displayTitle: "Character OS UI",
          cwd: "/Users/cjy/projects/character-os",
          badge: "done",
          lastEvent: "Stop",
          lastEventAt: now - 2000,
          canFocus: false,
        },
      ],
      accountQuota: [
        {
          sourceKey: "",
          host: null,
          codexQuota: {
            updatedAt: now - 60000,
            lastSeenAt: now - 60000,
            group: {
              codexFiveHour: { usedPercent: 25, windowMinutes: 300, resetAt: now + 3600000, lastSeenAt: now - 60000 },
              codexWeekly: { usedPercent: 40, windowMinutes: 10080, resetAt: now + 86400000, lastSeenAt: now - 60000 },
            },
          },
        },
        {
          sourceKey: "antigravity-cli-usage",
          host: "Antigravity CLI",
          antigravityCliQuota: {
            updatedAt: now - 60000,
            lastSeenAt: now - 60000,
            group: {
              group1_0: { groupLabel: "Claude / GPT", bucketLabel: "5h", usedPercent: 100, windowMinutes: 300, disabled: true, lastSeenAt: now - 60000 },
              group1_1: { groupLabel: "Claude / GPT", bucketLabel: "Weekly", usedPercent: 60, windowMinutes: 10080, resetAt: now + 86400000, disabled: false, lastSeenAt: now - 60000 },
            },
          },
        },
      ],
    };

    const tools = createAgentTools({
      getSessionSnapshot: () => snapshot,
      getPendingPermissions: () => [],
      listResumableSessions: async () => ({ sessions: [] }),
      platform: "darwin",
      isAccessibilityTrusted: () => true,
      now: () => now,
    });

    const listRes = await tools.list_agent_sessions.execute({ agent: "codex" });
    assert.equal(listRes.liveCount, 2);

    const quotaRes = await tools.get_quota.execute({ service: "all" });
    assert.equal(quotaRes.services.length, 4);
    assert.equal(quotaRes.services.find((s) => s.id === "codex").shortWindow.remainingPercent, 75);
    assert.equal(quotaRes.services.find((s) => s.id === "antigravity-claude-gpt").shortWindow.status, "disabled");
    assert.equal(quotaRes.services.some((s) => s.id === "chatgpt-chat"), false);

    // Ambiguous target (two Codex sessions) asks for disambiguation instead of guessing!
    const ambig = await tools.send_agent_message.prepareConfirmation({
      client: "codex",
      message: "Continue working",
    });
    assert.equal(ambig.needsDisambiguation, true);
    assert.equal(ambig.candidates.length, 2);

    // Narrowing by project produces a clear confirmation payload
    const clear = await tools.send_agent_message.prepareConfirmation({
      client: "codex",
      project: "character-os",
      message: "Continue working",
    });
    assert.ok(clear.confirm);
    assert.equal(clear.confirm.sessionId, "codex-1");
    assert.equal(clear.confirm.project, "character-os");
  });

  it("separates delivery status (sent) from observed execution states (started -> completed)", async () => {
    let clock = Date.parse("2026-11-27T12:00:00Z");
    const session = {
      id: "codex-1",
      rawSessionId: "codex-1",
      agentId: "codex",
      agentName: "Codex",
      displayTitle: "Character OS",
      cwd: "/Users/cjy/projects/character-os",
      badge: "idle",
      lastEvent: "Stop",
      lastEventAt: clock - 10_000,
      canFocus: true,
    };

    const tools = createAgentTools({
      getSessionSnapshot: () => ({ sessions: [session], accountQuota: [] }),
      getPendingPermissions: () => [],
      platform: "darwin",
      isAccessibilityTrusted: () => true,
      deliverViaAccessibilityFn: async () => ({ deliveryStatus: "sent", detail: "ok" }),
      now: () => clock,
    });

    const sent = await tools.send_agent_message.execute({
      client: "codex",
      session_id: "codex-1",
      message: "Run tests",
    });
    assert.equal(sent.status, "ok");
    assert.equal(sent.deliveryStatus, "sent");
    // Sending MUST NOT lie that the task has already started or completed!
    assert.equal(sent.executionStatus, "pending_observation");

    // Real hook observes task started
    clock += 3000;
    session.badge = "running";
    session.lastEvent = "PreToolUse";
    session.lastEventAt = clock;
    const mid = await tools.get_agent_status.execute({ session_id: "codex-1" });
    assert.equal(mid.sessions[0].lastDelegation.executionStatus, "started");

    // Real hook observes task completed
    clock += 10000;
    session.badge = "done";
    session.lastEvent = "Stop";
    session.lastEventAt = clock;
    const fin = await tools.get_agent_status.execute({ session_id: "codex-1" });
    assert.equal(fin.sessions[0].lastDelegation.executionStatus, "completed");
  });

  it("reports missing Accessibility permission honestly without faking delivery", async () => {
    const tools = createAgentTools({
      getSessionSnapshot: () => ({ sessions: [], accountQuota: [] }),
      platform: "darwin",
      isAccessibilityTrusted: () => false,
      execFileFn: async () => ({ stdout: "" }),
    });
    const res = await tools.send_agent_message.execute({
      client: "antigravity",
      message: "Optimize frontend",
    });
    assert.equal(res.status, "error");
    assert.equal(res.deliveryStatus, "needs_accessibility");
    assert.equal(res.executionStatus, "not_started");
  });
});
