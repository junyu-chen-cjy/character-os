"use strict";
// Tags <html> with the host platform so the shared stylesheet can adapt
// window chrome (inset title bars, native materials) without per-window code.
(() => {
  const p = String(navigator.platform || "");
  document.documentElement.dataset.platform = /^Mac/.test(p) ? "mac" : /^Win/.test(p) ? "win" : "other";
})();
