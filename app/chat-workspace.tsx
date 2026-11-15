"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, getToolName } from "ai";
import { markInterrupted, type AgentMessage } from "./chat-interruption";
import TravelPanel from "./dashboard/travel-panel";
import { analysisSchema } from "./analysis-schema.mjs";
import type { z } from "zod";

const transport = new DefaultChatTransport({ api: "/api/chat" });
type Mode = "chat" | "json";

function errorMessage(error: Error) {
  if (/^OpenRouter \((400|401|402|403|404|408\/504|429|502\/503)\):/.test(error.message)) return error.message;
  if (error.message.startsWith("Brak konfiguracji.")) return "Brak konfiguracji. Uzupełnij OPENROUTER_API_KEY i OPENROUTER_MODEL w pliku .env.local.";
  if (error.message === "Nieprawidłowa historia rozmowy." || error.message === "Wpisz wiadomość przed wysłaniem.") return error.message;
  return "Nie udało się uzyskać odpowiedzi AI. Sprawdź połączenie i spróbuj ponownie.";
}

export function ChatPanel({ mode, active }: { mode: Mode; active: boolean }) {
  const [message, setMessage] = useState("");
  const { messages, sendMessage, status, error, regenerate, stop, setMessages } = useChat<AgentMessage>({ transport });
  const [stopping, setStopping] = useState(false);
  const startedAt = useRef(0);
  const busy = status === "submitted" || status === "streaming";

  async function handleStop() {
    if (!busy || stopping) return;
    setStopping(true);
    try {
      await stop();
      setMessages(current => markInterrupted(current, performance.now() - startedAt.current));
    } finally { setStopping(false); }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text || busy || stopping) return;
    startedAt.current = performance.now();
    void sendMessage({ text }, { body: { mode } });
    setMessage("");
  }

  return (
    <section id={`panel-${mode}`} role="tabpanel" aria-labelledby={`tab-${mode}`} hidden={!active}>
      <div className="conversation" role="log" aria-label={mode === "chat" ? "Rozmowa" : "Analiza JSON"} aria-live="polite" tabIndex={0}>
        {messages.length === 0 && <div className="welcome"><span className="welcome-mark" aria-hidden="true">i.</span><p className="eyebrow">Twój asystent i-sofa</p><h2>Porozmawiajmy o wygodzie.</h2><p>Zapytaj o sofy, wybór mebli lub ofertę sklepu.<br />W czym mogę Ci dzisiaj pomóc?</p></div>}
        {messages.map((item) => {
          let step = 0;
          const usedTools: { step: number; name: string }[] = [];
          for (const part of item.parts) {
            if (part.type === "step-start") step++;
            if (isToolUIPart(part)) usedTools.push({ step: Math.max(1, step), name: getToolName(part) });
          }
          return (
          <div className={`message ${item.role}`} key={item.id}>
            <strong>{item.role === "user" ? "Ty" : "i-sofa"}</strong>
            {item.role === "assistant" && usedTools.length > 0 && <ol className="agent-steps" aria-label="Kroki agenta">
              {usedTools.map((tool, index) => <li key={index}><span>{tool.step}. {tool.name}</span>{index < usedTools.length - 1 && <span className="step-arrow" aria-hidden="true"> → </span>}</li>)}
            </ol>}
            {item.parts.map((part, index) => {
              if (part.type === "text") return <p key={index}>{part.text}</p>;
              if (!isToolUIPart(part)) return null;
              const output = part.state === "output-available" ? part.output as { ok?: boolean; message?: string; sourceUrl?: string } | undefined : undefined;
              const failed = part.state === "output-error" || output?.ok === false;
              const done = part.state === "output-available" || part.state === "output-denied";
              const interrupted = item.metadata?.interrupted && !failed && !done;
              const source = output?.sourceUrl;
              return <div className="tool-result" key={index}>
                <span className="tool-badge">{getToolName(part)} · {interrupted ? "Przerwane" : failed ? "Nie udało się" : done ? "Gotowe" : "Pracuje…"}</span>
                {failed && <p className="hint">{output?.message ?? "Narzędzie nie mogło wykonać zadania. Sprawdź argumenty i spróbuj ponownie."}</p>}
                {source && /^https:\/\/(pl\.wikipedia\.org|open-meteo\.com|api\.nbp\.pl|date\.nager\.at)\//.test(source) && <a className="source-badge" href={source} target="_blank" rel="noopener noreferrer">Źródło ↗</a>}
              </div>;
            })}
            {item.role === "assistant" && item.metadata && <small className="agent-stats">Kroki: {item.metadata.steps} · Wywołania narzędzi: {item.metadata.toolCalls} · Czas: {(item.metadata.elapsedMs / 1000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })} s</small>}
          </div>
        ); })}
      </div>
      {busy && <p className="typing" role="status"><span aria-hidden="true" />{status === "submitted" ? "Czekam na odpowiedź…" : "Agent pisze…"}</p>}
      {error && (
        <div className="error" role="alert">
          <p>{errorMessage(error)}</p>
          <button type="button" disabled={busy || stopping} onClick={() => { startedAt.current = performance.now(); void regenerate({ body: { mode } }); }}>Spróbuj ponownie</button>
        </div>
      )}
      <form className="composer" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor={`message-${mode}`}>Wiadomość klienta</label>
        <div className="input-row">
          <input id={`message-${mode}`} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Napisz wiadomość…" autoComplete="off" disabled={busy} />
          {busy || stopping
            ? <button type="button" disabled={stopping} onClick={() => { void handleStop(); }}>{stopping ? "Zatrzymuję…" : "Stop"}</button>
            : <button type="submit" disabled={!message.trim()}>Wyślij</button>}
        </div>
      </form>
    </section>
  );
}

