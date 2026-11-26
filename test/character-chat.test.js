"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { pathToFileURL } = require("node:url");
const { parseEndpoint, streamReply } = require("../src/chat-provider");
const { createChatWindow } = require("../src/chat-window");

function event(delta) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\r\n\r\n`;
}

function streamOf(text) {
  return new ReadableStream({
    start(controller) {
      for (const byte of Buffer.from(text)) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
}

test("streams split UTF-8 deltas, normalizes the endpoint and refuses redirects", async t => {
  const endpoint = parseEndpoint("https://example.test/gateway/v1/");
  assert.equal(endpoint, "https://example.test/gateway/v1/chat/completions");
  assert.equal(parseEndpoint("http://127.0.0.1:8000/v1"), "http://127.0.0.1:8000/v1/chat/completions");
  assert.throws(() => parseEndpoint("http://example.test/v1"));
  assert.throws(() => parseEndpoint("https://user:secret@example.test/v1"));
  assert.throws(() => parseEndpoint("https://example.test/v1?key=secret"));

  t.mock.method(globalThis, "fetch", async (url, request) => {
    assert.equal(url, endpoint);
    assert.equal(request.redirect, "error");
    assert.equal(request.headers.Authorization, "Bearer fixture-key");
    assert.deepEqual(JSON.parse(request.body), {
      model: "fixture", stream: true, messages: [{ role: "user", content: "hello" }],
    });
    return new Response(streamOf(event("你好") + event(" **世界**") + "data: [DONE]\n\n"));
  });
  const deltas = [];
  await streamReply({
    endpoint, model: "fixture", apiKey: "fixture-key",
    messages: [{ role: "user", content: "hello" }], onDelta: value => deltas.push(value),
  });
  assert.deepEqual(deltas, ["你好", " **世界**"]);
});

test("reports an interrupted stream and keeps the received text", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(streamOf(event("partial"))));
  const deltas = [];
  await assert.rejects(streamReply({ onDelta: value => deltas.push(value) }), /before the model finished/);
  assert.deepEqual(deltas, ["partial"]);
});

function openFixture(directory) {
  const handlers = new Map();
  const frame = { parent: null, url: pathToFileURL(path.resolve(__dirname, "../src/chat.html")).href };
  const updates = new EventEmitter();
  let window;

  class BrowserWindow extends EventEmitter {
    constructor() {
      super();
      window = this;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.send = (_channel, next) => updates.emit("state", next);
    }
    loadFile() { return Promise.resolve(); }
    isDestroyed() { return false; }
  }

  const chat = createChatWindow({
    app: { getPath: () => directory },
    BrowserWindow,
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
    nativeTheme: {},
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(value.split("").reverse().join("")),
      decryptString: value => value.toString().split("").reverse().join(""),
    },
  });
  chat.open();

  return {
    invoke(name, value) {
      return handlers.get(`chat:${name}`)({ sender: window.webContents, senderFrame: frame }, value);
    },
    foreignSnapshot() {
      return handlers.get("chat:get")({ sender: {}, senderFrame: frame });
    },
    waitForState(predicate) {
      return new Promise(resolve => {
        function listener(snapshot) {
          if (!predicate(snapshot)) return;
          updates.off("state", listener);
          resolve(snapshot);
        }
        updates.on("state", listener);
      });
    },
  };
}

test("stops generation, restores chat history, and never returns the saved key", { timeout: 2000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "character-chat-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const chat = openFixture(directory);
  const preferences = { baseUrl: "https://example.test/v1", model: "fixture", systemPrompt: "Be brief." };
  const saved = chat.invoke("save-model", { ...preferences, apiKey: "fixture-key", clearKey: false });
  assert.equal(saved.state.model.hasKey, true);
  assert.equal(JSON.stringify(saved).includes("fixture-key"), false);
  assert.equal(fs.readFileSync(path.join(directory, "chat/model.json"), "utf8").includes("fixture-key"), false);
  assert.ok(chat.foreignSnapshot().error);

  let signal;
  t.mock.method(globalThis, "fetch", async (_url, request) => {
    signal = request.signal;
    assert.equal(request.headers.Authorization, "Bearer fixture-key");
    assert.deepEqual(JSON.parse(request.body).messages, [
      { role: "system", content: "Be brief." }, { role: "user", content: "hello" },
    ]);
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from(event('**partial** <script>alert(1)</script> ![image](https://example.test/pixel)')));
        signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
      },
    }));
  });
  const streaming = chat.waitForState(state => state.messages.at(-1)?.html?.includes("partial"));
  assert.equal(chat.invoke("send", "hello").state.generating, true);
  assert.equal(chat.invoke("send", "second").error, "Stop the current reply before sending another message.");
  const { messages } = await streaming;
  assert.match(messages[1].html, /<strong>partial<\/strong>/);
  assert.doesNotMatch(messages[1].html, /<script|<img/);

  assert.equal(chat.invoke("stop").state.generating, false);
  assert.equal(signal.aborted, true);
  const restored = openFixture(directory);
  const state = restored.invoke("get").state;
  assert.equal(state.messages[0].text, "hello");
  assert.equal(state.messages[1].status, "stopped");
  assert.match(state.messages[1].html, /partial/);
  assert.equal(restored.invoke("create").state.sessions.length, 2);
  assert.equal(restored.invoke("select", state.selectedId).state.messages.length, 2);

  const newEndpoint = restored.invoke("save-model", {
    ...preferences, baseUrl: "https://other.example/v1", apiKey: "", clearKey: false,
  });
  assert.equal(newEndpoint.state.model.hasKey, false);
});
