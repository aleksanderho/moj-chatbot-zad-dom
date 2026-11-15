import test from "node:test";
import assert from "node:assert/strict";
import { createTaskBudget, TOOL_LIMIT, TASK_TIMEOUT_MS, TOOL_TIMEOUT_MS } from "../app/api/chat/task-budget.mjs";
import { createTools } from "../app/api/chat/tools.mjs";
import { withLimitSummary } from "../app/api/chat/agent-loop.mjs";
import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport, createUIMessageStreamResponse, streamText } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

test("niezależny limit: 20 równoległych prób uruchamia najwyżej 16 narzędzi", async () => {
  assert.equal(TOOL_LIMIT, 16);
  assert.equal(TASK_TIMEOUT_MS, 60000);
  assert.equal(TOOL_TIMEOUT_MS, 10000);
  const budget = createTaskBudget();
  const tools = createTools({ model: "test", owner: "test", budget });
  try {
    const results = await Promise.all(Array.from({ length: 20 }, () => tools.kalkulator.execute({ dzialanie: "dodaj", a: 1, b: 2 })));
    assert.equal(results.filter(x => x.ok).length, 16);
    assert.equal(budget.calls, 16);
    assert.equal(budget.reason, "tools");
  } finally { budget.dispose(); }
});

test("błąd zatrzymuje narzędzia, nie ma powtórnej próby ani efektów ubocznych", async () => {
  const budget = createTaskBudget();
  let requests = 0;
  const tools = createTools({ model: "test", owner: "test", budget, fetcher: async () => { requests++; throw new Error("private"); } });
  try {
    assert.equal((await tools.wikipedia.execute({ haslo: "Warszawa" })).ok, false);
    assert.equal((await tools.wikipedia.execute({ haslo: "Warszawa" })).ok, false);
    assert.equal(requests, 1);
    assert.equal(budget.calls, 1);
    assert.equal(budget.reason, "error");
  } finally { budget.dispose(); }
});

test("timeout obejmuje całe narzędzie, nawet gdy źródło ignoruje abort", async () => {
  const budget = createTaskBudget();
  const keepAlive = setTimeout(() => {}, 500);
  const tools = createTools({ model: "test", owner: "test", budget, toolTimeoutMs: 15, fetcher: () => new Promise(() => {}) });
  try {
    const result = await tools.wikipedia.execute({ haslo: "Warszawa" });
    assert.equal(result.ok, false);
    assert.equal(result.message, "źródło nie odpowiada");
    assert.equal(budget.reason, "error");
  } finally { budget.dispose(); clearTimeout(keepAlive); }
});

test("deadline przerywa zadanie; klient otrzymuje częściowy wynik i statystyki", async () => {
  const budget = createTaskBudget({ timeoutMs: 20 });
  const keepAlive = setTimeout(() => {}, 500);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue({ type: "start", messageId: "deadline-test" });
      controller.enqueue({ type: "start-step" });
      controller.enqueue({ type: "tool-input-available", toolCallId: "c1", toolName: "kalkulator", input: { a: 2, b: 3, dzialanie: "dodaj" } });
      budget.admit();
      controller.enqueue({ type: "tool-output-available", toolCallId: "c1", output: { ok: true, wynik: 5 } });
      controller.enqueue({ type: "finish-step" });
      budget.signal.addEventListener("abort", () => {
        controller.enqueue({ type: "abort" });
        controller.close();
      }, { once: true });
    },
  });
  try {
    const chat = new Chat({ transport: new DefaultChatTransport({ api: "http://localhost/api/chat", fetch: async () => createUIMessageStreamResponse({ stream: stream.pipeThrough(withLimitSummary(budget)) }) }) });
    await chat.sendMessage({ text: "Test" });
    assert.equal(chat.status, "ready", chat.error?.message);
    const response = chat.messages[1];
    assert.ok(response.parts.some(p => p.type === "text" && p.text.includes("60 sekundach") && p.text.includes('"wynik": 5')));
    assert.equal(response.metadata.steps, 1);
    assert.equal(response.metadata.toolCalls, 1);
    assert.ok(response.metadata.elapsedMs >= 0);
  } finally { budget.dispose(); clearTimeout(keepAlive); }
});

test("deadline przerywa rzeczywisty strumień SDK bez kolejnego wywołania modelu", async () => {
  const budget = createTaskBudget({ timeoutMs: 40 });
  const keepAlive = setTimeout(() => {}, 1000);
  let calls = 0;
  const provider = createOpenRouter({ apiKey: "test", fetch: async (_url, options) => {
    calls++;
    return new Response(new ReadableStream({ start(controller) {
      const chunk = { id: "test", object: "chat.completion.chunk", created: 1, model: "test/model", choices: [{ index: 0, delta: { content: "Mam część danych." }, finish_reason: null }] };
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
      options.signal.addEventListener("abort", () => controller.error(options.signal.reason), { once: true });
    } }), { headers: { "Content-Type": "text/event-stream" } });
  } });
  try {
    const result = streamText({ model: provider("test/model"), prompt: "Test", abortSignal: budget.signal, maxRetries: 0, onError: () => {}, prepareStep: () => { budget.steps++; return {}; } });
    const chat = new Chat({ transport: new DefaultChatTransport({ api: "http://localhost/api/chat", fetch: async () => createUIMessageStreamResponse({ stream: result.toUIMessageStream().pipeThrough(withLimitSummary(budget)) }) }) });
    await chat.sendMessage({ text: "Test" });
    assert.equal(calls, 1);
    assert.equal(chat.status, "ready", chat.error?.message);
    assert.equal(chat.messages[1].metadata.steps, 1);
    assert.ok(chat.messages[1].parts.some(p => p.type === "text" && p.text.includes("60 sekundach")));
  } finally { budget.dispose(); clearTimeout(keepAlive); }
});
