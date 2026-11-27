# UI handoff — feature/visual-redesign

Done: shared tokens (`src/ui-tokens.css`, `ui-platform.js`, `ui-bubble-theme.css`), pet halo, command window (frameless, vibrancy on macOS, Esc/blur hide), workspace (`dashboard.html/css` + renderer layout), settings (`settings.css`), language picker, bubble/HUD/update/confirmation theming via token mapping.
Remaining (optional polish): quota-ring.html still uses legacy coin palette; bubble.css card radius/typography only token-mapped; ja/ko strings in command window fall back to English.
Verify: `node --test test/pet-halo.test.js test/character-chat.test.js test/dashboard.test.js test/settings-window.test.js` (1 known pre-existing Kimi failure in dashboard.test.js).
