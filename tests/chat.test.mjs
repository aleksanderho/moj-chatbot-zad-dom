import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../app/api/chat/route.ts";
import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

const user = (text, id = "u1") => ({ id, role: "user", parts: [{ type: "text", text }] });
const request = (messages) => new Request("http://localhost/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ messages }),
});

test("konfiguracja, walidacja, historia i strumień bez połączeń z modelem", async () => {
  // These values exist only in this test process. Never load .env files.
  process.env.OPENROUTER_API_KEY = "";
  process.env.OPENROUTER_MODEL = "";
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("Unexpected network request");
  };
  try {
    const missing = await POST(request([user("Cześć")]));
    assert.equal(missing.status, 503);
    assert.match(await missing.text(), /Brak konfiguracji/);
    assert.equal(calls, 0);

    process.env.OPENROUTER_API_KEY = "test-key-never-real";
    process.env.OPENROUTER_MODEL = "test/model";
    assert.equal((await POST(request([user("  ")]))).status, 400);
    assert.equal((await POST(request([]))).status, 400);
    assert.equal((await POST(request([{ ...user("x"), role: "system" }]))).status, 400);
    assert.equal(calls, 0);

    const history = [user("Mam na imię Ola."), {
      id: "a1", role: "assistant", parts: [{ type: "text", text: "Cześć, Olu!" }],
    }, user("Jak mam na imię?", "u2")];

    const sentHistories = [];
    globalThis.fetch = async (_url, options) => {
      calls++;
      const body = JSON.parse(options.body);
      assert.equal(body.model, "test/model");
      assert.equal(body.stream, true);
      sentHistories.push(body.messages);
      assert.ok(body.messages.some((message) => message.role === "user"));
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({
        async start(controller) {
          for (const text of ["Masz ", "na imię Ola."]) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              id: "reply", object: "chat.completion.chunk", created: 1, model: "test/model",
              choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }],
            })}\n\n`));
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            id: "reply", object: "chat.completion.chunk", created: 1, model: "test/model",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          })}\n\ndata: [DONE]\n\n`));
          controller.close();
        },
      }), { headers: { "Content-Type": "text/event-stream" } });
    };
    const streamed = await POST(request(history));
    assert.match(streamed.headers.get("content-type"), /text\/event-stream/);
    const output = await streamed.text();
    assert.match(output, /text-delta/);
    assert.match(output, /Masz /);
    assert.match(output, /na imię Ola/);
    assert.equal(calls, 1);
    assert.deepEqual(sentHistories[0].map(({ role }) => role), ["user", "assistant", "user"]);
    assert.match(JSON.stringify(sentHistories[0]), /Mam na imię Ola/);

    const chat = new Chat({
      transport: new DefaultChatTransport({
        api: "http://localhost/api/chat",
        fetch: async (url, options) => POST(new Request(url, options)),
      }),
    });
    await chat.sendMessage({ text: "Mam na imię Ola." });
    assert.equal(chat.status, "ready");
    assert.ok(chat.messages[1].parts.some((part) => part.type === "step-start"));
    await chat.sendMessage({ text: "Jak mam na imię?" });
    assert.equal(chat.status, "ready", chat.error?.message);
    assert.equal(chat.messages.length, 4);
    assert.deepEqual(sentHistories.at(-1).map(({ role }) => role), ["user", "assistant", "user"]);
    assert.match(JSON.stringify(sentHistories.at(-1)), /Mam na imię Ola/);

    for (const code of [400, 401, 402, 403, 404, 429, 502, 503]) {
      globalThis.fetch = async () => new Response(JSON.stringify({
        error: { message: "private-provider-details", code },
      }), { status: code, headers: { "Content-Type": "application/json" } });
      const failed = await POST(request([user("Cześć")]));
      const failure = await failed.text();
      assert.match(failure, /OpenRouter \(/);
      assert.ok(failure.includes(String(code)));
      assert.doesNotMatch(failure, /private-provider-details|test-key-never-real/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
