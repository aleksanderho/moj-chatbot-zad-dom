import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../app/api/documents/route.ts";
import { splitDocument } from "../lib/document-chunks.ts";
import { issueSession } from "../app/travel-session.mjs";

test("osobne akapity, CRLF, granice zdań i brak utraty treści", () => {
  assert.deepEqual(splitDocument(" Pierwszy.\r\n\r\nDrugi.\n \nTrzeci. "), ["Pierwszy.", "Drugi.", "Trzeci."]);
  const sentence = "To jest zdanie o cenie pakietu. ";
  const text = sentence.repeat(40).trim();
  const chunks = splitDocument(text);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(c => c.length <= 800 && c.endsWith(".")));
  assert.equal(chunks.join(" "), text);
  assert.deepEqual(splitDocument("a".repeat(900)), ["a".repeat(900)]);
  assert.deepEqual(splitDocument(" \n\n "), []);
});

test("sesja, limity, brak embeddingów, zapis i usunięcie po błędzie", async () => {
  process.env.TRAVEL_SESSION_SECRET = "test-session";
  process.env.SUPABASE_URL = "https://database.example.test";
  process.env.SUPABASE_SECRET_KEY = "test-secret";
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_EMBEDDING_MODEL;
  const original = globalThis.fetch;
  const calls = [];
  let failChunks = false, failCleanup = false;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url ?? String(input));
    assert.equal(url.hostname, "database.example.test", "Nie wolno wywoływać modelu");
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path: url.pathname, method: options.method, body });
    if (options.method === "DELETE") return failCleanup ? Response.json({message: "failure"}, {status: 400}) : new Response(null, { status: 204 });
    if (url.pathname.endsWith("/documents")) return Response.json({ id: 42 }, { status: 201 });
    return failChunks ? Response.json({ message: "failure" }, { status: 400 }) : new Response(null, { status: 201 });
  };
  const req = (body, session = true, origin = "http://localhost") => new Request("http://localhost/api/documents", { method: "POST", headers: { origin, ...(session ? { cookie: `travel_session=${issueSession()}` } : {}) }, body: typeof body === "string" ? body : JSON.stringify(body) });
  try {
    assert.equal((await POST(req("bad", false))).status, 401);
    assert.equal((await POST(req({}, true, "http://other.test"))).status, 403);
    for (const body of [{title:" ",text:"x"}, {title:"X",text:" "}, {title:"X",text:"a".repeat(20001)}]) assert.equal((await POST(req(body))).status, 400);
    assert.equal(calls.length, 0);
    const result = await POST(req({title:" Cennik ", text:"Jeden.\n\nDwa.\n\nTrzy."}));
    assert.equal(result.status, 201);
    assert.deepEqual(await result.json(), {documentId:42,title:"Cennik",chunks:3});
    assert.deepEqual(calls[1].body, ["Jeden.","Dwa.","Trzy."].map((content,chunk_index) => ({document_id:42,chunk_index,content})));
    calls.length=0; failChunks=true;
    assert.equal((await POST(req({title:"X",text:"Tekst"}))).status, 503);
    assert.deepEqual(calls.filter(c => c.method === "DELETE").map(c => c.path), ["/rest/v1/chunks","/rest/v1/documents"]);
    failCleanup=true;
    const failure = await POST(req({title:"X",text:"Tekst"}));
    assert.equal((await failure.json()).documentId,42);
  } finally { globalThis.fetch=original; }
});
