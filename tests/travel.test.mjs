import test from "node:test";
import assert from "node:assert/strict";
import { currencyCodes, firstSentences, travelReport } from "../app/api/travel/travel.mjs";
import { timeDifferenceMinutes } from "../app/api/chat/tools.mjs";
import { POST } from "../app/api/travel/route.ts";
import { POST as sessionPOST } from "../app/api/travel/session/route.ts";
import { validSession, sameOrigin } from "../app/travel-session.mjs";

test("sesja: brak lub fałszywa sesja daje 401 przed wywołaniem źródeł i modelu", async () => {
  assert.equal(sameOrigin(new Request("http://localhost:3000/api/travel", { headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" } })), true);
  const previous = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Nie wolno wywołać źródła bez sesji"); };
  try {
    for (const cookie of ["", "travel_session=fake"]) {
      const response = await POST(new Request("http://localhost/api/travel", { method: "POST", headers: { cookie }, body: "{}" }));
      assert.equal(response.status, 401);
    }
    const session = await sessionPOST(new Request("http://localhost/api/travel/session", { method: "POST" }));
    const cookie = session.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly; SameSite=Strict/);
    assert.equal(validSession(new Request("http://localhost", { headers: { cookie } })), true);
    const response = await POST(new Request("http://localhost/api/travel", { method: "POST", headers: { cookie }, body: JSON.stringify({ miasto: "x", dzien: "bad" }) }));
    assert.equal(response.status, 400);
    const crossOrigin = await sessionPOST(new Request("http://localhost/api/travel/session", { method: "POST", headers: { origin: "https://other.example" } }));
    assert.equal(crossOrigin.status, 403);
  } finally { globalThis.fetch = previous; }
});

test("waluta kraju i różnice czasu uwzględniają DST, ułamkowe strefy i zmianę dnia", () => {
  assert.deepEqual(currencyCodes("DE"), ["EUR"]);
  assert.deepEqual(currencyCodes("PL"), ["PLN"]);
  assert.equal(timeDifferenceMinutes("Asia/Kolkata", new Date("2026-01-15T23:00:00Z")), 270);
  assert.equal(timeDifferenceMinutes("Asia/Kolkata", new Date("2026-07-15T23:00:00Z")), 210);
  assert.equal(timeDifferenceMinutes("America/New_York", new Date("2026-01-15T01:00:00Z")), -360);
  assert.equal(firstSentences("Pierwsze zdanie. Drugie zdanie. Trzecie zdanie."), "Pierwsze zdanie. Drugie zdanie.");
});

test("pięć wspólnych narzędzi, najbliższe święta, źródła, jednostki, odświeżanie i częściowe wyniki", async () => {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
  let requests = 0;
  let weatherFailed = false;
  const json = body => new Response(JSON.stringify(body));
  const fetcher = async url => {
    requests++;
    if (url.includes("geocoding")) return json({ results: [{ name: "Berlin", country: "Niemcy", country_code: "DE", latitude: 52.5, longitude: 13.4, timezone: "Europe/Berlin" }] });
    if (url.includes("open-meteo")) {
      if (weatherFailed) throw new Error("weather unavailable");
      return json({ daily: { time: [day], temperature_2m_min: [5], temperature_2m_max: [9], precipitation_sum: [2], weather_code: [3] } });
    }
    if (url.includes("nbp")) return json({ code: "EUR", rates: [{ effectiveDate: day, mid: 4.25 }] });
    if (url.includes("nager")) return json([{ date: day, localName: "Dzień świąteczny", global: true, counties: null, types: ["Public"] }]);
    return json({ title: "Berlin", extract: "Berlin jest miastem. Leży w Niemczech. To trzecie zdanie.", type: "standard" });
  };
  let summaryCalls = 0;
  const summarize = async data => { summaryCalls++; assert.equal(data.cards.length, 5); return "Spakuj kurtkę. Sprawdź godziny otwarcia."; };
  const first = await travelReport({ miasto: "Berlin", dzien: day }, { fetcher, summarize });
  assert.equal(first.cards.length, 5);
  assert.ok(first.cards.every(card => card.ok && card.fetchedAt && card.sourceName));
  assert.match(first.cards[0].value, /°C/);
  assert.match(first.cards[1].value, /EUR.*PLN/);
  assert.equal(first.cards[3].value, "Berlin jest miastem. Leży w Niemczech.");
  assert.equal(first.summaryByAI, true);
  const count = requests;
  await new Promise(resolve => setTimeout(resolve, 5));
  weatherFailed = true;
  const second = await travelReport({ miasto: "Berlin", dzien: day }, { fetcher, summarize: async () => null });
  assert.ok(requests > count);
  assert.equal(second.cards[0].ok, false);
  assert.equal(second.cards[0].status, "Brak danych");
  assert.equal(second.cards[0].value, "Brak danych — spróbuj odświeżyć");
  assert.deepEqual(second.cards[0].details, []);
  assert.match(second.summary, /Open-Meteo \(Pogoda\)/);
  assert.equal(second.cards[1].ok, true);
  assert.notEqual(second.cards[1].fetchedAt, first.cards[1].fetchedAt);
  assert.equal(second.summaryByAI, false);
  assert.equal(summaryCalls, 1);
});

for (const [host, failedId, source] of [
  ["api.open-meteo.com", "weather", "Open-Meteo"],
  ["api.nbp.pl", "currency", "NBP"],
  ["date.nager.at", "holidays", "Nager.Date"],
  ["pl.wikipedia.org", "wikipedia", "Wikipedia"],
]) {
  test(`awaria ${source}: jedna karta bez danych, cztery OK i jawny brak źródła w podsumowaniu`, async () => {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
    const json = value => new Response(JSON.stringify(value));
    const fetcher = async url => {
      if (new URL(url).host === host) throw new Error("source unavailable");
      if (url.includes("geocoding")) return json({ results: [{ name: "Berlin", country: "Niemcy", country_code: "DE", latitude: 52, longitude: 13, timezone: "Europe/Berlin" }] });
      if (url.includes("open-meteo")) return json({ daily: { time: [day], temperature_2m_min: [4], temperature_2m_max: [9], precipitation_sum: [1], weather_code: [3] } });
      if (url.includes("nbp")) return json({ code: "EUR", rates: [{ effectiveDate: day, mid: 4.25 }] });
      if (url.includes("nager")) return json([]);
      return json({ title: "Berlin", extract: "Berlin jest miastem. Leży w Niemczech." });
    };
    const result = await travelReport({ miasto: "Berlin", dzien: day }, {
      fetcher,
      summarize: async data => {
        assert.ok(data.missingSources.some(name => name.includes(source)));
        // Even if AI omits the missing source, the server must name it.
        return "Podróż wymaga przygotowania. Zaplanuj wyjazd.";
      },
    });
    assert.equal(result.cards.filter(card => card.status === "OK").length, 4);
    const missing = result.cards.find(card => card.id === failedId);
    assert.equal(missing.status, "Brak danych");
    assert.equal(missing.value, "Brak danych — spróbuj odświeżyć");
    assert.deepEqual(missing.details, []);
    assert.ok(result.summary.startsWith("Nie udało się uzyskać danych ze źródeł:"));
    assert.ok(result.summary.includes(source));
    assert.ok(!JSON.stringify(result.cards).includes("NaN"));
  });
}

test("niepełna odpowiedź API nie zamienia się w pozornie poprawną wartość", async () => {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
  const json = data => new Response(JSON.stringify(data));
  const result = await travelReport({ miasto: "Berlin", dzien: day }, {
    fetcher: async url => url.includes("geocoding")
      ? json({ results: [{ name: "Berlin", country_code: "DE", latitude: 52, longitude: 13, timezone: "Europe/Berlin" }] })
      : json({}),
    summarize: async () => { throw new Error("model unavailable"); },
  });
  assert.equal(result.cards.filter(card => card.ok).length, 1);
  assert.equal(result.cards.find(card => card.id === "time").status, "OK");
  assert.match(result.summary, /Open-Meteo.*NBP.*Nager.Date.*Wikipedia/);
  assert.match(result.summary, /Podsumowanie AI jest niedostępne/);
});
