"use strict";

(() => {
  const STRINGS = {
    en: {
      workspace: "Workspace",
      unknown: "Unknown",
      noData: "No data",
      disabled: "N/A",
      stale: "Stale",
      svcCodex: "Codex",
      svcAgGemini: "AG · Gemini",
      svcAgThird: "AG · Claude/GPT",
      svcGeminiChat: "Gemini Chat",
      svcChatgpt: "ChatGPT",
      resetsIn: "resets in {t}",
      resetsOn: "resets {d}",
      dH: "{h}h",
      dHM: "{h}h {m}m",
      dM: "{m}m",
      updated: "Updated {t}",
      justNow: "just now",
      mAgo: "{n}m ago",
      hAgo: "{n}h ago",
    },
    zh: {
      workspace: "工作台",
      unknown: "未知",
      noData: "暂无数据",
      disabled: "停用",
      stale: "已过期",
      svcCodex: "Codex",
      svcAgGemini: "AG · Gemini",
      svcAgThird: "AG · Claude/GPT",
      svcGeminiChat: "Gemini 聊天",
      svcChatgpt: "ChatGPT",
      resetsIn: "{t}后重置",
      resetsOn: "{d}重置",
      dH: "{h}小时",
      dHM: "{h}小时{m}分",
      dM: "{m}分",
      updated: "更新于 {t}",
      justNow: "刚刚",
      mAgo: "{n}分钟前",
      hAgo: "{n}小时前",
    },
    "zh-TW": {
      workspace: "工作台",
      unknown: "未知",
      noData: "暫無資料",
      disabled: "停用",
      stale: "已過期",
      svcCodex: "Codex",
      svcAgGemini: "AG · Gemini",
      svcAgThird: "AG · Claude/GPT",
      svcGeminiChat: "Gemini 聊天",
      svcChatgpt: "ChatGPT",
      resetsIn: "{t}後重置",
      resetsOn: "{d}重置",
      dH: "{h}小時",
      dHM: "{h}小時{m}分",
      dM: "{m}分",
      updated: "更新於 {t}",
      justNow: "剛剛",
      mAgo: "{n}分鐘前",
      hAgo: "{n}小時前",
    },
    ja: {
      workspace: "ワークスペース",
      unknown: "不明",
      noData: "データなし",
      disabled: "停止",
      stale: "期限切れ",
      svcCodex: "Codex",
      svcAgGemini: "AG · Gemini",
      svcAgThird: "AG · Claude/GPT",
      svcGeminiChat: "Gemini チャット",
      svcChatgpt: "ChatGPT",
      resetsIn: "{t}後にリセット",
      resetsOn: "{d}にリセット",
      dH: "{h}時間",
      dHM: "{h}時間{m}分",
      dM: "{m}分",
      updated: "{t}に更新",
      justNow: "たった今",
      mAgo: "{n}分前",
      hAgo: "{n}時間前",
    },
    ko: {
      workspace: "워크스페이스",
      unknown: "알 수 없음",
      noData: "데이터 없음",
      disabled: "중단",
      stale: "만료됨",
      svcCodex: "Codex",
      svcAgGemini: "AG · Gemini",
      svcAgThird: "AG · Claude/GPT",
      svcGeminiChat: "Gemini 채팅",
      svcChatgpt: "ChatGPT",
      resetsIn: "{t} 후 초기화",
      resetsOn: "{d} 초기화",
      dH: "{h}시간",
      dHM: "{h}시간 {m}분",
      dM: "{m}분",
      updated: "{t} 업데이트",
      justNow: "방금",
      mAgo: "{n}분 전",
      hAgo: "{n}시간 전",
    },
  };

  const SERVICE_NAME_KEY = {
    codex: "svcCodex",
    "antigravity-gemini": "svcAgGemini",
    "antigravity-claude-gpt": "svcAgThird",
    "gemini-chat": "svcGeminiChat",
    "chatgpt-chat": "svcChatgpt",
  };

  const shellEl = document.getElementById("haloShell");
  const quotaPanelEl = document.getElementById("quotaPanel");
  const btnCodex = document.getElementById("btnCodex");
  const btnAntigravity = document.getElementById("btnAntigravity");
  const btnWorkspace = document.getElementById("btnWorkspace");
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

  function t(key, vars) {
    const dict = STRINGS[state.lang] || STRINGS.en;
    let out = dict[key] || STRINGS.en[key] || key;
    if (vars) for (const k of Object.keys(vars)) out = out.replace(`{${k}}`, vars[k]);
    return out;
  }

  function formatDuration(totalMin) {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h > 0 && m > 0) return t("dHM", { h, m });
    if (h > 0) return t("dH", { h });
    return t("dM", { m });
  }

  function formatReset(resetAt, windowMinutes) {
    const target = Number(resetAt);
    if (!Number.isFinite(target)) return "";
    const diffMs = target - Date.now();
    if (diffMs <= 0) return "";
    const totalMin = Math.max(1, Math.round(diffMs / 60000));
    if (Number.isFinite(windowMinutes) && windowMinutes >= 1440 && totalMin > 24 * 60) {
      try {
        const d = new Intl.DateTimeFormat(state.lang || "en", { month: "short", day: "numeric" }).format(target);
        return t("resetsOn", { d });
      } catch {}
    }
    return t("resetsIn", { t: formatDuration(totalMin) });
  }

  function formatAge(ts, now) {
    const diff = Math.max(0, now - ts);
    const min = Math.floor(diff / 60000);
    if (min < 1) return t("justNow");
    if (min < 60) return t("mAgo", { n: min });
    const hr = Math.floor(min / 60);
    if (hr < 24) return t("hAgo", { n: hr });
    try {
      return new Intl.DateTimeFormat(state.lang || "en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(ts);
    } catch {
      return new Date(ts).toLocaleString();
    }
  }

  function shortPeriodLabel(minutes, fallback) {
    if (!Number.isFinite(minutes) || minutes <= 0) return fallback;
    if (minutes % 1440 === 0) return `${minutes / 1440}d`;
    if (minutes % 60 === 0) return `${minutes / 60}h`;
    return `${minutes}m`;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function reportHeightSoon() {
    requestAnimationFrame(() => {
      const rect = shellEl.getBoundingClientRect();
      const totalHeight = Math.ceil(rect.height + 10);
      if (totalHeight > 20 && Math.abs(totalHeight - lastReportedHeight) >= 2) {
        lastReportedHeight = totalHeight;
        window.petHaloAPI.reportLayout({ height: totalHeight });
      }
    });
  }

  function syncIcon(img, fallback, url) {
    if (url) {
      img.src = url;
      img.hidden = false;
      fallback.style.display = "none";
    } else {
      img.hidden = true;
      fallback.style.display = "";
    }
  }

  icoCodex.addEventListener("error", () => { icoCodex.hidden = true; svgCodex.style.display = ""; });
  icoAntigravity.addEventListener("error", () => { icoAntigravity.hidden = true; svgAntigravity.style.display = ""; });

  function buildSlotChip(slot, defaultTag) {
    if (!slot) return null;
    const tag = shortPeriodLabel(slot.windowMinutes, defaultTag);
    if (slot.kind === "disabled") {
      const chip = el("span", "q-slot disabled");
      chip.append(el("span", "k", tag), el("span", "v", t("disabled")));
      return chip;
    }
    const sev = !slot.stale ? globalThis.CharacterQuotaView.severity(slot.usedPercent) : "ok";
    const cls = slot.stale ? "stale" : (sev === "hot" ? "bad" : sev === "warn" ? "warn" : "");
    const chip = el("span", `q-slot${cls ? ` ${cls}` : ""}`);
    chip.append(el("span", "k", tag), el("span", "v", `${slot.remaining}%`));
    return chip;
  }

  function buildRowTooltip(item, now) {
    const parts = [];
    for (const [label, slot] of [["5h", item.shortWindow], ["7d", item.weeklyWindow]]) {
      if (!slot) continue;
      if (slot.kind === "disabled") {
        parts.push(`${label}: ${t("disabled")}`);
      } else {
        const reset = slot.expired ? t("stale") : formatReset(slot.resetAt, slot.windowMinutes);
        parts.push(`${shortPeriodLabel(slot.windowMinutes, label)} ${slot.remaining}%${reset ? ` (${reset})` : ""}`);
      }
    }
    if (item.lastSeenAt) parts.push(t("updated", { t: formatAge(item.lastSeenAt, now) }));
    if (item.source) parts.push(item.source);
    return parts.join(" · ");
  }

  function renderQuotaSection() {
    const now = Date.now();
    const unified = globalThis.CharacterQuotaView.buildUnifiedQuotaRows(state.accountQuota, now);
    const rows = unified.map((item) => {
      const row = el("div", `q-row${item.unknown ? " is-muted" : ""}`);
      row.dataset.quotaId = item.id;
      const name = t(SERVICE_NAME_KEY[item.id] || item.id);
      row.appendChild(el("span", "q-name", name));

      const slots = el("div", "q-slots");
      if (item.unknown) {
        slots.appendChild(el("span", "q-none", item.id === "chatgpt-chat" ? t("unknown") : t("noData")));
      } else {
        const shortChip = buildSlotChip(item.shortWindow, "5h");
        const weeklyChip = buildSlotChip(item.weeklyWindow, "7d");
        if (shortChip) slots.appendChild(shortChip);
        if (weeklyChip) slots.appendChild(weeklyChip);
      }
      row.appendChild(slots);

      const primary = item.primary;
      const sev = primary && !primary.stale ? globalThis.CharacterQuotaView.severity(primary.usedPercent) : "ok";
      const barCls = !primary || primary.stale
        ? "empty"
        : (sev === "hot" ? "bad" : sev === "warn" ? "warn" : "");
      const bar = el("div", `q-bar${barCls ? ` ${barCls}` : ""}`);
      const fill = document.createElement("i");
      if (primary && !primary.stale) fill.style.width = `${primary.remaining}%`;
      bar.appendChild(fill);
      row.appendChild(bar);

      const tip = buildRowTooltip(item, now);
      if (tip) row.title = tip;
      return row;
    });
    quotaPanelEl.replaceChildren(...rows);
  }

  function renderDock() {
    lblWorkspace.textContent = t("workspace");
    const icons = state.quotaAgentIcons || {};
    syncIcon(icoCodex, svgCodex, icons.codexQuota);
    syncIcon(icoAntigravity, svgAntigravity, icons.antigravityQuota);
    if (state.pendingApprovalCount > 0) {
      workspaceBadgeEl.hidden = false;
      workspaceBadgeEl.classList.add("approval");
    } else if (state.runningCount > 0) {
      workspaceBadgeEl.hidden = false;
      workspaceBadgeEl.classList.remove("approval");
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

  quotaPanelEl.addEventListener("click", () => window.petHaloAPI.openWorkspace("quotas"));
  btnCodex.addEventListener("click", () => window.petHaloAPI.launchClient("codex"));
  btnAntigravity.addEventListener("click", () => window.petHaloAPI.launchClient("antigravity"));
  btnWorkspace.addEventListener("click", () => window.petHaloAPI.openWorkspace("overview"));

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
      if (visible) {
        renderQuotaSection();
        reportHeightSoon();
      }
    });
  });

  window.petHaloAPI.getState().then((initial) => {
    if (initial && typeof initial === "object") state = { ...state, ...initial };
    render();
  }).catch(() => render());

  setInterval(() => {
    if (shellEl.classList.contains("is-visible")) renderQuotaSection();
  }, 15000);
})();
