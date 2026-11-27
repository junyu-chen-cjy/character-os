"use strict";

(() => {
  // Duration pieces are composed per language so zh reads "4 小时 19 分后重置"
  // and en reads "resets in 4h 19m" instead of a glued translation.
  const STRINGS = {
    en: {
      workspace: "Workspace", noData: "No data", left: "{pct}", win5h: "5h", win7d: "Weekly",
      resetsIn: "resets in {t}", resetsOn: "resets {d}", dH: "{h}h", dHM: "{h}h {m}m", dM: "{m}m",
      read: "Read {t}", updated: "Updated {t}", justNow: "just now", mAgo: "{n}m ago", hAgo: "{n}h ago",
    },
    zh: {
      workspace: "工作台", noData: "暂无数据", left: "{pct}", win5h: "5 小时", win7d: "每周",
      resetsIn: "{t}后重置", resetsOn: "{d}重置", dH: "{h} 小时", dHM: "{h} 小时 {m} 分", dM: "{m} 分钟",
      read: "读取于 {t}", updated: "更新于 {t}", justNow: "刚刚", mAgo: "{n} 分钟前", hAgo: "{n} 小时前",
    },
    "zh-TW": {
      workspace: "工作台", noData: "暫無資料", left: "{pct}", win5h: "5 小時", win7d: "每週",
      resetsIn: "{t}後重置", resetsOn: "{d}重置", dH: "{h} 小時", dHM: "{h} 小時 {m} 分", dM: "{m} 分鐘",
      read: "讀取於 {t}", updated: "更新於 {t}", justNow: "剛剛", mAgo: "{n} 分鐘前", hAgo: "{n} 小時前",
    },
    ja: {
      workspace: "ワークスペース", noData: "データなし", left: "{pct}", win5h: "5時間", win7d: "週間",
      resetsIn: "{t}後にリセット", resetsOn: "{d}にリセット", dH: "{h}時間", dHM: "{h}時間{m}分", dM: "{m}分",
      read: "{t}に取得", updated: "{t}に更新", justNow: "たった今", mAgo: "{n}分前", hAgo: "{n}時間前",
    },
    ko: {
      workspace: "워크스페이스", noData: "데이터 없음", left: "{pct}", win5h: "5시간", win7d: "주간",
      resetsIn: "{t} 후 초기화", resetsOn: "{d} 초기화", dH: "{h}시간", dHM: "{h}시간 {m}분", dM: "{m}분",
      read: "{t} 읽음", updated: "{t} 업데이트", justNow: "방금", mAgo: "{n}분 전", hAgo: "{n}시간 전",
    },
  };

  const WARN_USED = 60;
  const HOT_USED = 85;
  // Antigravity is read on demand from the Gemini app, Codex streams in on its
  // own; each gets a different threshold before its age is called out.
  const AGE_SHOWN_AFTER_MS = { codex: 20 * 60000, antigravity: 0 };
  const AGE_STALE_AFTER_MS = { codex: 60 * 60000, antigravity: 60 * 60000 };

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
      } catch {
        // fall through to a relative duration
      }
    }
    return t("resetsIn", { t: formatDuration(totalMin) });
  }

  function formatAge(lastSeenAt, now) {
    const diff = Math.max(0, now - lastSeenAt);
    const min = Math.floor(diff / 60000);
    if (min < 1) return t("justNow");
    if (min < 60) return t("mAgo", { n: min });
    const hr = Math.floor(min / 60);
    if (hr < 24) return t("hAgo", { n: hr });
    try {
      return new Intl.DateTimeFormat(state.lang || "en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(lastSeenAt);
    } catch {
      return new Date(lastSeenAt).toLocaleString();
    }
  }

  function normalizeBucket(group, field, fallbackWin, now, discardExpired = false) {
    const raw = group && group[field];
    if (!raw || typeof raw !== "object") return null;
    const expired = raw.expired === true || (Number.isFinite(raw.resetAt) && raw.resetAt <= now);
    if (expired && discardExpired) return null;
    const used = expired ? 0 : Math.max(0, Math.min(100, Number(raw.usedPercent) || 0));
    return {
      used,
      remaining: Math.max(0, Math.min(100, Math.round(100 - used))),
      lastSeenAt: Number(raw.lastSeenAt) || 0,
      windowKey: fallbackWin === "7d" ? "win7d" : "win5h",
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
          normalizeBucket(g, "geminiFiveHour", "5h", now, true),
          normalizeBucket(g, "geminiWeekly", "7d", now, true),
          normalizeBucket(g, "thirdPartyFiveHour", "5h", now, true),
          normalizeBucket(g, "thirdPartyWeekly", "7d", now, true),
        ]);
        if (chosen && (!agyBest || chosen.used > agyBest.used)) agyBest = chosen;
      }
    }
    return [
      { id: "codex", name: "Codex", iconUrl: icons.codexQuota || "", bucket: codexBest },
      { id: "antigravity", name: "Antigravity", iconUrl: icons.antigravityQuota || "", bucket: agyBest },
    ];
  }

  function severityForUsed(used) {
    if (used > HOT_USED) return "bad";
    if (used >= WARN_USED) return "warn";
    return "";
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
      const totalHeight = Math.ceil(rect.height + 14);
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

  function renderQuotaSection() {
    const now = Date.now();
    const rows = resolvePrimaryQuotas(now).map((item) => {
      const sev = item.bucket ? severityForUsed(item.bucket.used) : "";
      const row = el("div", `q${sev ? ` ${sev}` : ""}`);
      const head = el("div", "q-head");
      if (item.iconUrl) {
        const img = el("img", "q-ico");
        img.src = item.iconUrl;
        img.alt = "";
        img.addEventListener("error", () => img.remove(), { once: true });
        head.appendChild(img);
      }
      head.appendChild(el("span", "q-name", item.name));

      if (!item.bucket) {
        head.appendChild(el("span", "q-none", t("noData")));
        row.appendChild(head);
        return row;
      }

      const val = el("span", "q-val", String(item.bucket.remaining));
      val.appendChild(el("small", "", "%"));
      head.appendChild(val);
      row.appendChild(head);

      const meter = el("div", `ui-meter${sev ? ` ${sev}` : ""}`);
      const fill = document.createElement("i");
      fill.style.width = `${item.bucket.remaining}%`;
      meter.appendChild(fill);
      row.appendChild(meter);

      const meta = el("div", "q-meta");
      const left = [t(item.bucket.windowKey), item.bucket.resetLabel].filter(Boolean).join(" · ");
      meta.appendChild(el("span", "", left));
      const seen = item.bucket.lastSeenAt;
      if (seen && now - seen >= (AGE_SHOWN_AFTER_MS[item.id] || 0)) {
        const age = t(item.id === "antigravity" ? "read" : "updated", { t: formatAge(seen, now) });
        const ageEl = el("span", "q-age", age);
        if (now - seen >= AGE_STALE_AFTER_MS[item.id]) ageEl.classList.add("stale");
        ageEl.title = new Date(seen).toLocaleString();
        meta.appendChild(ageEl);
      }
      row.appendChild(meta);
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
