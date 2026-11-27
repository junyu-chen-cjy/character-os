"use strict";

const { randomUUID } = require("node:crypto");
const { ChatError, streamReply: defaultStreamReply } = require("./chat-provider");

const DEFAULT_MAX_LOOPS = 6;
const DEFAULT_TOOL_TIMEOUT_MS = 20_000;
const MAX_TOOL_OUTPUT_CHARS = 16_000;

const AGENT_SYSTEM_PROMPT = [
  "You are Character OS, a concise local personal AI control center running on the user's computer.",
  "Use the registered tools whenever the user asks about local files, AI service quotas, or Coding Agent sessions (Codex, Antigravity, etc.).",
  "Rules:",
  "1. Never fabricate file paths, quota percentages, or Agent session status. Always read real data via tools.",
  "2. Before calling send_agent_message, check live sessions with list_agent_sessions if the target client/project/session is not already unambiguous. If multiple candidates match, present them concisely and ask the user to choose.",
  "3. Keep replies crisp, direct, and in the user's language. Report tool statuses truthfully (sent vs started vs completed).",
].join("\n");

function buildToolSchemas(registry) {
  if (!registry || typeof registry !== "object") return [];
  return Object.values(registry).map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters || { type: "object", properties: {} },
    },
  }));
}

function parseToolArgs(raw) {
  if (!raw || typeof raw !== "string" || !raw.trim()) return { ok: true, value: {} };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ok: true, value: parsed };
    }
    return { ok: false, error: "Tool arguments must be a JSON object." };
  } catch {
    return { ok: false, error: "Tool arguments were not valid JSON." };
  }
}

function serializeToolOutput(value) {
  let json;
  try { json = JSON.stringify(value ?? { status: "ok" }); } catch {
    json = JSON.stringify({ status: "error", error: "Unserializable tool output." });
  }
  if (json.length > MAX_TOOL_OUTPUT_CHARS) {
    return json.slice(0, MAX_TOOL_OUTPUT_CHARS - 32) + "...(truncated)\"}";
  }
  return json;
}

function buildCombinedSignal(parentSignal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!parentSignal) return { signal: timeoutSignal, timeoutSignal };
  return { signal: AbortSignal.any([parentSignal, timeoutSignal]), timeoutSignal };
}

function isAbortError(error, parentSignal) {
  if (parentSignal && parentSignal.aborted) return true;
  return error?.name === "AbortError";
}

