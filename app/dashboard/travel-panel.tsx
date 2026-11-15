"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

type Card = { id: string; title: string; value: string; details: string[]; sourceName: string; sourceUrl?: string; fetchedAt: string; ok: boolean; status: "OK" | "Brak danych" };
type Report = { location: { name: string; country: string }; dzien: string; cards: Card[]; summary: string; summaryByAI: boolean };
type Comparison = { reports: Report[]; dzien: string; recommendation: { city: string; explanation: string; evidence: { city: string; card: string; value: string }[] } | null; notice: string };
const titles = ["Pogoda", "Waluty", "Święta", "O mieście", "Czas na miejscu"];

function TravelCards({ report, busy, error }: { report: Report | null; busy: boolean; error: string }) {
  const timestamp = (value: string) => new Date(value).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return <div className="trip-grid" aria-busy={busy}>
    {report && !busy ? report.cards.map((card, index) => <article className={`trip-card ${card.ok ? "" : "trip-card-error"}`} key={card.id}>
      <div className="trip-card-heading"><span className="card-number">0{index + 1}</span><h3>{card.title}</h3><span className={`trip-status ${card.ok ? "status-ok" : ""}`}>{card.status}</span></div>
      <p className={`trip-value ${card.id === "wikipedia" ? "trip-description" : ""}`}>{card.value}</p>
      {card.details.length > 0 && <ul className="trip-details">{card.details.map((line, i) => <li key={i}>{line}</li>)}</ul>}
      <footer><span>{card.sourceUrl && /^https:\/\//.test(card.sourceUrl) ? <a href={card.sourceUrl} target="_blank" rel="noopener noreferrer">{card.sourceName} ↗</a> : card.sourceName}</span><time dateTime={card.fetchedAt}>{card.ok ? "Pobrano" : "Ostatnia próba"} {timestamp(card.fetchedAt)}</time></footer>
    </article>) : titles.map((title, index) => <article className="trip-card trip-placeholder" key={title}><div className="trip-card-heading"><span className="card-number">0{index + 1}</span><h3>{title}</h3><span className="trip-status">{busy ? "Ładuję…" : "Brak danych"}</span></div><p>{busy ? "Pobieram dane…" : error ? "Brak danych — spróbuj odświeżyć" : "Wybierz miasto i termin, aby sprawdzić."}</p></article>)}
  </div>;
}


export default function TravelPanel({ active }: { active: boolean }) {
  const [city, setCity] = useState("");
  const [secondCity, setSecondCity] = useState("");
  const [compare, setCompare] = useState(false);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [date, setDate] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = useRef<AbortController | null>(null);
  const lastQuery = useRef<{ miasto: string; dzien: string; drugieMiasto?: string } | null>(null);
  useEffect(() => () => current.current?.abort(), []);

  async function check(refresh = false) {
    if (busy) return;
    const query = refresh && lastQuery.current ? lastQuery.current : { miasto: city.trim(), dzien: date, ...(compare ? { drugieMiasto: secondCity.trim() } : {}) };
    if (!query.miasto || !query.dzien) return;
    if (compare && !query.drugieMiasto) return;
    const controller = new AbortController();
    current.current = controller;
    setBusy(true); setError("");
    try {
      const session = await fetch("/api/travel/session", { method: "POST", signal: controller.signal });
      if (!session.ok) throw new Error("Nie udało się rozpocząć sesji. Odśwież stronę.");
      const response = await fetch("/api/travel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(query), signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Nie udało się pobrać danych.");
      lastQuery.current = query;
      if ("reports" in body) { setComparison(body); setReport(null); }
      else { setReport(body); setComparison(null); }
    } catch (failure) {
      if (!controller.signal.aborted) {
        setReport(null);
        setComparison(null);
        setError(failure instanceof Error ? failure.message : "Nie udało się pobrać danych.");
      }
    } finally { if (current.current === controller) { current.current = null; setBusy(false); } }
  }

  function submit(event: FormEvent) { event.preventDefault(); void check(); }

  return (
    <section id="panel-travel" className="trip-panel" role="tabpanel" aria-labelledby="tab-travel" hidden={!active}>
      <div className="trip-intro"><p className="eyebrow">Zanim ruszysz w drogę</p><h2>Przygotuj się na swój wyjazd.</h2><p>Wybierz miasto i dzień. Zbierzemy pogodę, kursy i lokalne informacje w jednym miejscu.</p></div>
      <div className="trip-mode" role="group" aria-label="Sposób planowania"><button type="button" aria-pressed={!compare} disabled={busy} onClick={() => { setCompare(false); setComparison(null); setReport(null); lastQuery.current = null; }}>Jedno miasto</button><button type="button" aria-pressed={compare} disabled={busy} onClick={() => { setCompare(true); setComparison(null); setReport(null); lastQuery.current = null; }}>Porównaj</button></div>
      <form className={`trip-form ${compare ? "compare-form" : ""}`} onSubmit={submit}>
        <div><label htmlFor="destination">{compare ? "Pierwsze miasto" : "Dokąd jedziesz?"}</label><input id="destination" value={city} onChange={event => setCity(event.target.value)} placeholder="np. Rzym, Włochy" required minLength={2} maxLength={160} disabled={busy} /></div>
        {compare && <div><label htmlFor="second-destination">Drugie miasto</label><input id="second-destination" value={secondCity} onChange={event => setSecondCity(event.target.value)} placeholder="np. Berlin, Niemcy" required minLength={2} maxLength={160} disabled={busy} /></div>}
        <div><label htmlFor="travel-date">Kiedy?</label><input id="travel-date" type="date" min="1900-01-01" max="2099-12-31" value={date} onChange={event => setDate(event.target.value)} required disabled={busy} /></div>
        <button disabled={busy || !city.trim() || !date || (compare && !secondCity.trim())} type="submit">{busy ? "Sprawdzam…" : compare ? "Porównaj miasta" : "Sprawdź"}</button>
      </form>
      <p className="hint trip-hint">Prognoza pogody obejmuje najbliższe 16 dni. Kurs i czas dotyczą chwili sprawdzenia.</p>
      <div aria-live="polite">
        {busy && <p className="typing" role="status"><span aria-hidden="true" />Sprawdzam źródła i przygotowuję podsumowanie…</p>}
        {error && <div className="error" role="alert">{error}</div>}
        {report && <div className="trip-results-heading"><div><p className="eyebrow">Twój kierunek</p><h2>{report.location.name}<span> · {report.location.country}</span></h2><p>{report.dzien}</p></div><button type="button" className="refresh-button" disabled={busy} onClick={() => { void check(true); }}>Odśwież</button></div>}
        {compare ? <>
          {comparison && <div className="trip-results-heading"><div><p className="eyebrow">Ten sam termin · dwa kierunki</p><h2>Porównanie miast</h2><p>{comparison.dzien}</p></div><button type="button" className="refresh-button" disabled={busy} onClick={() => { void check(true); }}>Odśwież</button></div>}
          <div className="trip-comparison">
            {[0, 1].map(index => <div className="comparison-city" key={index}>
              <h2>{comparison?.reports[index].location.name ?? (index === 0 ? city || "Pierwsze miasto" : secondCity || "Drugie miasto")}</h2>
              {comparison?.reports[index].location.country && <p className="eyebrow">{comparison.reports[index].location.country} · {comparison.dzien}</p>}
              <TravelCards report={comparison?.reports[index] ?? null} busy={busy} error={error} />
            </div>)}
          </div>
          {comparison && !busy && <aside className="trip-summary">
            <p className="eyebrow">Rekomendacja asystenta · na podstawie kart</p>
            <h2>{comparison.recommendation ? "Polecam: " + comparison.recommendation.city : "Brak potwierdzonej rekomendacji"}</h2>
            {comparison.recommendation && <><p>{comparison.recommendation.explanation}</p><ul className="comparison-evidence">{comparison.recommendation.evidence.map((item, index) => <li key={index}><strong>{item.city} · {item.card}:</strong> {item.value}</li>)}</ul></>}
            {comparison.notice && <p>{comparison.notice}</p>}
          </aside>}
        </> : <TravelCards report={report} busy={busy} error={error} />}
        {report && !busy && <aside className="trip-summary"><p className="eyebrow">{report.summaryByAI ? "Wskazówki asystenta" : "Stan źródeł · podsumowanie AI niedostępne"}</p><h2>Co spakować, o czym pamiętać</h2><p>{report.summary}</p></aside>}
      </div>
      <p className="trip-credit">Waluta kraju: <a href="https://github.com/unicode-org/cldr-json" target="_blank" rel="noopener noreferrer">Unicode CLDR</a>. Święta regionalne mogą nie dotyczyć wybranego miasta.</p>
    </section>
  );
}
