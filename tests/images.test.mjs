import test from "node:test";
import assert from "node:assert/strict";
import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { chatPOST } from "./agent-fixtures.mjs";
import { imagePartSchema, MAX_IMAGE_BYTES } from "../app/api/chat/image-input.mjs";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const photo = { type: "file", mediaType: "image/png", filename: "test.png", url: "data:image/png;base64," + png };

test("vision: format, sygnatura pliku, limit 4 MB i zakaz pobierania zdalnych URL", () => {
  assert.equal(imagePartSchema.safeParse(photo).success, true);
  for (const part of [
    { ...photo, url: "https://example.org/image.png" },
    { ...photo, mediaType: "image/svg+xml" },
    { ...photo, mediaType: "image/jpeg" },
    { ...photo, url: "data:image/png;base64,aGVsbG8=" },
  ]) assert.equal(imagePartSchema.safeParse(part).success, false);
  const boundary = Buffer.alloc(MAX_IMAGE_BYTES);
  Buffer.from(png, "base64").copy(boundary);
  assert.equal(imagePartSchema.safeParse({ ...photo, url: `data:image/png;base64,${boundary.toString("base64")}` }).success, true);
  assert.equal(imagePartSchema.safeParse({ ...photo, url: `data:image/png;base64,${Buffer.concat([boundary, Buffer.from([0])]).toString("base64")}` }).success, false);
});

test("vision: plik trafia do modelu, miniatura pozostaje w historii, ID pochodzi ze strumienia API", async () => {
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.OPENROUTER_MODEL = "test/requested-vision-model";
  const previous = globalThis.fetch;
  const sent = [];
  let omitModel = false;
  globalThis.fetch = async (_url, options) => {
    sent.push(JSON.parse(options.body));
    const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: "reply", object: "chat.completion.chunk", created: 1,
      ...(omitModel ? {} : { model: "test/actual-vision-model" }),
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`;
    return new Response(chunk({ content: "Widzę zdjęcie." }) + chunk({}, "stop") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
  };
  try {
    const chat = new Chat({ transport: new DefaultChatTransport({ api: "http://localhost/api/agent", fetch: async (url, options) => chatPOST(new Request(url, options)) }) });
    await chat.sendMessage({ text: "Co widzisz?", files: [photo] });
    assert.equal(chat.status, "ready", chat.error?.message);
    assert.ok(chat.messages[0].parts.some(part => part.type === "file" && part.url === photo.url));
    const user = sent[0].messages.at(-1);
    assert.ok(user.content.some(part => part.type === "image_url" && part.image_url.url === photo.url));
    assert.equal(chat.messages[1].metadata.modelId, "test/actual-vision-model");
    assert.equal(chat.messages[1].metadata.vision, true);
    await chat.sendMessage({ text: "Co jeszcze?" });
    assert.equal(chat.status, "ready", chat.error?.message);
    assert.ok(sent[1].messages.some(message => message.role === "user" && Array.isArray(message.content) && message.content.some(part => part.type === "image_url")));
    omitModel = true;
    const noModelChat = new Chat({ transport: new DefaultChatTransport({ api: "http://localhost/api/agent", fetch: async (url, options) => chatPOST(new Request(url, options)) }) });
    await noModelChat.sendMessage({ text: "Co widzisz?", files: [photo] });
    assert.equal(noModelChat.status, "ready", noModelChat.error?.message);
    assert.equal(noModelChat.messages[1].metadata.modelId, undefined);
    assert.equal(noModelChat.messages[1].metadata.vision, true);
    const invalid = await chatPOST(new Request("http://localhost/api/agent", { method: "POST", body: JSON.stringify({ messages: [{ id: "u", role: "user", parts: [{ ...photo, url: "https://example.org/photo.png" }] }] }) }));
    assert.equal(invalid.status, 400);
    assert.equal(sent.length, 3);
  } finally { globalThis.fetch = previous; }
});
