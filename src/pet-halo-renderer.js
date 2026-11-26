"use strict";

(function initPetHaloRenderer() {
  const STRINGS = {
    en: {
      quotasTitle: "AI Quotas",
      pinAlways: "Pinned",
      pinHover: "On Hover",
      pinTitleAlways: "Quota rings stay beside character · Click for hover-only",
      pinTitleHover: "Quota rings show on hover · Click to pin beside character",
      scopeAgent: "Agent",
      remaining: "{pct}% left",
      resetIn: "↻ {time}",
      resetOn: "↻ {date}",
      stale: "stale",
      emptyQuota: "Awaiting live Agent quota · Open Workspace",
      runningCount: "{n} active",
      approvalCount: "{n} pending",
      workspace: "Workspace",
      command: "Command",
      clients: "Clients",
      dndOff: "Quiet",
      dndOn: "DND On",
      settings: "Settings",
      clientTagAgent: "Coding Agent",
      clientTagApp: "Official App",
      clientTagIde: "Agent IDE",
    },
    zh: {
      quotasTitle: "AI 服务额度",
      pinAlways: "常驻环",
      pinHover: "悬停环",
      pinTitleAlways: "额度环常驻桌宠旁 · 点击切换为仅悬停显示",
      pinTitleHover: "额度环仅悬停显示 · 点击切换为常驻显示",
      scopeAgent: "Agent",
      remaining: "剩余 {pct}%",
      resetIn: "↻ {time}",
      resetOn: "↻ {date}",
      stale: "待刷新",
      emptyQuota: "等待 Codex / Antigravity 额度上报 · 查看工作台",
      runningCount: "{n} 运行中",
      approvalCount: "{n} 待审批",
      workspace: "工作台",
      command: "指令",
      clients: "客户端",
      dndOff: "免打扰",
      dndOn: "免打扰中",
      settings: "设置",
      clientTagAgent: "编程 Agent",
      clientTagApp: "官方客户端",
      clientTagIde: "Agent IDE",
    },
    "zh-TW": {
      quotasTitle: "AI 服務額度",
      pinAlways: "常駐環",
      pinHover: "懸停環",
      pinTitleAlways: "額度環常駐桌寵旁 · 點擊切換為僅懸停顯示",
      pinTitleHover: "額度環僅懸停顯示 · 點擊切換為常駐顯示",
      scopeAgent: "Agent",
      remaining: "剩餘 {pct}%",
      resetIn: "↻ {time}",
      resetOn: "↻ {date}",
      stale: "待更新",
      emptyQuota: "等待 Codex / Antigravity 額度回報 · 開啟工作台",
      runningCount: "{n} 執行中",
      approvalCount: "{n} 待審批",
      workspace: "工作台",
      command: "指令",
      clients: "用戶端",
      dndOff: "勿擾",
      dndOn: "勿擾中",
      settings: "設定",
      clientTagAgent: "程式 Agent",
      clientTagApp: "官方應用",
      clientTagIde: "Agent IDE",
    },
    ja: {
      quotasTitle: "AI クォータ",
      pinAlways: "常時表示",
      pinHover: "ホバー時",
      pinTitleAlways: "クォータリングを常時表示中",
      pinTitleHover: "ホバー時のみ表示 · クリックで固定",
      scopeAgent: "Agent",
      remaining: "残り {pct}%",
      resetIn: "↻ {time}",
      resetOn: "↻ {date}",
      stale: "更新待ち",
      emptyQuota: "Agent クォータ待機中 · ワークスペースを開く",
      runningCount: "{n} 実行中",
      approvalCount: "{n} 承認待ち",
      workspace: "ワーク台",
      command: "コマンド",
      clients: "アプリ",
      dndOff: "集中",
      dndOn: "集中ON",
      settings: "設定",
      clientTagAgent: "Coding Agent",
      clientTagApp: "公式アプリ",
      clientTagIde: "Agent IDE",
    },
    ko: {
      quotasTitle: "AI 할당량",
      pinAlways: "항상 표시",
      pinHover: "호버 표시",
      pinTitleAlways: "할당량 링 고정됨",
      pinTitleHover: "호버 시 표시 · 클릭하여 고정",
      scopeAgent: "Agent",
      remaining: "{pct}% 남음",
      resetIn: "↻ {time}",
      resetOn: "↻ {date}",
      stale: "갱신 대기",
      emptyQuota: "Agent 할당량 수신 대기 · 워크스페이스 열기",
      runningCount: "{n} 실행 중",
      approvalCount: "{n} 승인 대기",
      workspace: "워크스페이스",
      command: "명령",
      clients: "클라이언트",
      dndOff: "방해금지",
      dndOn: "방해금지 켜짐",
      settings: "설정",
      clientTagAgent: "Coding Agent",
      clientTagApp: "공식 앱",
      clientTagIde: "Agent IDE",
    },
  };

  const STALE_AFTER_MS = 5 * 60 * 1000;
  const WARN_USED = 60;
  const HOT_USED = 85;

  const shellEl = document.getElementById("haloShell");
  const quotaEyebrowEl = document.getElementById("quotaEyebrow");
  const sessionPillEl = document.getElementById("sessionPill");
  const sessionPillTextEl = document.getElementById("sessionPillText");
  const pinToggleEl = document.getElementById("pinToggle");
  const pinToggleLabelEl = document.getElementById("pinToggleLabel");
  const quotaListEl = document.getElementById("quotaList");
  const clientsDrawerEl = document.getElementById("clientsDrawer");
  const btnWorkspace = document.getElementById("btnWorkspace");
  const workspaceBadgeEl = document.getElementById("workspaceBadge");
  const btnCommand = document.getElementById("btnCommand");
  const btnClients = document.getElementById("btnClients");
  const btnDnd = document.getElementById("btnDnd");
  const btnSettings = document.getElementById("btnSettings");

  const lblWorkspace = document.getElementById("lblWorkspace");
  const lblCommand = document.getElementById("lblCommand");
  const lblClients = document.getElementById("lblClients");
  const lblDnd = document.getElementById("lblDnd");
  const lblSettings = document.getElementById("lblSettings");

  let state = {
    lang: "en",
    doNotDisturb: false,
    quotaPinned: false,
    flippedAbove: false,
    runningCount: 0,
    pendingApprovalCount: 0,
    accountQuota: [],
    quotaAgentIcons: {},
    clients: [],
  };
  let clientsOpen = false;
  let lastReportedHeight = 0;

  function dict() {
    return STRINGS[state.lang] || STRINGS.en;
  }

  function t(key) {
    const d = dict();
    return d[key] || STRINGS.en[key] || key;
  }

  function formatWindow(windowMinutes, fallback) {
    const min = Number(windowMinutes);
    if (!Number.isFinite(min) || min <= 0) return fallback;
    if (min % 1440 === 0) return `${min / 1440}d`;
    if (min % 60 === 0) return `${min / 60}h`;
    return `${Math.round(min)}m`;
  }

  function formatReset(resetAt, windowMinutes) {
    const target = Number(resetAt);
    if (!Number.isFinite(target)) return "";
    const diffMs = target - Date.now();
    if (diffMs <= 0) return "";
    const totalMin = Math.max(1, Math.round(diffMs / 60000));
    if (Number.isFinite(windowMinutes) && windowMinutes >= 1440 && totalMin > 24 * 60) {
      try {
        const fmt = new Intl.DateTimeFormat(state.lang || "en", { month: "short", day: "numeric" });
        return t("resetOn").replace("{date}", fmt.format(target));
      } catch {
        // fall through to hours
      }
    }
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    const text = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
    return t("resetIn").replace("{time}", text);
  }

  function normalizeBucket(group, field, fallbackWin, now) {
    const raw = group && group[field];
    if (!raw || typeof raw !== "object") return null;
    const expired = raw.expired === true || (Number.isFinite(raw.resetAt) && raw.resetAt <= now);
    const used = expired ? 0 : Math.max(0, Math.min(100, Number(raw.usedPercent) || 0));
    const remaining = Math.max(0, Math.min(100, Math.round(100 - used)));
    const seenAt = Number(raw.lastSeenAt);
    return {
      used,
      remaining,
      expired,
      windowLabel: formatWindow(raw.windowMinutes, fallbackWin),
      resetLabel: expired ? "" : formatReset(raw.resetAt, raw.windowMinutes),
      seenAt: Number.isFinite(seenAt) ? seenAt : null,
    };
  }

  function pickDisplayPair(shortB, longB) {
    if (shortB && longB) {
      // Surface whichever window is under warning/hot pressure, else rolling window
      const primary = longB.used >= WARN_USED && longB.used > shortB.used ? longB : shortB;
      const secondary = primary === shortB ? longB : shortB;
      return { primary, secondary };
    }
    const single = shortB || longB;
    return single ? { primary: single, secondary: null } : null;
  }

  function collectRealQuotaItems(now) {
    const sources = Array.isArray(state.accountQuota) ? state.accountQuota : [];
    const icons = state.quotaAgentIcons || {};
    const items = [];
    const multiSource = sources.length > 1;

    for (const src of sources) {
      if (!src || typeof src !== "object") continue;
      const hostSuffix = multiSource && src.host ? ` (${src.host})` : "";

      if (src.codexQuota && src.codexQuota.group) {
        const g = src.codexQuota.group;
        const pair = pickDisplayPair(
          normalizeBucket(g, "codexFiveHour", "5h", now),
          normalizeBucket(g, "codexWeekly", "7d", now)
        );
        if (pair) {
          const seen = pair.primary.seenAt ?? Number(src.codexQuota.lastSeenAt || src.codexQuota.updatedAt || 0);
          items.push({
            name: `Codex${hostSuffix}`,
            scope: t("scopeAgent"),
            tone: "codex",
            iconUrl: icons.codexQuota || "",
            primary: pair.primary,
            secondary: pair.secondary,
            stale: Number.isFinite(seen) && seen > 0 && (now - seen > STALE_AFTER_MS),
          });
        }
      }

      if (src.antigravityQuota && src.antigravityQuota.group) {
        const g = src.antigravityQuota.group;
        const providerSeen = Number(src.antigravityQuota.lastSeenAt || src.antigravityQuota.updatedAt || 0);
        const gemPair = pickDisplayPair(
          normalizeBucket(g, "geminiFiveHour", "5h", now),
          normalizeBucket(g, "geminiWeekly", "7d", now)
        );
        if (gemPair) {
          const seen = gemPair.primary.seenAt ?? providerSeen;
          items.push({
            name: `Antigravity · Gemini${hostSuffix}`,
            scope: t("scopeAgent"),
            tone: "gemini",
            iconUrl: icons.antigravityQuota || "",
            primary: gemPair.primary,
            secondary: gemPair.secondary,
            stale: Number.isFinite(seen) && seen > 0 && (now - seen > STALE_AFTER_MS),
          });
        }
        const tpPair = pickDisplayPair(
          normalizeBucket(g, "thirdPartyFiveHour", "5h", now),
          normalizeBucket(g, "thirdPartyWeekly", "7d", now)
        );
        if (tpPair) {
          const seen = tpPair.primary.seenAt ?? providerSeen;
          items.push({
            name: `Antigravity · Claude/GPT${hostSuffix}`,
            scope: t("scopeAgent"),
            tone: "antigravity",
            iconUrl: icons.antigravityQuota || "",
            primary: tpPair.primary,
            secondary: tpPair.secondary,
            stale: Number.isFinite(seen) && seen > 0 && (now - seen > STALE_AFTER_MS),
          });
        }
      }
    }
    return items.slice(0, 4);
  }

  function severityForUsed(used) {
    if (used > HOT_USED) return "sev-hot";
    if (used >= WARN_USED) return "sev-warn";
    return "";
  }

  function reportHeightSoon() {
    requestAnimationFrame(() => {
      const rect = shellEl.getBoundingClientRect();
      const totalHeight = Math.ceil(rect.height + 16);
      if (totalHeight > 20 && Math.abs(totalHeight - lastReportedHeight) >= 2) {
        lastReportedHeight = totalHeight;
        window.petHaloAPI.reportLayout({ height: totalHeight });
      }
    });
  }

  function renderQuotaSection() {
    quotaEyebrowEl.textContent = t("quotasTitle");
    pinToggleEl.classList.toggle("is-pinned", !!state.quotaPinned);
    pinToggleLabelEl.textContent = state.quotaPinned ? t("pinAlways") : t("pinHover");
    pinToggleEl.title = state.quotaPinned ? t("pinTitleAlways") : t("pinTitleHover");

    if (state.pendingApprovalCount > 0) {
      sessionPillEl.hidden = false;
      sessionPillEl.classList.add("has-approval");
      sessionPillTextEl.textContent = t("approvalCount").replace("{n}", state.pendingApprovalCount);
    } else if (state.runningCount > 0) {
      sessionPillEl.hidden = false;
      sessionPillEl.classList.remove("has-approval");
      sessionPillTextEl.textContent = t("runningCount").replace("{n}", state.runningCount);
    } else {
      sessionPillEl.hidden = true;
    }

    const items = collectRealQuotaItems(Date.now());
    quotaListEl.replaceChildren();

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "quota-empty";
      empty.textContent = t("emptyQuota");
      empty.addEventListener("click", () => window.petHaloAPI.openWorkspace());
      quotaListEl.appendChild(empty);
      return;
    }

    for (const item of items) {
      const row = document.createElement("div");
      row.className = `quota-item${item.stale ? " is-stale" : ""}`;
      row.addEventListener("click", () => window.petHaloAPI.openWorkspace());

      const top = document.createElement("div");
      top.className = "quota-item-top";

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
      const scope = document.createElement("span");
      scope.className = "quota-scope";
      scope.textContent = item.scope;
      svc.append(name, scope);

      const readout = document.createElement("div");
      readout.className = "quota-readout";
      const sev = severityForUsed(item.primary.used);
      const pct = document.createElement("span");
      pct.className = `quota-pct${sev ? ` ${sev}` : ""}`;
      pct.textContent = t("remaining").replace("{pct}", item.primary.remaining);

      const metaParts = [item.primary.windowLabel];
      if (item.primary.resetLabel) metaParts.push(item.primary.resetLabel);
      else if (item.secondary) metaParts.push(`${item.secondary.windowLabel} ${item.secondary.remaining}%`);
      const meta = document.createElement("span");
      meta.className = "quota-meta";
      meta.textContent = metaParts.filter(Boolean).join(" · ");

      readout.append(pct, meta);
      top.append(svc, readout);

      const bar = document.createElement("div");
      bar.className = "quota-bar";
      const fill = document.createElement("div");
      fill.className = `quota-bar-fill pv-${item.tone}${sev ? ` ${sev}` : ""}`;
      fill.style.width = `${item.primary.remaining}%`;
      bar.appendChild(fill);

      row.append(top, bar);
      quotaListEl.appendChild(row);
    }
  }

  function renderClientsDrawer() {
    clientsDrawerEl.hidden = !clientsOpen;
    btnClients.classList.toggle("is-active", clientsOpen);
    btnClients.setAttribute("aria-expanded", clientsOpen ? "true" : "false");
    clientsDrawerEl.replaceChildren();
    if (!clientsOpen) return;

    const list = Array.isArray(state.clients) && state.clients.length
      ? state.clients
      : [
        { id: "codex", label: "Codex", kind: "agent" },
        { id: "gemini", label: "Gemini", kind: "app" },
        { id: "antigravity", label: "Antigravity", kind: "ide" },
      ];

    for (const client of list) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "client-item";
      const title = document.createElement("span");
      title.textContent = client.label;
      const tag = document.createElement("span");
      tag.className = "client-item-tag";
      tag.textContent = client.kind === "app"
        ? t("clientTagApp")
        : (client.kind === "ide" ? t("clientTagIde") : t("clientTagAgent"));
      btn.append(title, tag);
      btn.addEventListener("click", async () => {
        clientsOpen = false;
        renderClientsDrawer();
        reportHeightSoon();
        await window.petHaloAPI.launchClient(client.id);
      });
      clientsDrawerEl.appendChild(btn);
    }
  }

  function renderDock() {
    lblWorkspace.textContent = t("workspace");
    lblCommand.textContent = t("command");
    lblClients.textContent = t("clients");
    lblDnd.textContent = state.doNotDisturb ? t("dndOn") : t("dndOff");
    lblSettings.textContent = t("settings");

    btnDnd.classList.toggle("is-dnd", !!state.doNotDisturb);
    btnDnd.setAttribute("aria-pressed", state.doNotDisturb ? "true" : "false");

    if (state.pendingApprovalCount > 0) {
      workspaceBadgeEl.hidden = false;
      workspaceBadgeEl.classList.add("warn");
    } else if (state.runningCount > 0) {
      workspaceBadgeEl.hidden = false;
      workspaceBadgeEl.classList.remove("warn");
    } else {
      workspaceBadgeEl.hidden = true;
    }
  }

  function render() {
    shellEl.classList.toggle("flipped-above", !!state.flippedAbove);
    renderQuotaSection();
    renderClientsDrawer();
    renderDock();
    reportHeightSoon();
  }

  document.addEventListener("pointerenter", () => window.petHaloAPI.setHovered(true));
  document.addEventListener("pointerleave", () => window.petHaloAPI.setHovered(false));

  pinToggleEl.addEventListener("click", async (e) => {
    e.stopPropagation();
    const res = await window.petHaloAPI.toggleQuotaPinned();
    if (res && typeof res.quotaPinned === "boolean") {
      state.quotaPinned = res.quotaPinned;
      renderQuotaSection();
    }
  });

  btnWorkspace.addEventListener("click", () => {
    clientsOpen = false;
    window.petHaloAPI.openWorkspace();
  });

  btnCommand.addEventListener("click", () => {
    clientsOpen = false;
    window.petHaloAPI.openCommand();
  });

  btnClients.addEventListener("click", () => {
    clientsOpen = !clientsOpen;
    renderClientsDrawer();
    reportHeightSoon();
  });

  btnDnd.addEventListener("click", async () => {
    const res = await window.petHaloAPI.toggleDnd();
    if (res && typeof res.doNotDisturb === "boolean") {
      state.doNotDisturb = res.doNotDisturb;
      renderDock();
    }
  });

  btnSettings.addEventListener("click", () => {
    clientsOpen = false;
    window.petHaloAPI.openSettings();
  });

  window.petHaloAPI.onState((next) => {
    if (!next || typeof next !== "object") return;
    state = { ...state, ...next };
    render();
  });

  window.petHaloAPI.onVisibility((payload) => {
    const visible = !!(payload && payload.visible);
    if (!visible) {
      clientsOpen = false;
      renderClientsDrawer();
    }
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
