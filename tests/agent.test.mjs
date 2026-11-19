import test from "node:test";
import assert from "node:assert/strict";
import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { POST } from "../app/api/agent/route.ts";
import { issueSession } from "../app/travel-session.mjs";
import { createImageTool } from "../app/api/agent/image-tool.mjs";
import { withLimitSummary } from "../app/api/chat/agent-loop.mjs";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const request = (body, cookie = `travel_session=${issueSession()}`, origin) => new Request("http://localhost/api/agent", {
  method: "POST", headers: { cookie, ...(origin ? { origin } : {}) }, body: typeof body === "string" ? body : JSON.stringify(body),
});
const user = text => ({ id: "user", role: "user", parts: [{ type: "text", text }] });
const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: "reply", object: "chat.completion.chunk", model: "test/actual-model", created: 1, choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
const stream = (delta, reason) => new Response(chunk(delta) + chunk({}, reason) + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });

test("agent: sesja jest pierwsza dla obu trybów, także przy złym JSON i bez konfiguracji", async () => {
  process.env.OPENROUTER_API_KEY = "";
  process.env.OPENROUTER_MODEL = "";
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("network forbidden"); };
  try {
    for (const cookie of ["", "travel_session=fake"]) {
      for (const body of ["bad json", { mode: "chat", messages: [user("Cześć")] }, { mode: "analyze", message: "Oferta" }]) {
        assert.equal((await POST(request(body, cookie))).status, 401);
      }
    }
    assert.equal((await POST(request({ mode: "chat" }, undefined, "https://other.example"))).status, 403);
    for (const body of [null, "bad json", {}, { mode: "image" }, { mode: "json" }]) assert.equal((await POST(request(body))).status, 400);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = previous; }
});

test("agent: generowanie obrazu w pętli, cały wynik do UI, tylko krótki tekst do modelu", async () => {
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.OPENROUTER_MODEL = "test/chat-model";
  const previous = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    sent.push(body);
    if (body.modalities?.includes("image")) return Response.json({ model: "google/actual-image-model", choices: [{ index: 0, message: {
      role: "assistant", content: null, images: [{ type: "image_url", image_url: { url: `data:image/png;base64,${png}` } }],
    }, finish_reason: "stop" }] });
    if (!body.messages.some(item => item.role === "tool")) return stream({ tool_calls: [{ index: 0, id: "image-1", type: "function", function: { name: "generujObraz", arguments: JSON.stringify({ prompt: "Beżowa sofa w salonie" }) } }] }, "tool_calls");
    return stream({ content: "Obraz jest gotowy." }, "stop");
  };
  try {
    const cookie = `travel_session=${issueSession()}`;
    const chat = new Chat({ transport: new DefaultChatTransport({ api: "http://localhost/api/agent", fetch: async (url, options) => {
      const headers = new Headers(options.headers); headers.set("cookie", cookie);
      const body = JSON.parse(options.body); body.mode = "chat"; body.generateImage = chat.messages.length <= 1;
      return POST(new Request(url, { ...options, headers, body: JSON.stringify(body) }));
    } }) });
    await chat.sendMessage({ text: "Wygeneruj wizualizację sofy" });
    assert.equal(chat.status, "ready", chat.error?.message);
    assert.equal(sent.length, 3);
    assert.equal(sent[0].tool_choice.function.name, "generujObraz");
    assert.ok(sent[0].tools.some(tool => tool.type === "openrouter:web_search" && tool.engine === "native" && tool.max_results === 3));
    for (const name of ["aktualnyCzas", "kalkulator", "pogoda", "waluty", "swieta", "wikipedia", "czas", "notatki", "diagnostyka"]) assert.ok(sent[0].tools.some(tool => tool.function?.name === name));
    assert.equal(sent[1].model, "google/gemini-3.1-flash-image-preview");
    const result = chat.messages[1].parts.find(part => part.type === "tool-generujObraz");
    assert.equal(result.state, "output-available");
    assert.equal(result.output.url, `data:image/png;base64,${png}`);
    assert.equal(result.output.modelId, "google/actual-image-model");
    assert.equal(sent[2].messages.find(message => message.role === "tool").content, "obraz wygenerowany");
    assert.doesNotMatch(JSON.stringify(sent[2]), /data:image|iVBORw0KGgo|google\/actual-image-model/);
    await chat.sendMessage({ text: "Dziękuję" });
    assert.equal(chat.status, "ready", chat.error?.message);
    assert.doesNotMatch(JSON.stringify(sent.at(-1)), /data:image|iVBORw0KGgo/);
    assert.equal(chat.messages[1].parts.find(part => part.type === "tool-generujObraz").output.url, `data:image/png;base64,${png}`);
  } finally { globalThis.fetch = previous; }
});

