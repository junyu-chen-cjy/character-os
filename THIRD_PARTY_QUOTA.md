# Quota collection sources

The CLI invocation and group mapping in `src/antigravity-cli-quota.js` adapt
Mimir's `Sources/Mimir/AntigravityProvider.swift` at
8f74e8163186e1f78936e20d1fca72edb44265db.
https://github.com/erayendes/mimir

MIT License

Copyright (c) 2026 Eray Endes

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Other acquisition implementations inspected, with no code copied:

- pinkpixel-dev/quota (Apache-2.0), `quota-core/src/antigravity/local_usage.rs`.
  Reads OAuth credentials and refreshes them. Excluded for this task.
- chuongtrh/ai-quota (MIT), `internal/provider/antigravity/languageserver.go`.
  Extracts a local process CSRF token for LanguageServer RPC. Excluded.
- steipete/CodexBar (MIT), AntigravityStatusProbe local endpoints and
  AntigravityScopedPrintFetch. Local CSRF and scoped OAuth implementations
  require credentials. The direct official CLI command needs neither.
- lobner/gemini-usage (MIT), `extension/background.js` and `gemini.js`.
  Discovers private persisted GraphQL queries. Excluded.
- Mohammad-Aali/Unofficial-Gemini-Usage-Tracker (MIT), `content.js`,
  `background.js`, `offscreen.js`. Its hidden iframe removes CSP/X-Frame-Options.
  Excluded. The Character OS extension uses an inactive normal tab instead.

## One-time Chrome installation

Load `extensions/gemini-quota` unpacked in chrome://extensions. The extension
reads only the official `/usage` document, using the browser's existing login.
Every ten minutes an inactive tab loads, reports only the quota list and source
update time to Character OS's loopback server, and closes. If the user selects
or navigates that tab, it is left open. No cookie access, private API, framing
policy changes or model requests. The stable public manifest key pins the local
receiver to this extension ID. Login/Google access errors preserve prior data.