export function AnalysisPanel({ active }: { active: boolean }) {
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<z.infer<typeof analysisSchema> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !message.trim()) return;
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setResult(null);
    setError("");
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim() }),
        signal: AbortSignal.any([current.signal, AbortSignal.timeout(55000)]),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(typeof body?.error?.message === "string" ? body.error.message : "Analiza nie powiodła się. Spróbuj ponownie.");
      }
      const parsed = analysisSchema.safeParse(body?.result);
      if (!parsed.success) throw new Error("Serwer nie zwrócił kompletnego wyniku analizy. Wynik został odrzucony.");
      if (current.signal.aborted) return;
      setResult(parsed.data);
    } catch (failure) {
      setResult(null);
      setError(current.signal.aborted ? "Analiza została przerwana. Nie ma zatwierdzonego wyniku."
        : failure instanceof Error && failure.name === "TimeoutError" ? "Przekroczono czas oczekiwania. Nie ma zatwierdzonego wyniku."
        : failure instanceof TypeError ? "Błąd połączenia. Nie ma zatwierdzonego wyniku. Spróbuj ponownie."
        : failure instanceof Error ? failure.message : "Nie udało się uzyskać analizy. Spróbuj ponownie.");
    } finally {
      if (controller.current === current) {
        controller.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <section id="panel-json" role="tabpanel" aria-labelledby="tab-json" hidden={!active}>
      <div className="conversation analysis" aria-label="Wynik analizy" aria-live="polite">
        {!result && !busy && !error && <p className="hint">Wklej wiadomość klienta, aby przygotować analizę i szkic odpowiedzi.</p>}
        {busy && <p role="status">Analizuję wiadomość… Wynik pokażę po zakończeniu i walidacji.</p>}
        {error && <div className="error" role="alert">{error}</div>}
        {result && (
          <article>
            <h2>Analiza wiadomości — i-sofa</h2>
            <dl className="analysis-fields">
              <div><dt>Kategoria</dt><dd>{result.category}</dd></div>
              <div><dt>Priorytet</dt><dd>{result.priority === "high" ? "Wysoki (high)" : "Normalny (normal)"}</dd></div>
              <div><dt>Status sprawdzenia</dt><dd>{result.needs_review ? "Wymaga sprawdzenia przez pracownika" : "Nie wymaga dodatkowego sprawdzenia według analizy"}</dd></div>
            </dl>
            <h3>Szkic odpowiedzi</h3>
            <p className="draft">{result.draft}</p>
            <p className="hint">To wyłącznie szkic, również gdy needs_review = false. Żadna wiadomość nie została wysłana.</p>
          </article>
        )}
      </div>
      <form className="composer" onSubmit={(event) => { void handleSubmit(event); }}>
        <label className="sr-only" htmlFor="analysis-message">Wiadomość klienta do analizy</label>
        <div className="input-row">
          <textarea id="analysis-message" rows={3} maxLength={20000} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Wklej wiadomość klienta…" disabled={busy} />
          {busy
            ? <button type="button" onClick={() => controller.current?.abort()}>Przerwij</button>
            : <button type="submit" disabled={!message.trim()}>Analizuj</button>}
        </div>
      </form>
    </section>
  );
}

export default function Home({ initialMode = "chat" }: { initialMode?: Mode | "travel" }) {
  const [mode, setMode] = useState<Mode | "travel">(initialMode);
  const [closed, setClosed] = useState(false);
  return (
    <main className={mode === "travel" && !closed ? "dashboard-shell travel-mode" : undefined}>
      <header className="app-header"><div className="brand"><span className="brand-mark" aria-hidden="true">i.</span><div><h1>i-sofa</h1><p>Pomoc w wyborze. Przestrzeń na rozmowę.</p></div></div>{!closed && <button className="workspace-exit" type="button" aria-label="Wyjdź i zakończ bieżące rozmowy" onClick={() => setClosed(true)}>Wyjdź</button>}</header>
      {closed ? (
        <div className="closed">
          <p>Rozmowa została zakończona.</p>
          <button type="button" onClick={() => { setMode("chat"); setClosed(false); }}>Rozpocznij rozmowę</button>
        </div>
      ) : (
        <>
          <div className="tabs dashboard-tabs" role="tablist" aria-label="Tryb rozmowy">
            {(["chat", "json", "travel"] as const).map((item, index, items) => (
              <button key={item} id={`tab-${item}`} type="button" role="tab" aria-selected={mode === item} aria-controls={`panel-${item}`} tabIndex={mode === item ? 0 : -1}
                onClick={() => setMode(item)}
                onKeyDown={(event) => {
                  if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                    event.preventDefault();
                    const next = items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowLeft" ? -1 : 1) + items.length) % items.length];
                    setMode(next);
                    document.getElementById(`tab-${next}`)?.focus();
                  }
                }}>
                {item === "chat" ? "Zwykły tekst" : item === "json" ? "Analiza JSON" : "Misja podróży"}
              </button>
            ))}
          </div>
          <ChatPanel mode="chat" active={mode === "chat"} />
          <AnalysisPanel active={mode === "json"} />
          <TravelPanel active={mode === "travel"} />
        </>
      )}
    </main>
  );
}
