import test from "node:test";
import assert from "node:assert/strict";
import { issueSession, validSession } from "../app/travel-session.mjs";
import { POST } from "../app/api/travel/session/route.ts";

test("stały sekret utrzymuje sesję między instancjami; zmiana sekretu unieważnia cookie", async () => {
  process.env.TRAVEL_SESSION_SECRET = "test-secret-only-not-a-real-credential";
  const token = issueSession();
  const request = new Request("https://example.test/api/travel", { headers: { cookie: `travel_session=${token}` } });
  delete globalThis[Symbol.for("i-sofa.travel-session-key")];
  const otherInstance = await import("../app/travel-session.mjs?other-instance");
  assert.equal(otherInstance.validSession(request), true);
  process.env.TRAVEL_SESSION_SECRET = "another-test-secret";
  assert.equal(validSession(request), false);
});

test("Vercel bez sekretów: czytelne 503 zamiast losowego klucza na każdej instancji", async () => {
  process.env.VERCEL = "1";
  process.env.TRAVEL_SESSION_SECRET = "";
  process.env.OPENROUTER_API_KEY = "";
  const response = await POST(new Request("https://example.test/api/travel/session", { method: "POST" }));
  assert.equal(response.status, 503);
  process.env.OPENROUTER_API_KEY = "test-openrouter-key-only";
  const ready = await POST(new Request("https://example.test/api/travel/session", { method: "POST" }));
  assert.equal(ready.status, 200);
  assert.match(ready.headers.get("set-cookie"), /Secure/);
});
