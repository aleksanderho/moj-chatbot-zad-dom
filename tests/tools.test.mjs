import test from "node:test";
import assert from "node:assert/strict";
import { aktualnyCzas, createTools, STEP_LIMIT } from "../app/api/chat/tools.mjs";

const make = (fetcher, owner = "test-a") => createTools({ model: "test/model", owner, fetcher });
const json = body => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
const run = (tools, name, args) => tools[name].execute(args);

test("aktualnyCzas: polska data po północy, dzień tygodnia i czas letni", async () => {
  assert.deepEqual(aktualnyCzas(new Date("2026-11-19T23:30:05Z")), {
    strefa: "Europe/Warsaw", data: "2026-11-20", dzienTygodnia: "piątek", godzina: "00:30:05",
  });
  assert.deepEqual(aktualnyCzas(new Date("2026-07-01T22:15:00Z")), {
    strefa: "Europe/Warsaw", data: "2026-07-02", dzienTygodnia: "czwartek", godzina: "00:15:00",
  });
  const result = await run(make(() => { throw new Error("network forbidden"); }), "aktualnyCzas", {});
  assert.equal(result.ok, true);
  assert.equal(result.strefa, "Europe/Warsaw");
  assert.match(result.data, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(result.godzina, /^\d{2}:\d{2}:\d{2}$/);
});

test("kalkulator: liczby, zero, przepełnienie, odrzucenie kodu", async () => {
  const tools = make(() => { throw new Error("network forbidden"); });
  assert.equal((await run(tools, "kalkulator", { dzialanie: "pomnoz", a: 12, b: 3 })).wynik, 36);
  assert.equal((await run(tools, "kalkulator", { dzialanie: "podziel", a: 12, b: 0 })).ok, false);
  assert.equal((await run(tools, "kalkulator", { dzialanie: "potega", a: 1e300, b: 20 })).ok, false);
  assert.equal((await run(tools, "kalkulator", { dzialanie: "dodaj", a: "process.exit()", b: 2 })).ok, false);
});

test("czas i diagnostyka: poprawna strefa, błąd, konfiguracja bez sekretów", async () => {
  const tools = make();
  assert.equal((await run(tools, "czas", { strefa: "Europe/Warsaw" })).ok, true);
  assert.equal((await run(tools, "czas", { strefa: "Nie/Ma" })).ok, false);
  const data = await run(tools, "diagnostyka", {});
  assert.equal(data.model, "test/model");
  assert.equal(data.limitKrokow, STEP_LIMIT);
  assert.equal(data.narzedzia.length, 9);
  assert.ok(Object.values(data.konfiguracja).every(x => x === "tak" || x === "nie"));
  assert.ok(!Number.isNaN(Date.parse(data.fetchedAt)));
});

test("notatki: zapis, odczyt, oddzielenie użytkowników", async () => {
  const a = make(undefined, "notes-a");
  const b = make(undefined, "notes-b");
  await run(a, "notatki", { akcja: "zapisz", tresc: "Zadzwoń jutro" });
  assert.equal((await run(a, "notatki", { akcja: "pokaz" })).notatki[0].tresc, "Zadzwoń jutro");
  assert.deepEqual((await run(b, "notatki", { akcja: "pokaz" })).notatki, []);
});

test("NBP: fallback A → B, data publikacji, oba kierunki, brak waluty", async () => {
  const urls = [];
  const tools = make(async url => {
    urls.push(url);
    return url.includes("/a/") ? new Response(null, { status: 404 }) : json({ code: "XYZ", rates: [{ effectiveDate: "2026-11-13", mid: 4 }] });
  });
  assert.equal((await run(tools, "waluty", { waluta: "xyz", kwota: 10, kierunek: "do_PLN" })).wynik, 40);
  const result = await run(tools, "waluty", { waluta: "xyz", kwota: 10, kierunek: "z_PLN" });
  assert.equal(result.wynik, 2.5);
  assert.equal(result.dataKursu, "2026-11-13");
  assert.equal(urls.length, 4);
  assert.equal((await run(make(async () => new Response(null, { status: 404 })), "waluty", { waluta: "ZZZ", kwota: 10, kierunek: "do_PLN" })).ok, false);
});

test("pogoda: geokodowanie, data, jednostki, brak miasta", async () => {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(new Date());
  const tools = make(async url => url.includes("geocoding") ? json({ results: [{ name: "Warszawa", latitude: 52, longitude: 21, timezone: "Europe/Warsaw" }] }) : json({ daily: { time: [day], temperature_2m_min: [2], temperature_2m_max: [8], precipitation_sum: [1], weather_code: [3] } }));
  const result = await run(tools, "pogoda", { miasto: "Warszawa", dzien: day });
  assert.equal(result.maxC, 8);
  assert.equal(result.opadMm, 1);
  assert.equal((await run(tools, "pogoda", { miasto: "Warszawa", dzien: "2020-01-01" })).ok, false);
  assert.equal((await run(make(async () => json({})), "pogoda", { miasto: "NieMa", dzien: day })).ok, false);
});

test("święta: wyłącznie Public, zachowanie regionów; Wikipedia: streszczenie i link", async () => {
  const tools = make(async url => url.includes("nager") ? json([
    { date: "2026-01-01", localName: "Nowy Rok", global: true, counties: null, types: ["Public"] },
    { date: "2026-01-02", localName: "Regionalne", global: false, counties: ["XX-A"], types: ["Public"] },
    { date: "2026-01-03", localName: "Szkolne", global: true, counties: null, types: ["School"] },
  ]) : json({ title: "Łódź", extract: "Miasto w Polsce.", type: "standard" }));
  const result = await run(tools, "swieta", { kraj: "pl", rok: 2026 });
  assert.equal(result.swieta.length, 2);
  assert.deepEqual(result.swieta[1].regiony, ["XX-A"]);
  const wiki = await run(tools, "wikipedia", { haslo: "Łódź" });
  assert.equal(wiki.streszczenie, "Miasto w Polsce.");
  assert.match(wiki.sourceUrl, /^https:\/\/pl.wikipedia.org\/wiki\//);
});

test("API: awaria, timeout, niepoprawna odpowiedź i brak hasła to polskie komunikaty", async () => {
  for (const fetcher of [async () => { throw new Error("secret provider detail"); }, async () => { throw new DOMException("timeout", "TimeoutError"); }, async () => json({ unexpected: true }), async () => new Response(null, { status: 404 })]) {
    const result = await run(make(fetcher), "wikipedia", { haslo: "NieMa" });
    assert.equal(result.ok, false);
    assert.ok(result.message.length > 10);
    assert.ok(!JSON.stringify(result).includes("secret provider detail"));
    assert.ok(result.fetchedAt);
  }
});
