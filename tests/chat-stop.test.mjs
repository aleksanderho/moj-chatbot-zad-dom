import test from "node:test";
import assert from "node:assert/strict";
import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { chatPOST as POST } from "./agent-fixtures.mjs";
import { markInterrupted } from "../app/chat-interruption.ts";

test("Stop przed odpowiedzią: dopisek bez usuwania historii i bez duplikatów", () => {
  const messages = [{ id: "u1", role: "user", parts: [{ type: "text", text: "Pytanie" }] }];
  const result = markInterrupted(messages, 120);
  assert.deepEqual(result[0], messages[0]);
  assert.equal(result[1].parts[0].text, "Przerwane przez użytkownika");
  assert.equal(result[1].metadata.interrupted, true);
  assert.deepEqual(markInterrupted(result, 200), result);
});

test("Stop zachowuje tekst, narzędzia, źródła i wcześniejsze statystyki", () => {
  const assistant = { id: "a1", role: "assistant", parts: [
    { type: "step-start" },
    { type: "tool-wikipedia", toolCallId: "t1", state: "output-available", input: { haslo: "Warszawa" }, output: { ok: true, sourceUrl: "https://pl.wikipedia.org/wiki/Warszawa" } },
    { type: "text", text: "Część odpowiedzi", state: "streaming" },
  ], metadata: { steps: 1, toolCalls: 1, elapsedMs: 100 } };
  const [result] = markInterrupted([assistant], 150);
  assert.deepEqual(result.parts[1], assistant.parts[1]);
  assert.equal(result.parts[2].text, "Część odpowiedzi");
  assert.equal(result.parts.at(-1).text, "Przerwane przez użytkownika");
  assert.equal(result.metadata.toolCalls, 1);
});

test("Stop przerywa strumień SDK i sygnał serwera, zachowuje wynik i pozwala wysłać kolejne pytanie", async () => {
  process.env.OPENROUTER_API_KEY = "test";
  process.env.OPENROUTER_MODEL = "test/model";
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let serverAborted = false;
  let receivedText;
  const textReady = new Promise(resolve => { receivedText = resolve; });
  globalThis.fetch = async (_url, options) => {
    calls++;
    const chunk = text => `data: ${JSON.stringify({ id: "reply", object: "chat.completion.chunk", created: 1, model: "test/model", choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`;
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(chunk("Gotowe ustalenie.")));
      if (calls > 1) {
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      } else options.signal.addEventListener("abort", () => {
        serverAborted = true;
        controller.error(options.signal.reason);
      }, { once: true });
    } }), { headers: { "Content-Type": "text/event-stream" } });
  };
  try {
    const chat = new Chat({ transport: new DefaultChatTransport({ api: "http://localhost/api/agent", fetch: async (url, options) => POST(new Request(url, options)) }) });
    chat['~registerMessagesCallback'](() => {
      if (chat.messages.some(m => m.role === "assistant" && m.parts.some(p => p.type === "text" && p.text.includes("Gotowe ustalenie.")))) receivedText();
    });
    const pending = chat.sendMessage({ text: "Zacznij" });
    await textReady;
    await chat.stop();
    await pending;
    chat.messages = markInterrupted(chat.messages, 100);
    assert.equal(serverAborted, true);
    assert.equal(chat.status, "ready");
    assert.ok(chat.messages[1].parts.some(p => p.type === "text" && p.text === "Gotowe ustalenie."));
    assert.equal(chat.messages[1].parts.at(-1).text, "Przerwane przez użytkownika");
    await chat.sendMessage({ text: "Kolejne pytanie" });
    assert.equal(chat.status, "ready", chat.error?.message);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = originalFetch; }
});
