"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");

const { ChatError, streamReply } = require("../src/chat-provider");
const { runAgentTurn } = require("../src/personal-agent-core");

describe("Phase B1: chat-provider tool_calls streaming & Agent Core loop", () => {
  it("parses streamed OpenAI tool_calls deltas across chunks", async () => {
    let seenBody = null;
    const origFetch = global.fetch;
    global.fetch = async (_url, opts) => {
      seenBody = JSON.parse(opts.body);
      const chunks = [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"search_files","arguments":"{\\"query\\":"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"AlphaZero\\"}"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
        "data: [DONE]\n\n",
      ];
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/event-stream" }),
        body: Readable.from(chunks.map((c) => Buffer.from(c, "utf8"))),
      };
    };
    try {
      const result = await streamReply({
        endpoint: "http://127.0.0.1:11434/v1/chat/completions",
        model: "gpt-4.1-mini",
        apiKey: "",
        messages: [{ role: "user", content: "find AlphaZero" }],
        tools: [{ type: "function", function: { name: "search_files", parameters: { type: "object" } } }],
        onDelta: () => {},
      });
      assert.equal(seenBody.tools.length, 1);
      assert.equal(result.toolCalls.length, 1);
      assert.equal(result.toolCalls[0].id, "call_1");
      assert.equal(result.toolCalls[0].function.name, "search_files");
      assert.equal(result.toolCalls[0].function.arguments, '{"query":"AlphaZero"}');
    } finally {
      global.fetch = origFetch;
    }
  });

  it("executes registered tools, returns results to model, and completes final reply", async () => {
    const calls = [];
    const stepsLog = [];
    let turn = 0;
    const fakeStream = async ({ messages, tools, onDelta }) => {
      turn += 1;
      assert.ok(Array.isArray(tools) && tools.length === 1);
      if (turn === 1) {
        return {
          content: "",
          toolCalls: [{
            id: "tc-1",
            type: "function",
            function: { name: "get_quota", arguments: '{"service":"codex"}' },
          }],
        };
      }
      const toolMsg = messages.find((m) => m.role === "tool" && m.tool_call_id === "tc-1");
      assert.ok(toolMsg && toolMsg.content.includes('"remaining":72'));
      onDelta("Codex 剩余 72%。");
      return { content: "Codex 剩余 72%。", toolCalls: [] };
    };

    const res = await runAgentTurn({
      endpoint: "http://127.0.0.1/v1/chat/completions",
      model: "test-model",
      apiKey: "",
      messages: [{ role: "user", content: "Codex quota?" }],
      registry: {
        get_quota: {
          name: "get_quota",
          description: "Read quota",
          parameters: { type: "object" },
          execute: async (args) => {
            calls.push(args);
            return { status: "ok", remaining: 72 };
          },
        },
      },
      onStep: (s) => stepsLog.push(s),
      streamReplyFn: fakeStream,
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].service, "codex");
    assert.equal(res.text, "Codex 剩余 72%。");
    assert.equal(stepsLog[stepsLog.length - 1][0].status, "done");
  });

  it("falls back gracefully and flags toolsUnsupported when endpoint rejects tools", async () => {
    let calls = 0;
    const res = await runAgentTurn({
      endpoint: "http://127.0.0.1/v1/chat/completions",
      model: "no-tools-model",
      apiKey: "",
      messages: [{ role: "user", content: "hi" }],
      registry: {
        get_quota: { name: "get_quota", description: "q", execute: async () => ({}) },
      },
      streamReplyFn: async ({ tools, onDelta }) => {
        calls += 1;
        if (tools) throw new ChatError("400", { code: "TOOLS_UNSUPPORTED", httpStatus: 400 });
        onDelta("Plain reply");
        return { content: "Plain reply", toolCalls: [] };
      },
    });
    assert.equal(calls, 2);
    assert.equal(res.toolsUnsupported, true);
    assert.equal(res.text, "Plain reply");
  });

  it("stops subsequent tool execution immediately when aborted and respects confirmation gates", async () => {
    const controller = new AbortController();
    let executedSecond = false;
    await assert.rejects(
      runAgentTurn({
        endpoint: "http://127.0.0.1/v1/chat/completions",
        model: "m",
        apiKey: "",
        messages: [{ role: "user", content: "run two" }],
        signal: controller.signal,
        registry: {
          t1: {
            name: "t1",
            description: "t1",
            execute: async () => {
              controller.abort();
              return { status: "ok" };
            },
          },
          t2: {
            name: "t2",
            description: "t2",
            execute: async () => {
              executedSecond = true;
              return { status: "ok" };
            },
          },
        },
        streamReplyFn: async () => ({
          content: "",
          toolCalls: [
            { id: "c1", type: "function", function: { name: "t1", arguments: "{}" } },
            { id: "c2", type: "function", function: { name: "t2", arguments: "{}" } },
          ],
        }),
      }),
      (err) => err instanceof ChatError && err.code === "ABORTED"
    );
    assert.equal(executedSecond, false);

    // Confirmation decline prevents execution
    let mutated = false;
    const declinedRes = await runAgentTurn({
      endpoint: "http://127.0.0.1/v1/chat/completions",
      model: "m",
      apiKey: "",
      messages: [{ role: "user", content: "send" }],
      requestConfirmation: async () => false,
      registry: {
        send_agent_message: {
          name: "send_agent_message",
          description: "send",
          prepareConfirmation: async () => ({ confirm: { title: "Confirm send" } }),
          execute: async () => { mutated = true; return { status: "sent" }; },
        },
      },
      streamReplyFn: async ({ messages, onDelta }) => {
        if (messages.some((m) => m.role === "tool")) {
          onDelta("Cancelled as requested.");
          return { content: "Cancelled as requested.", toolCalls: [] };
        }
        return {
          content: "",
          toolCalls: [{ id: "s1", type: "function", function: { name: "send_agent_message", arguments: "{}" } }],
        };
      },
    });
    assert.equal(mutated, false);
    assert.equal(declinedRes.text, "Cancelled as requested.");
  });
});
