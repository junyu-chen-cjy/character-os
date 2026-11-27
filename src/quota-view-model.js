"use strict";

(function (root) {
  const providers = {
    codexQuota: [["codexFiveHour", 300], ["codexWeekly", 10080]],
    geminiChatQuota: [["geminiChatFiveHour", 300], ["geminiChatWeekly", 10080]],
    antigravityQuota: [["geminiFiveHour", 300, "gemini"], ["geminiWeekly", 10080, "gemini"],
      ["thirdPartyFiveHour", 300, "thirdParty"], ["thirdPartyWeekly", 10080, "thirdParty"]],
  };
  const staleMinutes = { codexQuota: 30, codexSparkQuota: 60, antigravityQuota: 30, antigravityCliQuota: 25, geminiChatQuota: 30, kimiQuota: 7, deepseekQuota: 12 };

  function describeWindow(bucket, providerKey, now, fallbackMinutes, lastSeenAt) {
    if (!bucket || !Number.isFinite(bucket.usedPercent)) return null;
    const { usedPercent, resetAt } = bucket;
    const expired = bucket.expired === true || (Number.isFinite(resetAt) && resetAt <= now);
    const seenAt = bucket.lastSeenAt || lastSeenAt || 0;
    return {
      ...bucket,
      lastSeenAt: seenAt,
      windowMinutes: bucket.windowMinutes || fallbackMinutes,
      remaining: Math.max(0, Math.min(100, Math.round(100 - usedPercent))),
      expired,
      stale: expired || (seenAt > 0 && now - seenAt >= (staleMinutes[providerKey] ?? 5) * 60000),
    };
  }

  function describeSlot(bucket, providerKey, now, fallbackMinutes, providerMeta = {}) {
    if (!bucket || typeof bucket !== "object") return null;
    const seenAt = bucket.lastSeenAt || providerMeta.lastSeenAt || 0;
    const updatedAt = providerMeta.updatedAt || seenAt || 0;
    if (bucket.disabled === true) {
      return {
        kind: "disabled",
        disabled: true,
        windowMinutes: bucket.windowMinutes || fallbackMinutes,
        bucketLabel: bucket.bucketLabel || "",
        lastSeenAt: seenAt,
        updatedAt,
        source: providerMeta.source || "",
      };
    }
    const described = describeWindow(bucket, providerKey, now, fallbackMinutes, seenAt);
    if (!described) return null;
    return {
      kind: "value",
      ...described,
      updatedAt,
      source: providerMeta.source || "",
    };
  }

  function slotRank(slot) {
    if (!slot) return 99;
    if (slot.kind === "disabled") return 50;
    return slot.expired ? 2 : slot.stale ? 1 : 0;
  }

  function pickBetterSlot(current, candidate) {
    if (!candidate) return current;
    if (!current) return candidate;
    const rCur = slotRank(current);
    const rCan = slotRank(candidate);
    if (rCan !== rCur) return rCan < rCur ? candidate : current;
    if (candidate.kind === "value" && current.kind === "value") {
      if ((candidate.lastSeenAt || 0) !== (current.lastSeenAt || 0)) {
        return (candidate.lastSeenAt || 0) > (current.lastSeenAt || 0) ? candidate : current;
      }
      return candidate.usedPercent > current.usedPercent ? candidate : current;
    }
    return current;
  }

  function pickPrimaryFromSlots(shortWindow, weeklyWindow) {
    const active = [shortWindow, weeklyWindow].filter((s) => s && s.kind === "value");
    if (!active.length) return null;
    active.sort((a, b) => {
      const ra = slotRank(a);
      const rb = slotRank(b);
      if (ra !== rb) return ra - rb;
      if (a.usedPercent !== b.usedPercent) return b.usedPercent - a.usedPercent;
      return (a.windowMinutes || 0) - (b.windowMinutes || 0);
    });
    return active[0];
  }

  function primaryWindow(sources, providerKey, now) {
    if (providerKey === "antigravityQuota" && sources?.some(s => s.antigravityCliQuota)) providerKey = "antigravityCliQuota";
    let best = null;
    for (const source of sources ?? []) {
      const provider = source?.[providerKey];
      if (!provider?.group) continue;
      const fields = providerKey === "antigravityCliQuota"
        ? Object.entries(provider.group).map(([key, bucket]) => [key, bucket.windowMinutes, bucket.groupLabel])
        : providers[providerKey] ?? [];
      for (const [key, minutes, modelGroup] of fields) {
        if (provider.group[key]?.disabled) continue;
        const window = describeWindow(provider.group[key], providerKey, now, minutes, provider.lastSeenAt);
        if (!window) continue;
        const item = { ...window, modelGroup, source: source.host || "" };
        const rank = value => value.expired ? 2 : value.stale ? 1 : 0;
        if (!best || rank(item) < rank(best)
            || (rank(item) === rank(best) && (item.usedPercent > best.usedPercent
              || (item.usedPercent === best.usedPercent && item.windowMinutes < best.windowMinutes)))) best = item;
      }
    }
    return best;
  }

  function isShortBucket(bucket) {
    if (Number.isFinite(bucket?.windowMinutes)) return bucket.windowMinutes < 1440;
    return /5h|hour|short|current|session/i.test(String(bucket?.bucketLabel || ""));
  }

  function isWeeklyBucket(bucket) {
    if (Number.isFinite(bucket?.windowMinutes)) return bucket.windowMinutes >= 1440;
    return /week|7d|day/i.test(String(bucket?.bucketLabel || ""));
  }

  function isGeminiGroupLabel(label) {
    return /gemini/i.test(String(label || ""));
  }

  function collectPairFromFields(sources, providerKey, shortField, weeklyField, now) {
    let shortWindow = null;
    let weeklyWindow = null;
    let sourceLabel = "";
    for (const source of sources ?? []) {
      const provider = source?.[providerKey];
      if (!provider?.group) continue;
      const meta = {
        lastSeenAt: provider.lastSeenAt || 0,
        updatedAt: provider.updatedAt || provider.lastSeenAt || 0,
        source: source.host || "",
      };
      const sCand = describeSlot(provider.group[shortField], providerKey, now, 300, meta);
      const wCand = describeSlot(provider.group[weeklyField], providerKey, now, 10080, meta);
      const nextShort = pickBetterSlot(shortWindow, sCand);
      const nextWeekly = pickBetterSlot(weeklyWindow, wCand);
      if (nextShort !== shortWindow || nextWeekly !== weeklyWindow) {
        shortWindow = nextShort;
        weeklyWindow = nextWeekly;
        if (meta.source) sourceLabel = meta.source;
      }
    }
    return { shortWindow, weeklyWindow, source: sourceLabel };
  }

  function collectAntigravityCliGroup(sources, matchGemini, now) {
    let shortWindow = null;
    let weeklyWindow = null;
    let sourceLabel = "";
    let groupLabel = "";
    for (const source of sources ?? []) {
      const provider = source?.antigravityCliQuota;
      if (!provider?.group) continue;
      const meta = {
        lastSeenAt: provider.lastSeenAt || 0,
        updatedAt: provider.updatedAt || provider.lastSeenAt || 0,
        source: source.host || "",
      };
      for (const bucket of Object.values(provider.group)) {
        if (!bucket || typeof bucket !== "object") continue;
        const geminiMatch = isGeminiGroupLabel(bucket.groupLabel);
        if (geminiMatch !== matchGemini) continue;
        if (bucket.groupLabel) groupLabel = bucket.groupLabel;
        if (isWeeklyBucket(bucket)) {
          const cand = describeSlot(bucket, "antigravityCliQuota", now, 10080, meta);
          const next = pickBetterSlot(weeklyWindow, cand);
          if (next !== weeklyWindow) {
            weeklyWindow = next;
            if (meta.source) sourceLabel = meta.source;
          }
        } else if (isShortBucket(bucket)) {
          const cand = describeSlot(bucket, "antigravityCliQuota", now, 300, meta);
          const next = pickBetterSlot(shortWindow, cand);
          if (next !== shortWindow) {
            shortWindow = next;
            if (meta.source) sourceLabel = meta.source;
          }
        } else {
          // Unknown period: treat as short slot if short is empty, else weekly.
          const cand = describeSlot(bucket, "antigravityCliQuota", now, bucket.windowMinutes || 300, meta);
          if (!shortWindow) shortWindow = cand;
          else weeklyWindow = pickBetterSlot(weeklyWindow, cand);
          if (meta.source) sourceLabel = meta.source;
        }
      }
    }
    return { shortWindow, weeklyWindow, source: sourceLabel, groupLabel };
  }

  function finalizeUnifiedRow(id, providerKey, data) {
    const shortWindow = data?.shortWindow || null;
    const weeklyWindow = data?.weeklyWindow || null;
    const primary = pickPrimaryFromSlots(shortWindow, weeklyWindow);
    const hasAny = Boolean(shortWindow || weeklyWindow);
    const seenCandidates = [shortWindow?.lastSeenAt, weeklyWindow?.lastSeenAt].filter((n) => Number.isFinite(n) && n > 0);
    const updatedCandidates = [shortWindow?.updatedAt, weeklyWindow?.updatedAt].filter((n) => Number.isFinite(n) && n > 0);
    const lastSeenAt = seenCandidates.length ? Math.max(...seenCandidates) : 0;
    const updatedAt = updatedCandidates.length ? Math.max(...updatedCandidates) : lastSeenAt;
    const activeValues = [shortWindow, weeklyWindow].filter((s) => s && s.kind === "value");
    const stale = activeValues.length > 0 && activeValues.every((s) => s.stale);
    const expired = activeValues.length > 0 && activeValues.every((s) => s.expired);
    return {
      id,
      providerKey,
      shortWindow,
      weeklyWindow,
      primary,
      lastSeenAt,
      updatedAt,
      source: data?.source || "",
      groupLabel: data?.groupLabel || "",
      stale,
      expired,
      unknown: !hasAny,
    };
  }

  // Canonical 4-row quota view shared by Pet Halo, Workspace (Overview + Detail),
  // and Personal Agent get_quota so all surfaces stay strictly consistent.
  function buildUnifiedQuotaRows(sources, now = Date.now()) {
    const list = Array.isArray(sources) ? sources : [];
    const hasCli = list.some((s) => s && s.antigravityCliQuota && s.antigravityCliQuota.group);

    const codexData = collectPairFromFields(list, "codexQuota", "codexFiveHour", "codexWeekly", now);

    const agGeminiCli = hasCli ? collectAntigravityCliGroup(list, true, now) : null;
    const agGeminiFallback = collectPairFromFields(list, "antigravityQuota", "geminiFiveHour", "geminiWeekly", now);
    const agGeminiUsesCli = Boolean(agGeminiCli && (agGeminiCli.shortWindow || agGeminiCli.weeklyWindow));

    const agThirdCli = hasCli ? collectAntigravityCliGroup(list, false, now) : null;
    const agThirdFallback = collectPairFromFields(list, "antigravityQuota", "thirdPartyFiveHour", "thirdPartyWeekly", now);
    const agThirdUsesCli = Boolean(agThirdCli && (agThirdCli.shortWindow || agThirdCli.weeklyWindow));

    const geminiChatData = collectPairFromFields(list, "geminiChatQuota", "geminiChatFiveHour", "geminiChatWeekly", now);

    return [
      finalizeUnifiedRow("codex", "codexQuota", codexData),
      finalizeUnifiedRow(
        "antigravity-gemini",
        agGeminiUsesCli ? "antigravityCliQuota" : "antigravityQuota",
        agGeminiUsesCli ? agGeminiCli : agGeminiFallback
      ),
      finalizeUnifiedRow(
        "antigravity-claude-gpt",
        agThirdUsesCli ? "antigravityCliQuota" : "antigravityQuota",
        agThirdUsesCli ? agThirdCli : agThirdFallback
      ),
      finalizeUnifiedRow("gemini-chat", "geminiChatQuota", geminiChatData),
    ];
  }

  function severity(usedPercent) {
    if (usedPercent > 85) return "hot";
    if (usedPercent >= 60) return "warn";
    return "ok";
  }

  const api = { describeWindow, primaryWindow, buildUnifiedQuotaRows, severity };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CharacterQuotaView = api;
})(globalThis);
