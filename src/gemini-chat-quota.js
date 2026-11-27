"use strict";

const { readQuotaPanel } = require("./antigravity-usage-reader");
const GEMINI_CHAT_SOURCE = "gemini-web-usage";
const GEMINI_CHAT_USAGE_URL = "https://gemini.google.com/usage";
const GEMINI_CHAT_QUOTA_FIELDS = ["geminiChatFiveHour", "geminiChatWeekly"];
const MINUTE = 60000;

function parseUsageRows(text, updated, now = Date.now()) {
  if (typeof text !== "string" || typeof updated !== "string") return null;
  const ageMatch = /(?:^Updated\s+)?(\d+)\s*(分钟|分鐘|小时|小時|minutes?|hours?)(?:\s+ago|前更新)/i.exec(updated);
  const recent = /^(?:刚刚更新|剛剛更新|Updated just now)$/i.test(updated);
  if (!recent && !ageMatch) return null;
  const age = recent ? 0 : Number(ageMatch[1]) * (/小时|小時|hour/i.test(ageMatch[2]) ? 60 : 1);
  if (age > 1440) return null;
  const capturedAt = Math.floor(now / MINUTE) * MINUTE - age * MINUTE;
  const start = /(?:当前用量|目前用量|Current (?:usage|limit))/i.exec(text);
  const weekly = /(?:每周限额|每週限額|Weekly limit)/i.exec(text);
  const result = {};

  function readWindow(row, windowMinutes) {
    const percent = /(?:已使用|Used)\s*(\d{1,3}(?:\.\d+)?)\s*%|\b(\d{1,3}(?:\.\d+)?)\s*%\s+used\b/i.exec(row);
    if (!percent || Number(percent[1] ?? percent[2]) > 100) return null;
    const bucket = { usedPercent: Number(percent[1] ?? percent[2]), capturedAt, windowMinutes };
    const shortReset = /(?:重置时间|重設時間|Resets? at)\s*[:：]?\s*(\d{1,2}):(\d\d)\b/i.exec(row);
    const weeklyReset = /(?:重置时间|重設時間)\s*[:：]?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2}):(\d\d)\b/.exec(row);
    const target = new Date(capturedAt);
    if (windowMinutes === 300 && shortReset) {
      target.setHours(Number(shortReset[1]), Number(shortReset[2]), 0, 0);
      if (target.getTime() < capturedAt) target.setDate(target.getDate() + 1);
    } else if (windowMinutes === 10080 && weeklyReset) {
      target.setMonth(Number(weeklyReset[1]) - 1, Number(weeklyReset[2]));
      target.setHours(Number(weeklyReset[3]), Number(weeklyReset[4]), 0, 0);
      if (target.getTime() < capturedAt) target.setFullYear(target.getFullYear() + 1);
    } else return bucket;
    const resetAt = target.getTime();
    if (resetAt > capturedAt && resetAt <= capturedAt + windowMinutes * MINUTE) bucket.resetAt = resetAt;
    return bucket;
  }

  if (start && (!weekly || start.index < weekly.index)) {
    const bucket = readWindow(text.slice(start.index, weekly?.index), 300);
    if (bucket) result.geminiChatFiveHour = bucket;
  }
  if (weekly) {
    const bucket = readWindow(text.slice(weekly.index), 10080);
    if (bucket) result.geminiChatWeekly = bucket;
  }
  return Object.keys(result).length ? result : null;
}

function createGeminiChatQuotaRefresh({ isTrusted, publish, read = readQuotaPanel }) {
  let pending;
  let lastObservation;
  async function run() {
    try {
      if (!isTrusted()) return { status: "permission-required" };
      const result = await read({ service: "gemini-chat" });
      if (result.status !== "ok") return { status: result.status };
      const group = parseUsageRows(result.text, result.updated);
      if (!group) return { status: "unrecognized" };
      const observation = `${result.text}\n${result.updated}`;
      if (observation === lastObservation) return { status: "unchanged" };
      lastObservation = observation;
      publish(group);
      return { status: "ok" };
    } catch { return { status: "unavailable" }; }
  }
  return function refresh() {
    pending ??= run().finally(() => { pending = null; });
    return pending;
  };
}

module.exports = { GEMINI_CHAT_SOURCE, GEMINI_CHAT_USAGE_URL, GEMINI_CHAT_QUOTA_FIELDS, createGeminiChatQuotaRefresh, parseUsageRows };
