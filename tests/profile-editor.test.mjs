import test from "node:test";
import assert from "node:assert/strict";
import { GET, PATCH, DELETE } from "../app/api/profile/route.ts";
import { issueSession } from "../app/travel-session.mjs";

test("edycja profilu: sesja, jeden wiersz i zachowanie równoległego zapisu", async () => {
  process.env.SUPABASE_URL = "https://database.example.test";
  process.env.SUPABASE_SECRET_KEY = "test-only";
  process.env.TRAVEL_SESSION_SECRET = "test-only";
  const realFetch = globalThis.fetch;
  const profile = { name: "Ola", preferences: { miasto: "Warszawa" } };
  let calls = 0, simulateConcurrentWrite = true;
  globalThis.fetch = async (input, options) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("id"), "eq.1");
    assert.notEqual(options.method, "POST", "Nie wolno tworzyć drugiego profilu");
    if (options.method === "PATCH") {
      const body = JSON.parse(options.body);
      if (body.preferences && simulateConcurrentWrite) {
        simulateConcurrentWrite = false;
        profile.preferences.hobby = "rower";
        return Response.json([]);
      }
      if (url.searchParams.has("preferences")) assert.deepEqual(JSON.parse(url.searchParams.get("preferences").slice(3)), profile.preferences);
      Object.assign(profile, body);
    }
    return Response.json(new Headers(options.headers).get("accept")?.includes("vnd.pgrst.object") ? profile : [profile]);
  };
  const request = (method, body, origin) => new Request("http://localhost/api/profile", {
    method, headers: { cookie: `travel_session=${issueSession()}`, ...(origin ? { origin } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  try {
    for (const handler of [GET, PATCH, DELETE]) assert.equal((await handler(new Request("http://localhost/api/profile"))).status, 401);
    assert.equal((await PATCH(request("PATCH", { kind: "name", value: "Anna" }, "https://other.example"))).status, 403);
    assert.equal(calls, 0);
    assert.equal((await PATCH(request("PATCH", { kind: "name", value: "Alicja" }))).status, 200);
    assert.equal(profile.name, "Alicja");
    assert.equal(profile.preferences.miasto, "Warszawa");
    assert.equal((await PATCH(request("PATCH", { kind: "preference", key: "miasto", value: "Kraków" }))).status, 200);
    assert.deepEqual(profile.preferences, { miasto: "Kraków", hobby: "rower" });
    assert.equal((await PATCH(request("PATCH", { kind: "preference", key: "miasto", value: null }))).status, 200);
    assert.deepEqual(profile.preferences, { hobby: "rower" });
    const before = calls;
    assert.equal((await PATCH(request("PATCH", { kind: "name", value: "password-secret" }))).status, 400);
    assert.equal(calls, before);
    assert.equal((await DELETE(request("DELETE"))).status, 200);
    assert.deepEqual(profile, { name: null, preferences: {} });
  } finally { globalThis.fetch = realFetch; }
});
