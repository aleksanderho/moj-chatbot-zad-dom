import test from "node:test";
import assert from "node:assert/strict";
import { compareTravel, checkedRecommendation } from "../app/api/travel/compare.mjs";

const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(new Date());
const query = { miasto: "Berlin", drugieMiasto: "Rzym", dzien: day };
const json = value => new Response(JSON.stringify(value));
function fixture({ failCity = false, failWeather = false } = {}) {
  return async url => {
    const parsed = new URL(url);
    if (url.includes("geocoding")) {
      const rome = parsed.searchParams.get("name").includes("Rzym");
      if (rome && failCity) return json({});
      return json({ results: [{ name: rome ? "Rzym" : "Berlin", country: rome ? "Włochy" : "Niemcy", country_code: rome ? "IT" : "DE", timezone: rome ? "Europe/Rome" : "Europe/Berlin", latitude: rome ? 41 : 52, longitude: 13 }] });
    }
    if (url.includes("open-meteo")) {
      const rome = parsed.searchParams.get("latitude") === "41";
      if (rome && failWeather) throw new Error("source unavailable");
      return json({ daily: { time: [day], temperature_2m_min: [rome ? 15 : 4], temperature_2m_max: [rome ? 20 : 8], precipitation_sum: [rome ? 0 : 5], weather_code: [3] } });
    }
    if (url.includes("nbp")) return json({ code: "EUR", rates: [{ effectiveDate: day, mid: 4.2 }] });
    if (url.includes("nager")) return json([]);
    const title = url.includes("Rzym") ? "Rzym" : "Berlin";
    return json({ title, extract: `${title} to miasto. To opis miasta.` });
  };
}
function recommendation(reports) {
  return { wybor: "1", uzasadnienie: "Polecam Rzym na spacery, ponieważ prognoza wskazuje wyższe temperatury.", dowody: reports.map((report, index) => ({ miasto: String(index), karta: "weather", wartosc: report.cards[0].value })) };
}

test("dwa miasta, wspólna data, dziesięć kart i jedna rekomendacja z dowodami obu miast", async () => {
  let calls = 0;
  const result = await compareTravel(query, { fetcher: fixture(), recommend: async reports => { calls++; return recommendation(reports); } });
  assert.equal(result.reports.length, 2);
  assert.ok(result.reports.every(report => report.dzien === day && report.cards.length === 5));
  assert.equal(result.recommendation.city, "Rzym");
  assert.equal(result.recommendation.evidence.length, 2);
  assert.equal(calls, 1);
  assert.equal(result.notice, "");
  const fake = recommendation(result.reports);
  fake.dowody[0].wartosc = "Zmyślona prognoza 99 °C";
  assert.equal(checkedRecommendation(fake, result.reports), null);
});

test("brak jednego źródła nie usuwa pozostałych kart, nie wolno użyć go jako dowodu", async () => {
  const result = await compareTravel(query, { fetcher: fixture({ failWeather: true }), recommend: async reports => recommendation(reports) });
  assert.equal(result.reports[0].cards.filter(card => card.ok).length, 5);
  assert.equal(result.reports[1].cards.filter(card => card.ok).length, 4);
  assert.equal(result.recommendation, null);
  assert.match(result.notice, /Rzym.*Open-Meteo/);
});

test("nierozpoznane miasto nie blokuje drugiego, nie generuje pozornej rekomendacji", async () => {
  let calls = 0;
  const result = await compareTravel(query, { fetcher: fixture({ failCity: true }), recommend: async () => { calls++; return {}; } });
  assert.equal(result.reports[0].cards.filter(card => card.ok).length, 5);
  assert.ok(result.reports[1].cards.every(card => card.status === "Brak danych"));
  assert.equal(calls, 0);
  assert.equal(result.recommendation, null);
});

test("awaria modelu zachowuje obie kolumny; ponowne sprawdzenie pobiera świeże dane", async () => {
  let calls = 0;
  const base = fixture();
  const options = { fetcher: async url => { calls++; return base(url); }, recommend: async () => { throw new Error("model unavailable"); } };
  const first = await compareTravel(query, options);
  const count = calls;
  const second = await compareTravel(query, options);
  assert.ok(calls > count);
  assert.equal(first.reports.length, 2);
  assert.equal(second.recommendation, null);
  assert.match(second.notice, /Nie udało się przygotować rekomendacji/);
});
