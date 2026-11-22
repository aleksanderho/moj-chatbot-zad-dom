import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../app/api/agent/route.ts";
import { GET } from "../app/api/conversations/route.ts";
import { issueSession } from "../app/travel-session.mjs";
import { messageText } from "../lib/chat-store.ts";

test("zapis pary, odczyt, ponowienie, nowa rozmowa, izolacja i błędy", async () => {
  process.env.SUPABASE_URL = "https://database.example.test";
  process.env.SUPABASE_SECRET_KEY = "test-secret";
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.OPENROUTER_MODEL = "test/model";
  const originalFetch = globalThis.fetch;
  const conversations = [];
  const rows = [];
  let calls = 0, modelCalls = 0, writes = 0, failSave = false;
  const json = (value, init) => Response.json(value, init);
  globalThis.fetch = async (input, options = {}) => {
    calls++;
    const url = new URL(typeof input === "string" ? input : input.url ?? String(input));
    if (url.hostname !== "database.example.test") {
      modelCalls++;
      const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: "reply", object: "chat.completion.chunk", model: "test/model", created: 1, choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
      return new Response(chunk({ role: "assistant", content: "Dzień " }) + chunk({ content: "dobry!" }) + chunk({}, "stop") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
    }
    const table = url.pathname.split("/").at(-1);
    const records = table === "conversations" ? conversations : rows;
    if (options.method === "POST") {
      const body = JSON.parse(options.body);
      if (table === "messages") {
        writes++;
        if (failSave) return json({ code: "test", message: "save failed" }, { status: 400 });
        assert.equal(body.length, 2);
        assert.deepEqual(body.map(row => row.role), ["user", "assistant"]);
        assert.equal(body[1].content, "Dzień dobry!");
        for (const row of body) if (!rows.some(existing => existing.id === row.id)) rows.push({ ...row, position: rows.length + 1 });
      } else conversations.push(body);
      return new Response(null, { status: 201 });
    }
    let selected = records.filter(row => [...url.searchParams].every(([key, value]) => !value.startsWith("eq.") || String(row[key]) === value.slice(3)));
    if (table === "conversations" && url.searchParams.has("order")) selected = selected.toReversed();
    if (url.searchParams.has("limit")) selected = selected.slice(0, Number(url.searchParams.get("limit")));
    return json(selected);
  };
  try {
    const anonymous = new Request("http://localhost/api/conversations");
    assert.equal((await GET(anonymous)).status, 401);
    assert.equal((await POST(new Request("http://localhost/api/agent", { method: "POST", body: "bad json" }))).status, 401);
    assert.equal(calls, 0);

    let cookie = `travel_session=${issueSession()}`;
    const load = () => GET(new Request("http://localhost/api/conversations", { headers: { cookie } }));
    const initial = await load();
    assert.equal((await initial.json()).conversation, null);
    cookie += `; ${initial.headers.get("set-cookie").split(";")[0]}`;
    const firstId = "00000000-0000-4000-8000-000000000001";
    const secondId = "00000000-0000-4000-8000-000000000002";
    const send = (conversationId, id = "u1", extraParts = []) => POST(new Request("http://localhost/api/agent", {
      method: "POST", headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "chat", conversationId, messages: [{ id, role: "user", parts: [{ type: "text", text: "Cześć" }, ...extraParts] }] }),
    }));
    const response = await send(firstId);
    assert.equal(response.status, 200);
    const output = await response.text();
    assert.match(output, /reply-u1/);
    assert.equal(writes, 1);
    assert.equal(rows.length, 2);
    const restored = (await (await load()).json()).conversation;
    assert.equal(restored.id, firstId);
    assert.deepEqual(restored.messages.map(message => message.parts[0].text), ["Cześć", "Dzień dobry!"]);
    await (await send(firstId)).text();
    assert.equal(rows.length, 2);
    assert.equal(modelCalls, 1);
    assert.equal(writes, 1);
    await (await send(secondId)).text();
    assert.equal(conversations.length, 2);
    assert.equal(rows.length, 4);
    assert.equal((await (await load()).json()).conversation.id, secondId);

    const ownerCookie = cookie;
    cookie = `travel_session=${issueSession()}; chat_owner=${"b".repeat(64)}`;
    assert.equal((await (await load()).json()).conversation, null);
    assert.equal((await send(firstId)).status, 503);
    assert.equal(modelCalls, 2);
    cookie = ownerCookie;
    failSave = true;
    const failed = await (await send(secondId, "u2")).text();
    assert.match(failed, /Nie udało się odczytać lub zapisać rozmowy/);
    assert.equal(rows.length, 4);
    assert.equal(messageText({ id: "image", role: "assistant", parts: [
      { type: "text", text: "Gotowe" },
      { type: "file", mediaType: "image/png", url: "data:image/png;base64,SECRET" },
      { type: "tool-generujObraz", output: { ok: true, url: "data:image/png;base64,SECRET" } },
    ] }), "Gotowe\n[obraz]\n[obraz]");
  } finally { globalThis.fetch = originalFetch; }
});
