"use strict";

const MAX_REPLY_LENGTH = 256 * 1024;
const MAX_EVENT_LENGTH = 2 * 1024 * 1024;
const MAX_TOOL_ARGS_LENGTH = 64 * 1024;

class ChatError extends Error {
  constructor(message, options = {}) {
    super(message);
    if (options.code) this.code = options.code;
    if (options.httpStatus) this.httpStatus = options.httpStatus;
  }
}

function parseEndpoint(value) {
  let url;
  try { url = new URL(value); } catch {}
  const loopback = url && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!url || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
      || url.username || url.password || url.search || url.hash) {
    throw new ChatError("Use an HTTPS Base URL, or HTTP for a local model on localhost. Omit credentials, queries and fragments.");
  }
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/chat/completions") ? path : path + "/chat/completions";
  return url.href;
}

// Decode SSE across arbitrary byte and line boundaries. Empty lines commit an event.
async function* readEvents(body) {
  const decoder = new TextDecoder();
  let buffer = "";
  let data = [];
  let eventLength = 0;
  function addData(line) {
    eventLength += line.length;
    if (eventLength > MAX_EVENT_LENGTH) throw new ChatError("The model returned an oversized stream event.");
    data.push(line.slice(5).replace(/^ /, ""));
  }
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let start = 0;
    for (let end = 0; end < buffer.length; end++) {
      const char = buffer[end];
      if (char !== "\n" && char !== "\r") continue;
      if (char === "\r" && end === buffer.length - 1) break;
      const line = buffer.slice(start, end);
      if (char === "\r" && buffer[end + 1] === "\n") end++;
      start = end + 1;
      if (line === "" && data.length) {
        yield data.join("\n");
        data = [];
        eventLength = 0;
      } else if (line.startsWith("data:")) {
        addData(line);
      }
    }
    buffer = buffer.slice(start);
    if (buffer.length > MAX_EVENT_LENGTH) throw new ChatError("The model returned an oversized stream event.");
  }
  // Some compatible servers omit the final blank line.
  buffer += decoder.decode();
  const lastLine = buffer.replace(/\r$/, "");
  if (lastLine.startsWith("data:")) addData(lastLine);
  if (data.length) yield data.join("\n");
}

function finalizeToolCalls(byIndex) {
  return Array.from(byIndex.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([index, item]) => ({
      id: item.id || `call_${index}`,
      type: "function",
      function: {
        name: item.name || "",
        arguments: item.arguments || "{}",
      },
    }))
    .filter((item) => item.function.name);
}

async function streamReply({ endpoint, model, apiKey, messages, tools, toolChoice, signal, onDelta }) {
  const hasTools = Array.isArray(tools) && tools.length > 0;
  const payload = {
    model,
    messages,
    stream: true,
    ...(hasTools ? { tools, tool_choice: toolChoice || "auto" } : {}),
  };
  const response = await fetch(endpoint, {
    method: "POST",
    redirect: "error",
    signal,
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream, application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    // Do not log or expose upstream bodies, which may echo input or secrets.
    await response.body?.cancel();
    if (hasTools && (response.status === 400 || response.status === 422 || response.status === 501)) {
      throw new ChatError(
        `The model endpoint returned HTTP ${response.status} when tool calling was enabled.`,
        { code: "TOOLS_UNSUPPORTED", httpStatus: response.status }
      );
    }
    throw new ChatError(`The model endpoint returned HTTP ${response.status}. Check your connection settings.`, {
      httpStatus: response.status,
    });
  }
  if (!response.body) throw new ChatError("The model returned an empty response.");
  let replyText = "";
  let replyLength = 0;
  let finishReason = null;
  const toolCallsByIndex = new Map();

  function append(value) {
    if (typeof value !== "string" || !value) return;
    replyLength += value.length;
    if (replyLength > MAX_REPLY_LENGTH) throw new ChatError("The reply exceeded the chat length limit.");
    replyText += value;
    if (typeof onDelta === "function") onDelta(value);
  }

  function mergeToolCallDelta(delta) {
    if (!delta || typeof delta !== "object") return;
    const index = Number.isInteger(delta.index) ? delta.index : toolCallsByIndex.size;
    let entry = toolCallsByIndex.get(index);
    if (!entry) {
      entry = { id: "", name: "", arguments: "" };
      toolCallsByIndex.set(index, entry);
    }
    if (typeof delta.id === "string" && delta.id) entry.id = delta.id;
    const fn = delta.function;
    if (fn && typeof fn === "object") {
      if (typeof fn.name === "string" && fn.name) entry.name += fn.name;
      if (typeof fn.arguments === "string" && fn.arguments) {
        if (entry.arguments.length + fn.arguments.length > MAX_TOOL_ARGS_LENGTH) {
          throw new ChatError("The model returned oversized tool arguments.");
        }
        entry.arguments += fn.arguments;
      }
    }
  }

  if (response.headers.get("content-type")?.includes("application/json")) {
    const decoder = new TextDecoder();
    let json = "";
    for await (const chunk of response.body) {
      json += decoder.decode(chunk, { stream: true });
      if (json.length > MAX_EVENT_LENGTH) throw new ChatError("The model returned an oversized response.");
    }
    let result;
    try { result = JSON.parse(json + decoder.decode()); } catch {
      throw new ChatError("The model returned invalid JSON.");
    }
    const choice = result?.choices?.[0];
    finishReason = choice?.finish_reason ?? null;
    append(choice?.message?.content);
    if (Array.isArray(choice?.message?.tool_calls)) {
      choice.message.tool_calls.forEach((tc, idx) => mergeToolCallDelta({ ...tc, index: idx }));
    }
  } else {
    let completed = false;
    for await (const data of readEvents(response.body)) {
      if (data === "[DONE]") {
        completed = true;
        break;
      }
      let event;
      try { event = JSON.parse(data); } catch {
        throw new ChatError("The model returned an invalid stream event.");
      }
      if (event?.error) {
        if (hasTools && /tool|function/i.test(String(event.error?.message || event.error || ""))) {
          throw new ChatError("This model does not support tool calling.", { code: "TOOLS_UNSUPPORTED" });
        }
        throw new ChatError("The model reported a generation error.");
      }
      const choice = event?.choices?.[0];
      append(choice?.delta?.content);
      if (Array.isArray(choice?.delta?.tool_calls)) {
        for (const tc of choice.delta.tool_calls) mergeToolCallDelta(tc);
      }
      if (choice?.finish_reason != null) {
        finishReason = choice.finish_reason;
        completed = true;
      }
    }
    if (!completed) throw new ChatError("The connection closed before the model finished.");
  }

  const toolCalls = finalizeToolCalls(toolCallsByIndex);
  if (!replyLength && !toolCalls.length) throw new ChatError("The model returned no text.");
  return { content: replyText, toolCalls, finishReason };
}

module.exports = { ChatError, parseEndpoint, streamReply };
