import test from "node:test";
import assert from "node:assert/strict";
import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { chatPOST as POST } from "./agent-fixtures.mjs";

test("wyszukiwanie native: konfiguracja, źródła i trwały czas pobrania docierają do klienta", async () => {
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.OPENROUTER_MODEL = "test/model";
  const previous = globalThis.fetch;
  let sent;
  const before = Date.now();
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(options.body);
    const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
      id: "reply", object: "chat.completion.chunk", created: 1, model: "test/model",
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`;
    return new Response(chunk({ content: "Aktualne informacje", annotations: [
      { type: "url_citation", url_citation: { url: "https://example.com/news", title: "Aktualności" } },
      { type: "url_citation", url_citation: { url: "https://example.org/prices" } },
    ] }) + chunk({}, "stop") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
  };
  try {
    const chat = new Chat({ transport: new DefaultChatTransport({ api: "http://localhost/api/agent", fetch: async (url, options) => POST(new Request(url, options)) }) });
    await chat.sendMessage({ text: "Sprawdź aktualne informacje" });
    assert.equal(chat.status, "ready", chat.error?.message);
    const sources = chat.messages[1].parts.filter(part => part.type === "source-url");
    assert.equal(sources.length, 2);
    assert.equal(sources[0].title, "Aktualności");
    assert.equal(sources[0].url, "https://example.com/news");
    for (const source of sources) {
      const fetchedAt = Date.parse(chat.messages[1].metadata.sourcesFetchedAt[source.sourceId]);
      assert.ok(fetchedAt >= before && fetchedAt <= Date.now());
    }
    assert.ok(sent.tools.some(tool => tool.type === "openrouter:web_search" && tool.max_results === 3 && tool.engine === "native"), JSON.stringify(sent.tools));
    await chat.sendMessage({ text: "Dziękuję" });
    assert.equal(chat.status, "ready", chat.error?.message);
    assert.ok(chat.messages[1].metadata.sourcesFetchedAt[sources[0].sourceId]);
  } finally { globalThis.fetch = previous; }
});
