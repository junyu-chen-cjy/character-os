"use strict";

const { id } = require("./quota-extension-id.json");
const { parseUsageRows, GEMINI_CHAT_SOURCE } = require("./gemini-chat-quota");
const ORIGIN = `chrome-extension://${id}`;

function handleBrowserQuota(req, res, publish) {
  const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
  if (!local || req.headers.origin !== ORIGIN) {
    res.writeHead(403);
    res.end();
    return;
  }
  const headers = {
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Character-Quota",
    "Access-Control-Expose-Headers": "X-Character-Quota",
    "Access-Control-Allow-Private-Network": "true",
    "X-Character-Quota": "1",
    "Vary": "Origin",
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, headers);
    res.end();
    return;
  }
  if (req.method !== "POST" || req.headers["x-character-quota"] !== "1"
      || !req.headers["content-type"]?.startsWith("application/json")) {
    res.writeHead(400, headers);
    res.end();
    return;
  }

  let raw = "";
  req.on("data", chunk => {
    raw += chunk;
    if (raw.length > 8192) req.destroy();
  });
  req.on("end", () => {
    try {
      const { text, updated, observedAt } = JSON.parse(raw);
      if (typeof observedAt !== "number" || Math.abs(Date.now() - observedAt) > 60000) {
        throw new Error("Invalid observation time");
      }
      const group = parseUsageRows(text, updated, observedAt);
      if (!group) throw new Error("Unrecognized quota data");
      publish(GEMINI_CHAT_SOURCE, {
        displayHost: "Gemini · Chrome background",
        geminiChatQuota: group,
      });
      console.info("Character OS: Gemini background quota received", new Date(observedAt).toISOString());
      res.writeHead(204, headers);
      res.end();
    } catch {
      res.writeHead(400, headers);
      res.end();
    }
  });
}

module.exports = { handleBrowserQuota, ORIGIN };
