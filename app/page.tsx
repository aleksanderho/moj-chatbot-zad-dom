"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
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

function ChatPanel({ mode, active }: { mode: Mode; active: boolean }) {
  const [message, setMessage] = useState("");
  const { messages, sendMessage, status, error, regenerate } = useChat({ transport });
  const busy = status === "submitted" || status === "streaming";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text || busy) return;
    void sendMessage({ text }, { body: { mode } });
    setMessage("");
  }

  return (
    <section id={`panel-${mode}`} role="tabpanel" aria-labelledby={`tab-${mode}`} hidden={!active}>
      <div className="conversation" role="log" aria-label={mode === "chat" ? "Rozmowa" : "Analiza JSON"} aria-live="polite" tabIndex={0}>
        {messages.map((item) => (
          <div className={`message ${item.role}`} key={item.id}>
            <strong>{item.role === "user" ? "Ty" : "i-sofa"}</strong>
            {item.parts.map((part, index) => part.type === "text" ? <p key={index}>{part.text}</p> : null)}
          </div>
        ))}
      </div>
      {busy && <p role="status">{status === "submitted" ? "Czekam na odpowiedź…" : "AI pisze…"}</p>}
      {error && (
        <div className="error" role="alert">
          <p>{errorMessage(error)}</p>
          <button type="button" disabled={busy} onClick={() => { void regenerate({ body: { mode } }); }}>Spróbuj ponownie</button>
        </div>
      )}
      <form onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor={`message-${mode}`}>Wiadomość klienta</label>
        <div className="input-row">
          <input id={`message-${mode}`} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Napisz wiadomość…" autoComplete="off" disabled={busy} />
          <button type="submit" disabled={busy || !message.trim()}>Wyślij</button>
        </div>
      </form>
    </section>
  );
}

function AnalysisPanel({ active }: { active: boolean }) {
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
      <form onSubmit={(event) => { void handleSubmit(event); }}>
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

export default function Home() {
  const [mode, setMode] = useState<Mode>("chat");
  const [closed, setClosed] = useState(false);
  return (
    <main>
      <h1>Mój pierwszy chatbot</h1>
      {closed ? (
        <div className="closed">
          <p>Rozmowa została zakończona.</p>
          <button type="button" onClick={() => { setMode("chat"); setClosed(false); }}>Rozpocznij rozmowę</button>
        </div>
      ) : (
        <>
          <button className="exit" type="button" aria-label="Wyjdź i zakończ bieżące rozmowy" onClick={() => setClosed(true)}>Wyjdź</button>
          <div className="tabs" role="tablist" aria-label="Tryb rozmowy">
            {(["chat", "json"] as const).map((item) => (
              <button key={item} id={`tab-${item}`} type="button" role="tab" aria-selected={mode === item} aria-controls={`panel-${item}`} tabIndex={mode === item ? 0 : -1}
                onClick={() => setMode(item)}
                onKeyDown={(event) => {
                  if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                    event.preventDefault();
                    const next = event.key === "Home" ? "chat" : event.key === "End" ? "json" : mode === "chat" ? "json" : "chat";
                    setMode(next);
                    document.getElementById(`tab-${next}`)?.focus();
                  }
                }}>
                {item === "chat" ? "Zwykły czat" : "Analiza JSON"}
              </button>
            ))}
          </div>
          <ChatPanel mode="chat" active={mode === "chat"} />
          <AnalysisPanel active={mode === "json"} />
        </>
      )}
    </main>
  );
}
