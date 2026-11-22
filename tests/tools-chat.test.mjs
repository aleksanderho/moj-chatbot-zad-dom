import test from "node:test";
import assert from "node:assert/strict";
import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { POST as agentPOST } from "../app/api/agent/route.ts";
import { issueSession } from "../app/travel-session.mjs";
import { randomUUID } from "node:crypto";

const conversationIds = new Map();
async function POST(request) {
  const body = await request.json();
  // AI SDK utrzymuje id czatu między wiadomościami; serwer wymaga osobnego UUID.
  const chatId = body.id ?? randomUUID();
  if (!conversationIds.has(chatId)) conversationIds.set(chatId, randomUUID());
  return agentPOST(new Request(request.url, {
    method: "POST", signal: request.signal,
    headers: { cookie: `travel_session=${issueSession()}; chat_owner=${"a".repeat(64)}` },
    body: JSON.stringify({ ...body, mode: "chat", conversationId: conversationIds.get(chatId) }),
  }));
}

test("narzędzia w strumieniu, wynik dla modelu, kolejna wiadomość i limit 5 kroków", async () => {
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.OPENROUTER_MODEL = "test/model";
  process.env.SUPABASE_URL = "https://database.example.test";
  process.env.SUPABASE_SECRET_KEY = "test-secret";
  const conversations = [];
  const messages = [];
  const previous = globalThis.fetch;
  let calls = 0;
  let repeat = false;
  let batch = false;
  let failTool = false;
  const bodies = [];
  globalThis.fetch = async (_url, options = {}) => {
    const url = new URL(typeof _url === "string" ? _url : _url.url ?? String(_url));
    if (url.hostname === "database.example.test") {
      const table = url.pathname.split("/").at(-1);
      if (table === "user_profiles") return Response.json({ id: 1, name: null, preferences: {} });
      const records = table === "conversations" ? conversations : messages;
      if (options.method === "POST") {
        const body = JSON.parse(options.body);
        for (const row of Array.isArray(body) ? body : [body]) records.push({ ...row, position: records.length + 1 });
        return new Response(null, { status: 201 });
      }
      const selected = records.filter(row => [...url.searchParams].every(([key, value]) => !value.startsWith("eq.") || String(row[key]) === value.slice(3)));
      return Response.json(table === "conversations" ? selected[0] ?? null : selected);
    }
    assert.equal(url.hostname, "openrouter.ai");
    const body = JSON.parse(options.body);
    bodies.push(body);
    calls++;
    const useTool = repeat ? body.tool_choice !== "none" : calls === 1;
    const delta = useTool ? { tool_calls: Array.from({ length: batch ? 5 : 1 }, (_, index) => ({ index, id: `call-${calls}-${index}`, type: "function", function: { name: "kalkulator", arguments: JSON.stringify({ dzialanie: failTool ? "podziel" : "pomnoz", a: 12, b: failTool ? 0 : 3 }) } })) } : { content: "Wynik: 36" };
    const chunk = (delta, finish_reason) => `data: ${JSON.stringify({ id: "reply", object: "chat.completion.chunk", created: 1, model: "test/model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    return new Response(chunk(delta, null) + chunk({}, useTool ? "tool_calls" : "stop") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
  };
  try {
    const chat = new Chat({ transport: new DefaultChatTransport({ api: "http://localhost/api/agent", fetch: async (url, options) => POST(new Request(url, options)) }) });
    await chat.sendMessage({ text: "Oblicz 12 razy 3" });
    assert.equal(chat.status, "ready", chat.error?.message);
    assert.equal(calls, 2);
    assert.equal(chat.messages[1].metadata.steps, 2);
    assert.equal(chat.messages[1].metadata.toolCalls, 1);
    assert.ok(!JSON.stringify(chat.messages[1]).includes("Przerwałem po"));
    assert.ok(chat.messages[1].parts.some(p => p.type === "tool-kalkulator" && p.state === "output-available" && p.output.wynik === 36));
    assert.ok(bodies[1].messages.some(m => m.role === "tool" && m.content.includes('"wynik":36')));
    await chat.sendMessage({ text: "Dziękuję" });
    assert.equal(chat.status, "ready", chat.error?.message);
    assert.equal(calls, 3);
    repeat = true;
    calls = 0;
    const response = await POST(new Request("http://localhost/api/agent", { method: "POST", body: JSON.stringify({ messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "Licz dalej" }] }] }) }));
    const stream = await response.text();
    assert.equal(calls, 5);
    assert.match(stream, /Przerwałem po 5 krokach/);
    assert.match(stream, /wynik/);
    assert.match(stream, /36/);
    assert.equal((stream.match(/"type":"start-step"/g) ?? []).length, 5);
    assert.match(response.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
    calls = 0;
    const limitedChat = new Chat({ transport: new DefaultChatTransport({ api: "http://localhost/api/agent", fetch: async (url, options) => POST(new Request(url, options)) }) });
    await limitedChat.sendMessage({ text: "Licz dalej" });
    assert.equal(limitedChat.status, "ready", limitedChat.error?.message);
    assert.equal(calls, 5);
    const parts = limitedChat.messages[1].parts;
    assert.equal(parts.filter(p => p.type === "step-start").length, 5);
    assert.equal(parts.filter(p => p.type === "tool-kalkulator").length, 5);
    assert.ok(parts.some(p => p.type === "text" && p.text.includes("Przerwałem po 5 krokach") && p.text.includes("36")));
    calls = 0;
    repeat = false;
    await limitedChat.sendMessage({ text: "Dziękuję" });
    assert.equal(limitedChat.status, "ready", limitedChat.error?.message);
    assert.equal(calls, 2);
    repeat = true;
    batch = true;
    calls = 0;
    const batchChat = new Chat({ transport: new DefaultChatTransport({ api: "http://localhost/api/agent", fetch: async (url, options) => POST(new Request(url, options)) }) });
    await batchChat.sendMessage({ text: "Wiele obliczeń" });
    assert.equal(batchChat.status, "ready", batchChat.error?.message);
    assert.equal(calls, 4);
    assert.equal(batchChat.messages[1].metadata.toolCalls, 16);
    assert.equal(batchChat.messages[1].metadata.steps, 4);
    assert.ok(batchChat.messages[1].parts.some(p => p.type === "text" && p.text.includes("16 wywołaniach")));
    batch = false;
    failTool = true;
    calls = 0;
    const failedChat = new Chat({ transport: new DefaultChatTransport({ api: "http://localhost/api/agent", fetch: async (url, options) => POST(new Request(url, options)) }) });
    await failedChat.sendMessage({ text: "Dziel przez zero" });
    assert.equal(failedChat.status, "ready", failedChat.error?.message);
    assert.equal(calls, 1);
    assert.equal(failedChat.messages[1].metadata.toolCalls, 1);
    assert.ok(failedChat.messages[1].parts.some(p => p.type === "text" && p.text.includes("wynikiem częściowym") && p.text.includes("Nie można dzielić przez zero")));
  } finally { globalThis.fetch = previous; }
});

