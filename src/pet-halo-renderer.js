"use strict";

(() => {
  const STRINGS = {
    en: {
      command: "Command",
      workspace: "Workspace",
      noData: "No data",
      remaining: "{pct}%",
      resetH: "{h}h",
      resetHM: "{h}h {m}m",
      resetM: "{m}m",
    },
    zh: {
      command: "指令",
      workspace: "工作台",
      noData: "暂无数据",
      remaining: "剩余 {pct}%",
      resetH: "{h}小时",
      resetHM: "{h}小时{m}分",
      resetM: "{m}分",
    },
    "zh-TW": {
      command: "指令",
      workspace: "工作台",
      noData: "暫無資料",
      remaining: "剩餘 {pct}%",
      resetH: "{h}小時",
      resetHM: "{h}小時{m}分",
      resetM: "{m}分",
    },
    ja: {
      command: "コマンド",
      workspace: "ワーク台",
      noData: "データなし",
      remaining: "残り {pct}%",
      resetH: "{h}時間",
      resetHM: "{h}時間{m}分",
      resetM: "{m}分",
    },
    ko: {
      command: "명령",
      workspace: "워크스페이스",
      noData: "데이터 없음",
      remaining: "{pct}%",
      resetH: "{h}시간",
      resetHM: "{h}시간 {m}분",
      resetM: "{m}분",
    },
  };

  const WARN_USED = 60;
  const HOT_USED = 85;

  const shellEl = document.getElementById("haloShell");
  const quotaPanelEl = document.getElementById("quotaPanel");
  const btnCommand = document.getElementById("btnCommand");
  const btnCodex = document.getElementById("btnCodex");
  const btnAntigravity = document.getElementById("btnAntigravity");
  const btnWorkspace = document.getElementById("btnWorkspace");
  const lblCommand = document.getElementById("lblCommand");
  const lblWorkspace = document.getElementById("lblWorkspace");
  const workspaceBadgeEl = document.getElementById("workspaceBadge");
  const icoCodex = document.getElementById("icoCodex");
  const svgCodex = document.getElementById("svgCodex");
  const icoAntigravity = document.getElementById("icoAntigravity");
  const svgAntigravity = document.getElementById("svgAntigravity");

  let state = {
    lang: "en",
    flippedAbove: false,
    runningCount: 0,
    pendingApprovalCount: 0,
    accountQuota: [],
    quotaAgentIcons: {},
  };
  let lastReportedHeight = 0;

  function t(key) {
    const dict = STRINGS[state.lang] || STRINGS.en;
    return dict[key] || STRINGS.en[key] || key;
  }

  function formatReset(resetAt, windowMinutes) {
    const target = Number(resetAt);
    if (!Number.isFinite(target)) return "";
    const diffMs = target - Date.now();
    if (diffMs <= 0) return "";
    const totalMin = Math.max(1, Math.round(diffMs / 60000));
    if (Number.isFinite(windowMinutes) && windowMinutes >= 1440 && totalMin > 24 * 60) {
      try {
        return new Intl.DateTimeFormat(state.lang || "en", { month: "short", day: "numeric" }).format(target);
      } catch {
        // fallback below
      }
    }
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h > 0 && m > 0) return t("resetHM").replace("{h}", h).replace("{m}", m);
    if (h > 0) return t("resetH").replace("{h}", h);
    return t("resetM").replace("{m}", m);
  }

  function normalizeBucket(group, field, fallbackWin, now) {
    const raw = group && group[field];
    if (!raw || typeof raw !== "object") return null;
    const expired = raw.expired === true || (Number.isFinite(raw.resetAt) && raw.resetAt <= now);
    const used = expired ? 0 : Math.max(0, Math.min(100, Number(raw.usedPercent) || 0));
    const remaining = Math.max(0, Math.min(100, Math.round(100 - used)));
    return {
      used,
      remaining,
      windowLabel: fallbackWin,
      resetLabel: expired ? "" : formatReset(raw.resetAt, raw.windowMinutes),
    };
  }

  function pickMostPressured(candidates) {
    const valid = candidates.filter(Boolean);
    if (!valid.length) return null;
    return valid.reduce((best, cur) => (cur.used > best.used ? cur : best), valid[0]);
  }

  function resolvePrimaryQuotas(now) {
    const sources = Array.isArray(state.accountQuota) ? state.accountQuota : [];
    const icons = state.quotaAgentIcons || {};

    let codexBest = null;
    let agyBest = null;

    for (const src of sources) {
      if (!src || typeof src !== "object") continue;
      if (src.codexQuota && src.codexQuota.group) {
        const g = src.codexQuota.group;
        const shortB = normalizeBucket(g, "codexFiveHour", "5h", now);
        const longB = normalizeBucket(g, "codexWeekly", "7d", now);
        const chosen = (longB && longB.used >= WARN_USED && (!shortB || longB.used > shortB.used))
          ? longB
          : (shortB || longB);
        if (chosen && (!codexBest || chosen.used > codexBest.used)) codexBest = chosen;
      }
      if (src.antigravityQuota && src.antigravityQuota.group) {
        const g = src.antigravityQuota.group;
        const chosen = pickMostPressured([
          normalizeBucket(g, "geminiFiveHour", "5h", now),
          normalizeBucket(g, "geminiWeekly", "7d", now),
          normalizeBucket(g, "thirdPartyFiveHour", "5h", now),
          normalizeBucket(g, "thirdPartyWeekly", "7d", now),
        ]);
        if (chosen && (!agyBest || chosen.used > agyBest.used)) agyBest = chosen;
      }
    }

    return [
      { id: "codex", name: "Codex", tone: "codex", iconUrl: icons.codexQuota || "", bucket: codexBest },
      { id: "antigravity", name: "Antigravity", tone: "antigravity", iconUrl: icons.antigravityQuota || "", bucket: agyBest },
    ];
  }

  function severityForUsed(used) {
    if (used > HOT_USED) return "sev-hot";
    if (used >= WARN_USED) return "sev-warn";
    return "";
  }

  function reportHeightSoon() {
    requestAnimationFrame(() => {
      const rect = shellEl.getBoundingClientRect();
      const totalHeight = Math.ceil(rect.height + 14);
      if (totalHeight > 20 && Math.abs(totalHeight - lastReportedHeight) >= 2) {
        lastReportedHeight = totalHeight;
        window.petHaloAPI.reportLayout({ height: totalHeight });
      }
    });
  }

  function syncDockIcons() {
    const icons = state.quotaAgentIcons || {};
    if (icons.codexQuota) {
      icoCodex.src = icons.codexQuota;
      icoCodex.hidden = false;
      icoCodex.style.display = "";
      svgCodex.style.display = "none";
    } else {
      icoCodex.hidden = true;
      icoCodex.style.display = "none";
      svgCodex.style.display = "";
    }
    if (icons.antigravityQuota) {
      icoAntigravity.src = icons.antigravityQuota;
      icoAntigravity.hidden = false;
      icoAntigravity.style.display = "";
      svgAntigravity.style.display = "none";
    } else {
      icoAntigravity.hidden = true;
      icoAntigravity.style.display = "none";
      svgAntigravity.style.display = "";
    }
  }

  icoCodex.addEventListener("error", () => {
    icoCodex.hidden = true;
    icoCodex.style.display = "none";
    svgCodex.style.display = "";
  });
  icoAntigravity.addEventListener("error", () => {
    icoAntigravity.hidden = true;
    icoAntigravity.style.display = "none";
    svgAntigravity.style.display = "";
  });

  function renderQuotaSection() {
    const items = resolvePrimaryQuotas(Date.now());
    quotaPanelEl.replaceChildren();

    for (const item of items) {
      const row = document.createElement("div");
      row.className = "quota-row";

      const top = document.createElement("div");
      top.className = "quota-row-top";

      const svc = document.createElement("div");
      svc.className = "quota-service";
      if (item.iconUrl) {
        const img = document.createElement("img");
        img.className = "quota-icon";
        img.src = item.iconUrl;
        img.alt = "";
        img.addEventListener("error", () => img.remove(), { once: true });
        svc.appendChild(img);
      }
      const name = document.createElement("span");
      name.className = "quota-name";
      name.textContent = item.name;
      svc.appendChild(name);

      const readout = document.createElement("div");
      readout.className = "quota-readout";

      if (item.bucket) {
        const sev = severityForUsed(item.bucket.used);
        const pct = document.createElement("span");
        pct.className = `quota-pct${sev ? ` ${sev}` : ""}`;
        pct.textContent = t("remaining").replace("{pct}", item.bucket.remaining);
        readout.appendChild(pct);

        if (item.bucket.resetLabel) {
          const meta = document.createElement("span");
          meta.className = "quota-meta";
          meta.textContent = `· ${item.bucket.resetLabel}`;
          readout.appendChild(meta);
        }

        top.append(svc, readout);
        row.appendChild(top);

        const bar = document.createElement("div");
        bar.className = "quota-bar";
        const fill = document.createElement("div");
        fill.className = `quota-bar-fill pv-${item.tone}${sev ? ` ${sev}` : ""}`;
        fill.style.width = `${item.bucket.remaining}%`;
        bar.appendChild(fill);
        row.appendChild(bar);
      } else {
        const none = document.createElement("span");
        none.className = "quota-none";
        none.textContent = t("noData");
        readout.appendChild(none);
        top.append(svc, readout);
        row.appendChild(top);
      }

      quotaPanelEl.appendChild(row);
    }
  }

  function renderDock() {
    lblCommand.textContent = t("command");
    lblWorkspace.textContent = t("workspace");
    syncDockIcons();

    if (state.pendingApprovalCount > 0) {
      workspaceBadgeEl.hidden = false;
      workspaceBadgeEl.classList.add("has-approval");
    } else if (state.runningCount > 0) {
      workspaceBadgeEl.hidden = false;
      workspaceBadgeEl.classList.remove("has-approval");
    } else {
      workspaceBadgeEl.hidden = true;
    }
  }

  function render() {
    document.documentElement.lang = state.lang || "en";
    shellEl.classList.toggle("flipped-above", !!state.flippedAbove);
    renderQuotaSection();
    renderDock();
    reportHeightSoon();
  }

  document.addEventListener("pointerenter", () => window.petHaloAPI.setHovering(true));
  document.addEventListener("pointerleave", () => window.petHaloAPI.setHovering(false));

  quotaPanelEl.addEventListener("click", () => {
    window.petHaloAPI.openWorkspace("quotas");
  });
  btnCommand.addEventListener("click", () => {
    window.petHaloAPI.openCommand();
  });
  btnCodex.addEventListener("click", () => {
    window.petHaloAPI.launchClient("codex");
  });
  btnAntigravity.addEventListener("click", () => {
    window.petHaloAPI.launchClient("antigravity");
  });
  btnWorkspace.addEventListener("click", () => {
    window.petHaloAPI.openWorkspace("overview");
  });

  window.petHaloAPI.onState((next) => {
    if (!next || typeof next !== "object") return;
    state = { ...state, ...next };
    render();
  });

  window.petHaloAPI.onVisibility((payload) => {
    const visible = !!(payload && payload.visible);
    if (payload && typeof payload.flippedAbove === "boolean") {
      shellEl.classList.toggle("flipped-above", payload.flippedAbove);
    }
    requestAnimationFrame(() => {
      shellEl.classList.toggle("is-visible", visible);
      if (visible) reportHeightSoon();
    });
  });

  window.petHaloAPI.getState().then((initial) => {
    if (initial && typeof initial === "object") {
      state = { ...state, ...initial };
    }
    render();
  }).catch(() => render());

  setInterval(() => {
    if (shellEl.classList.contains("is-visible")) renderQuotaSection();
  }, 15000);
})();
