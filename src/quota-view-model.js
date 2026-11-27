"use strict";

(function (root) {
  const providers = {
    codexQuota: [["codexFiveHour", 300], ["codexWeekly", 10080]],
    geminiChatQuota: [["geminiChatFiveHour", 300], ["geminiChatWeekly", 10080]],
    antigravityQuota: [["geminiFiveHour", 300, "gemini"], ["geminiWeekly", 10080, "gemini"],
      ["thirdPartyFiveHour", 300, "thirdParty"], ["thirdPartyWeekly", 10080, "thirdParty"]],
  };
  const staleMinutes = { codexQuota: 60, codexSparkQuota: 60, antigravityQuota: 30, geminiChatQuota: 30, kimiQuota: 7, deepseekQuota: 12 };

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

  function primaryWindow(sources, providerKey, now) {
    let best = null;
    for (const source of sources ?? []) {
      const provider = source?.[providerKey];
      if (!provider?.group) continue;
      for (const [key, minutes, modelGroup] of providers[providerKey] ?? []) {
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

  function severity(usedPercent) {
    if (usedPercent > 85) return "hot";
    if (usedPercent >= 60) return "warn";
    return "ok";
  }

  const api = { describeWindow, primaryWindow, severity };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CharacterQuotaView = api;
})(globalThis);
