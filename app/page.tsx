"use client";

import { useState, type FormEvent } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

const transport = new DefaultChatTransport({ api: "/api/chat" });

function errorMessage(error: Error) {
  // The server sends only fixed, safe descriptions, never raw provider details.
  if (/^OpenRouter \((400|401|402|403|404|408\/504|429|502\/503)\):/.test(error.message)) {
    return error.message;
  }
  if (error.message.startsWith("Brak konfiguracji.")) {
    return "Brak konfiguracji. Uzupełnij OPENROUTER_API_KEY i OPENROUTER_MODEL w pliku .env.local.";
  }
  if (error.message === "Nieprawidłowa historia rozmowy." || error.message === "Wpisz wiadomość przed wysłaniem.") {
    return error.message;
  }
  return "Nie udało się uzyskać odpowiedzi AI. Sprawdź połączenie, klucz, model i saldo OpenRouter. Spróbuj ponownie.";
}

export default function Home() {
  const [message, setMessage] = useState("");
  const { messages, sendMessage, status, error, regenerate } = useChat({ transport });
  const busy = status === "submitted" || status === "streaming";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text || busy) return;
    void sendMessage({ text });
    setMessage("");
  }

  return (
    <main>
      <h1>Mój chatbot z odpowiedzią strumieniową</h1>
      <section className="conversation" role="log" aria-label="Rozmowa" aria-live="polite">
        {messages.map((item) => (
          <div className={`message ${item.role}`} key={item.id}>
            <strong>{item.role === "user" ? "Ty" : "AI"}</strong>
            {item.parts.map((part, index) => part.type === "text" ? <p key={index}>{part.text}</p> : null)}
          </div>
        ))}
      </section>
      {busy && <p role="status">{status === "submitted" ? "Czekam na odpowiedź…" : "AI pisze…"}</p>}
      {error && (
        <div className="error" role="alert">
          <p>{errorMessage(error)}</p>
          <button type="button" disabled={busy} onClick={() => { void regenerate(); }}>Spróbuj ponownie</button>
        </div>
      )}
      <form onSubmit={handleSubmit}>
        <label htmlFor="message">Wiadomość</label>
        <div className="input-row">
          <input id="message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Napisz wiadomość…" autoComplete="off" disabled={busy} />
          <button type="submit" disabled={busy || !message.trim()}>Wyślij</button>
        </div>
      </form>
    </main>
  );
}