async function runAgentTurn({
  endpoint,
  model,
  apiKey,
  messages,
  userSystemPrompt = "",
  registry = {},
  maxLoops = DEFAULT_MAX_LOOPS,
  toolTimeoutMs = DEFAULT_TOOL_TIMEOUT_MS,
  signal,
  onDelta,
  onStep,
  requestConfirmation,
  streamReplyFn = defaultStreamReply,
}) {
  const toolSchemas = buildToolSchemas(registry);
  const systemParts = [];
  if (toolSchemas.length > 0) systemParts.push(AGENT_SYSTEM_PROMPT);
  if (userSystemPrompt && userSystemPrompt.trim()) systemParts.push(userSystemPrompt.trim());

  const loopMessages = [
    ...(systemParts.length ? [{ role: "system", content: systemParts.join("\n\n") }] : []),
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const steps = [];
  let accumulatedText = "";
  let toolsEnabled = toolSchemas.length > 0;
  let toolsUnsupported = false;

  const emitStep = (step) => {
    const idx = steps.findIndex((s) => s.id === step.id);
    if (idx >= 0) steps[idx] = { ...steps[idx], ...step };
    else steps.push(step);
    if (typeof onStep === "function") onStep(steps.map((s) => ({ ...s })));
  };

  for (let loop = 0; loop < maxLoops; loop++) {
    if (signal?.aborted) {
      throw new ChatError("Generation stopped.", { code: "ABORTED" });
    }

    let turnText = "";
    const handleDelta = (delta) => {
      turnText += delta;
      accumulatedText += delta;
      if (typeof onDelta === "function") onDelta(delta);
    };

    let result;
    try {
      result = await streamReplyFn({
        endpoint,
        model,
        apiKey,
        messages: loopMessages,
        tools: toolsEnabled ? toolSchemas : undefined,
        signal,
        onDelta: handleDelta,
      });
    } catch (error) {
      if (toolsEnabled && error instanceof ChatError && error.code === "TOOLS_UNSUPPORTED" && loop === 0) {
        toolsEnabled = false;
        toolsUnsupported = true;
        emitStep({
          id: `notice-${randomUUID()}`,
          tool: "system",
          status: "notice",
          code: "tools-unsupported",
        });
        result = await streamReplyFn({
          endpoint,
          model,
          apiKey,
          messages: loopMessages,
          signal,
          onDelta: handleDelta,
        });
      } else {
        throw error;
      }
    }

    const toolCalls = Array.isArray(result?.toolCalls) ? result.toolCalls : [];
    if (!toolCalls.length) {
      return { text: accumulatedText, steps, toolsUnsupported };
    }

    // Separate intermediate assistant narration from final reply cleanly if needed.
    if (turnText && !turnText.endsWith("\n")) {
      handleDelta("\n");
    }

    loopMessages.push({
      role: "assistant",
      content: result.content || null,
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      if (signal?.aborted) {
        throw new ChatError("Generation stopped.", { code: "ABORTED" });
      }
      const stepId = call.id || `step-${randomUUID()}`;
      const toolName = call.function?.name || "";
      const tool = registry[toolName];

      if (!tool || typeof tool.execute !== "function") {
        const errPayload = { status: "error", error: `Unknown tool: ${toolName}` };
        emitStep({ id: stepId, tool: toolName, status: "error", error: errPayload.error });
        loopMessages.push({
          role: "tool",
          tool_call_id: stepId,
          content: serializeToolOutput(errPayload),
        });
        continue;
      }

      const parsed = parseToolArgs(call.function?.arguments);
      if (!parsed.ok) {
        const errPayload = { status: "error", error: parsed.error };
        emitStep({ id: stepId, tool: toolName, status: "error", error: parsed.error });
        loopMessages.push({
          role: "tool",
          tool_call_id: stepId,
          content: serializeToolOutput(errPayload),
        });
        continue;
      }

      const args = parsed.value;
      emitStep({ id: stepId, tool: toolName, status: "running", args });

      let toolResult;
      try {
        // Optional confirmation gate before executing mutating / external actions.
        if (typeof tool.prepareConfirmation === "function") {
          const confirmation = await tool.prepareConfirmation(args);
          if (confirmation && confirmation.needsDisambiguation) {
            toolResult = confirmation;
            emitStep({ id: stepId, tool: toolName, status: "done", args, result: toolResult });
            loopMessages.push({
              role: "tool",
              tool_call_id: stepId,
              content: serializeToolOutput(toolResult),
            });
            continue;
          }
          if (confirmation && confirmation.confirm) {
            if (typeof requestConfirmation !== "function") {
              toolResult = { status: "cancelled", reason: "confirmation-unavailable" };
              emitStep({ id: stepId, tool: toolName, status: "cancelled", args, result: toolResult });
              loopMessages.push({
                role: "tool",
                tool_call_id: stepId,
                content: serializeToolOutput(toolResult),
              });
              continue;
            }
            emitStep({
              id: stepId,
              tool: toolName,
              status: "confirming",
              args,
              confirmation: confirmation.confirm,
            });
            const approved = await requestConfirmation(stepId, confirmation.confirm, signal);
            if (signal?.aborted) {
              throw new ChatError("Generation stopped.", { code: "ABORTED" });
            }
            if (!approved) {
              toolResult = { status: "cancelled", reason: "user-declined" };
              emitStep({ id: stepId, tool: toolName, status: "cancelled", args, result: toolResult });
              loopMessages.push({
                role: "tool",
                tool_call_id: stepId,
                content: serializeToolOutput(toolResult),
              });
              continue;
            }
            emitStep({ id: stepId, tool: toolName, status: "running", args });
          }
        }

        const timeoutMs = Number.isFinite(tool.timeoutMs) ? tool.timeoutMs : toolTimeoutMs;
        const { signal: toolSignal, timeoutSignal } = buildCombinedSignal(signal, timeoutMs);
        try {
          toolResult = await tool.execute(args, { signal: toolSignal });
        } catch (err) {
          if (signal?.aborted) throw err;
          if (timeoutSignal.aborted) {
            toolResult = { status: "error", error: `Tool "${toolName}" timed out after ${Math.round(timeoutMs / 1000)}s.` };
          } else {
            toolResult = { status: "error", error: err?.message || `Tool "${toolName}" failed.` };
          }
        }
      } catch (err) {
        if (isAbortError(err, signal)) {
          throw new ChatError("Generation stopped.", { code: "ABORTED" });
        }
        toolResult = { status: "error", error: err?.message || `Tool "${toolName}" failed.` };
      }

      const isErr = toolResult?.status === "error";
      emitStep({
        id: stepId,
        tool: toolName,
        status: isErr ? "error" : "done",
        args,
        result: toolResult,
        error: isErr ? toolResult.error : undefined,
      });
      loopMessages.push({
        role: "tool",
        tool_call_id: stepId,
        content: serializeToolOutput(toolResult),
      });
    }
  }

  return {
    text: accumulatedText,
    steps,
    toolsUnsupported,
    loopLimitReached: true,
  };
}

module.exports = {
  AGENT_SYSTEM_PROMPT,
  DEFAULT_MAX_LOOPS,
  DEFAULT_TOOL_TIMEOUT_MS,
  buildToolSchemas,
  runAgentTurn,
};