test("narzędzie obrazu: błąd po polsku i bez pliku w toModelOutput", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: { message: "private-provider-details", code: 503 } }, { status: 503 });
  try {
    const tool = createImageTool({ apiKey: "test-key" });
    assert.equal(tool.inputSchema.safeParse({ prompt: "x".repeat(501) }).success, false);
    assert.equal(tool.inputSchema.safeParse({ prompt: " " }).success, false);
    assert.equal(tool.inputSchema.safeParse({ prompt: "x".repeat(500) }).success, true);
    const output = await tool.execute({ prompt: "Sofa" });
    assert.equal(output.ok, false);
    assert.match(output.message, /Nie udało się wygenerować obrazu/);
    assert.doesNotMatch(output.message, /private-provider-details|test-key/);
    assert.deepEqual(tool.toModelOutput({ output }), { type: "text", value: output.message });
    assert.deepEqual(tool.toModelOutput({ output: { ok: true, url: "data:image/png;base64,secret" } }), { type: "text", value: "obraz wygenerowany" });
  } finally { globalThis.fetch = previous; }
});

test("podsumowanie limitu nie umieszcza base64 obrazu w tekście odpowiedzi", async () => {
  const chunks = [
    { type: "tool-input-available", toolCallId: "i", toolName: "generujObraz", input: { prompt: "Sofa" } },
    { type: "tool-output-available", toolCallId: "i", output: { ok: true, url: `data:image/png;base64,${png}`, modelId: "actual-model" } },
    ...Array.from({ length: 5 }, () => ({ type: "start-step" })), { type: "finish", finishReason: "stop" },
  ];
  const result = await Array.fromAsync(new ReadableStream({ start(controller) { chunks.forEach(chunk => controller.enqueue(chunk)); controller.close(); } }).pipeThrough(withLimitSummary()));
  const text = result.filter(chunk => chunk.type === "text-delta").map(chunk => chunk.delta).join("");
  assert.match(text, /obraz wygenerowany/);
  assert.doesNotMatch(text, /base64|iVBOR/);
});

test("limit pięciu kroków daje komunikat także bez tekstu i wyników narzędzi", async () => {
  const chunks = [
    ...Array.from({ length: 5 }, () => [{ type: "start-step" }, { type: "finish-step" }]).flat(),
    { type: "finish", finishReason: "tool-calls" },
  ];
  const result = await Array.fromAsync(new ReadableStream({ start(controller) { chunks.forEach(chunk => controller.enqueue(chunk)); controller.close(); } }).pipeThrough(withLimitSummary()));
  const text = result.filter(chunk => chunk.type === "text-delta").map(chunk => chunk.delta).join("");
  assert.match(text, /Przerwałem po 5 krokach/);
  assert.equal(result.filter(chunk => chunk.type === "finish").length, 1);
  assert.equal(result.filter(chunk => chunk.type === "text-start").length, 1);
  assert.equal(result.filter(chunk => chunk.type === "text-end").length, 1);
  assert.equal(result.at(-1).messageMetadata.steps, 5);
});
