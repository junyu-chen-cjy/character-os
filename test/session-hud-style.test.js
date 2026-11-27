const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const sessionHudHtml = fs.readFileSync(path.join(__dirname, "..", "src", "session-hud.html"), "utf8");
const sessionHudRenderer = fs.readFileSync(path.join(__dirname, "..", "src", "session-hud-renderer.js"), "utf8");

describe("session HUD is sessions-only", () => {
  it("no longer renders an account-quota strip inside the HUD", () => {
    assert.doesNotMatch(sessionHudRenderer, /buildQuotaStrip/);
    assert.doesNotMatch(sessionHudRenderer, /createQuotaMeter/);
    assert.doesNotMatch(sessionHudHtml, /\.quota-strip/);
    assert.doesNotMatch(sessionHudHtml, /\.quota-window-fill/);
  });
});

describe("session HUD visual shell", () => {
  it("adds asymmetric body padding so the shadow has more room below than above", () => {
    assert.match(sessionHudHtml, /body\s*\{[\s\S]*padding:\s*2px 3px 8px;[\s\S]*\}/);
    assert.match(sessionHudHtml, /\.hud\s*\{[\s\S]*width:\s*100%;[\s\S]*height:\s*100%;[\s\S]*\}/);
    assert.doesNotMatch(sessionHudHtml, /\.hud\s*\{[\s\S]*width:\s*240px;[\s\S]*\}/);
  });

  it("keeps the rounded card while switching to a bottom-biased shadow", () => {
    assert.match(sessionHudHtml, /\.hud\s*\{[\s\S]*border-radius:\s*8px;[\s\S]*\}/);
    assert.match(sessionHudHtml, /\.hud\s*\{[\s\S]*box-shadow:\s*0 8px 18px -12px var\(--shadow\),\s*0 2px 4px rgba\(0,\s*0,\s*0,\s*0\.10\);[\s\S]*\}/);
    assert.doesNotMatch(sessionHudHtml, /\.hud\s*\{[\s\S]*box-shadow:\s*0 4px 14px var\(--shadow\);[\s\S]*\}/);
    assert.match(sessionHudHtml, /\.hud\s*\{[\s\S]*background:\s*var\(--hud-bg\);[\s\S]*\}/);
  });

  it("reserves row-level space for the auto-hide pin button", () => {
    assert.match(sessionHudHtml, /\.hud\.has-pin\s+\.row\s*\{[\s\S]*padding-right:\s*28px;[\s\S]*\}/);
    assert.doesNotMatch(sessionHudHtml, /\.hud\.has-pin\s+\.row\s+\.right\s*\{[\s\S]*padding-right:/);
  });

  it("marks non-focusable HUD sessions without attempting terminal focus", () => {
    assert.match(sessionHudHtml, /\.row-unfocusable\s*\{[\s\S]*cursor:\s*default;[\s\S]*\}/);
    assert.match(sessionHudHtml, /\.focus-unavailable\s*\{[\s\S]*width:\s*13px;[\s\S]*\}/);
    assert.match(sessionHudRenderer, /session\.canFocus\s*===\s*true/);
    assert.match(sessionHudRenderer, /row\.classList\.add\("row-unfocusable"\)/);
    assert.match(sessionHudRenderer, /window\.sessionHudAPI\.focusSession\(session\.id\);/);
  });

  it("renders transient feedback inline instead of covering fixed-height rows", () => {
    assert.match(sessionHudHtml, /\.session-inline-feedback\s*\{/);
    assert.doesNotMatch(sessionHudHtml, /\.session-action-feedback\s*\{/);
    assert.match(sessionHudRenderer, /SESSION_ACTION_FEEDBACK_MS\s*=\s*4000/);
    assert.match(sessionHudRenderer, /title\.className = feedbackText \? "title session-inline-feedback"/);
  });

  it("renders state labels without replacing unread completed-session bells", () => {
    assert.match(sessionHudHtml, /\.state-chip\s*\{/);
    assert.match(sessionHudHtml, /\.chip-working\s*\{/);
    assert.match(sessionHudHtml, /\.chip-worktree\s*\{/);
    assert.match(sessionHudHtml, /\.completion-bell\s*\{/);
    assert.match(sessionHudRenderer, /const STATE_CHIP_MAP\s*=/);
    assert.match(sessionHudRenderer, /const EVENT_CHIP_MAP\s*=/);
    assert.match(sessionHudRenderer, /PermissionRequest:\s*\{ key: "sessionNotification"/);
    assert.match(sessionHudRenderer, /PreCompact:\s*\{ key: "sessionSweeping"/);
    assert.match(sessionHudRenderer, /WorktreeCreate:\s*\{ key: "sessionWorktree"/);
    assert.match(sessionHudRenderer, /session\.badge === "done" && unreadSessions\.has\(session\.id\)/);
    assert.match(sessionHudRenderer, /bell\.className = "completion-bell unread-bell"/);
    assert.match(sessionHudRenderer, /RECENT_DONE_UNREAD_MS\s*=\s*60 \* 1000/);
    assert.match(sessionHudRenderer, /prev === undefined[\s\S]{0,180}unreadSessions\.add\(session\.id\)/);
    assert.doesNotMatch(sessionHudRenderer, /sessionBadgeDone[\s\S]{0,80}chip-done/);
    assert.doesNotMatch(sessionHudRenderer, /sessionCarrying/);
  });

  it("marks startup-restored live sessions without using a completion chip", () => {
    assert.match(sessionHudHtml, /\.chip-recovered\s*\{/);
    assert.match(sessionHudRenderer, /session\.startupRecovered/);
    assert.match(sessionHudRenderer, /t\("sessionRecovered"\)/);
    assert.doesNotMatch(sessionHudRenderer, /startupRecovered[\s\S]{0,120}sessionBadgeDone/);
  });

  it("uses a compact HUD-only title without mutating the full session title", () => {
    assert.match(sessionHudRenderer, /HUD_TITLE_MAX_UNITS\s*=\s*15/);
    assert.match(sessionHudRenderer, /function shortenHudTitle\(value\)/);
    assert.match(sessionHudRenderer, /title\.textContent = feedbackText \|\| shortTitle/);
    assert.match(sessionHudRenderer, /title\.title = fullTitle/);
  });

  it("keeps session titles visible at 130%-160% HUD scaling by overlaying plan progress", () => {
    // Existing max 58% right-column budget and title flex allocation must
    // remain identical whether a plan exists or not. A second flex chip
    // previously reduced the title all the way to zero at 160% scaling.
    const rightRule = sessionHudHtml.match(/\.right\s*\{[^}]+\}/);
    assert.ok(rightRule);
    assert.match(rightRule[0], /max-width:\s*58%/);
    const titleRule = sessionHudHtml.match(/\.title\s*\{[^}]+\}/);
    assert.match(titleRule[0], /flex:\s*1 1 auto/);
    const track = sessionHudHtml.match(/\.plan-progress-track\s*\{[^}]+\}/);
    assert.ok(track, "the plan must use its own overlay track");
    assert.match(track[0], /position:\s*absolute/);
    assert.match(track[0], /pointer-events:\s*none/);
    assert.match(sessionHudHtml, /\.row\s*\{\s*position:\s*relative/);
    const planBranch = sessionHudRenderer.match(/if \(!feedbackText && session\.planProgress\)\s*\{[\s\S]*?row\.title =/);
    assert.ok(planBranch);
    assert.match(planBranch[0], /row\.appendChild\(track\)/);
    assert.doesNotMatch(planBranch[0], /right\.appendChild\(/);
    // No track width participates in Flexbox, so its addition cannot change
    // the title's allocated space at 100%, 130% or 160% zoom.
    assert.doesNotMatch(track[0], /flex:|min-width:|max-width:/);
  });

  it("updates elapsed labels without rebuilding animated rows every second", () => {
    assert.match(sessionHudRenderer, /function updateElapsedLabels\(\)/);
    assert.match(sessionHudRenderer, /elapsed\.className = "elapsed"/);
    assert.match(sessionHudRenderer, /setInterval\(updateElapsedLabels, 1000\)/);
    assert.doesNotMatch(sessionHudRenderer, /setInterval\(render, 1000\)/);
  });

  it("keeps context usage chips visible before truncating elapsed text", () => {
    // Flexbox quirk regression guard: overflow:hidden gives a flex item an
    // AUTOMATIC minimum size of 0, so without an explicit min-content floor
    // .right shrinks below its chips under squeeze and its own overflow
    // clipping cuts them mid-glyph. The elapsed span keeps min-width: 0 so it
    // contributes nothing to that floor and truncates first.
    assert.match(sessionHudHtml, /\.right\s*\{[\s\S]*?flex:\s*0 1 auto;[\s\S]*?max-width:\s*58%;[\s\S]*?min-width:\s*min-content;[\s\S]*?overflow:\s*hidden;[\s\S]*?\}/);
    const rightBlock = sessionHudHtml.match(/\.right\s*\{[\s\S]*?\}/);
    assert.ok(rightBlock, "session-hud.html should define a .right rule");
    assert.doesNotMatch(rightBlock[0], /min-width:\s*0\b/, ".right must not zero its width floor");
    assert.match(sessionHudHtml, /\.elapsed\s*\{[\s\S]*min-width:\s*0;[\s\S]*text-overflow:\s*ellipsis;[\s\S]*\}/);
    assert.match(sessionHudHtml, /\.usage-chip\s*\{[\s\S]*flex:\s*0 0 auto;[\s\S]*white-space:\s*nowrap;[\s\S]*\}/);
  });

  it("honors reduced motion for HUD animations", () => {
    assert.match(sessionHudHtml, /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*\.dot-running\s*\{[\s\S]*animation:\s*none;/);
    assert.match(sessionHudHtml, /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*\.unread-bell svg\s*\{[\s\S]*animation:\s*none;/);
  });
});

// The exporter gives a plain mark 56 of its 64px canvas but a contrast-tile
// mark only 40 (the rest is the light plate that keeps a black-on-transparent
// logo alive on dark HUD/Dashboard surfaces). A coin crops its glyph to a
// circle, so one shared zoom makes tiled marks render visibly smaller and
// framed. This pins the per-provider zoom against the exporter's own manifest,
// so adding a ring provider cannot silently inherit the wrong one.
describe("Kimi quota freshness policy mirrors across browser renderers", () => {
  const dashboardRenderer = fs.readFileSync(
    path.join(__dirname, "..", "src", "dashboard-renderer.js"), "utf8"
  );

  it("keeps Kimi at seven minutes and every other provider at five", () => {
    for (const source of [dashboardRenderer]) {
      assert.match(source, /DEFAULT_QUOTA_STALE_AFTER_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/);
      assert.match(source, /PROVIDER_STALE_AFTER_MS\s*=\s*Object\.freeze\(\{[\s\S]*?kimiQuota:\s*7\s*\*\s*60\s*\*\s*1000/);
    }
  });
});
