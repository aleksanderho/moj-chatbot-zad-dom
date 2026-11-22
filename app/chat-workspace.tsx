"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, getToolName, type FileUIPart } from "ai";
import { markInterrupted, type AgentMessage } from "./chat-interruption";
import TravelPanel from "./dashboard/travel-panel";
import { analysisSchema } from "./analysis-schema.mjs";
import type { z } from "zod";
import { knowledgeSources, withoutKnowledgeMarkers } from "./knowledge-sources";
import { usedToolLabels } from "./tool-labels";

const transport = new DefaultChatTransport<AgentMessage>({
  api: "/api/agent",
  fetch: async (input, init) => {
    const response = await fetch(input, init);
    if (!response.ok) {
      const text = await response.text();
      let message = text;
      try { message = JSON.parse(text)?.error?.message || text; } catch { /* Plain-text errors are also supported. */ }
      throw new Error(message);
    }
    return response;
  },
  prepareSendMessagesRequest: ({ messages, body }) => ({ body: {
    ...body,
    mode: "chat",
    messages: messages.map(item => ({ ...item, parts: item.role === "assistant"
      ? item.parts.map(part => part.type === "file" ? { type: "text", text: "[Wygenerowany obraz]" } : part)
      : item.parts,
    })),
  } }),
});
type Mode = "chat" | "json";
const imageSuggestions = [
  "Jasny salon ze skandynawską beżową sofą, drewniany stolik i naturalne światło.",
  "Zielony fotel tapicerowany w przytulnym kąciku do czytania, lampa i rośliny.",
  "Nowoczesny szary narożnik w przestronnym salonie, ciepłe dodatki i duży dywan.",
];

async function startSession(signal?: AbortSignal) {
  const response = await fetch("/api/travel/session", { method: "POST", signal });
  if (!response.ok) throw new Error("Nie udało się rozpocząć sesji. Odśwież stronę.");
}

function errorMessage(error: Error) {
  if (error.message.startsWith("Nie udało się odczytać lub zapisać rozmowy.")) return error.message;
  if (/^OpenRouter \((400|401|402|403|404|408\/504|429|502\/503)\):/.test(error.message)) return error.message;
  if (error.message.startsWith("Brak konfiguracji.")) return "Brak konfiguracji. Uzupełnij OPENROUTER_API_KEY i OPENROUTER_MODEL w pliku .env.local.";
  if (error.message === "Nieprawidłowa historia rozmowy." || error.message === "Wpisz wiadomość przed wysłaniem.") return error.message;
  if (error.message.startsWith("Sesja wygasła.")) return error.message;
  return "Nie udało się uzyskać odpowiedzi AI. Sprawdź połączenie i spróbuj ponownie.";
}

export function ChatPanel({ mode, active }: { mode: Mode; active: boolean }) {
  const [message, setMessage] = useState("");
  const { messages, sendMessage, status, error, regenerate, stop, setMessages } = useChat<AgentMessage>({ transport });
  const [conversationId, setConversationId] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [profileName, setProfileName] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        await startSession(controller.signal);
        const profileResponse = await fetch("/api/profile", { signal: controller.signal, cache: "no-store" });
        if (!profileResponse.ok) throw new Error("profile");
        const { profile } = await profileResponse.json();
        if (controller.signal.aborted) return;
        setProfileName(profile.name);
        const query = new URLSearchParams(window.location.search);
        const requestedId = query.get("conversation");
        const newChat = query.get("new") === "1";
        const response = await fetch(requestedId ? `/api/conversations?id=${encodeURIComponent(requestedId)}` : "/api/conversations", { signal: controller.signal, cache: "no-store" });
        if (!response.ok && !(newChat && response.status === 404)) throw new Error("history");
        const { conversation } = response.ok ? await response.json() : { conversation: null };
        if (controller.signal.aborted) return;
        if (newChat && (!requestedId || !conversation)) {
          const id = requestedId ?? crypto.randomUUID();
          setConversationId(id);
          setMessages([]);
          window.history.replaceState(null, "", `/?conversation=${id}&new=1`);
        } else {
          const id = conversation?.id ?? crypto.randomUUID();
          setConversationId(id);
          setMessages(conversation?.messages ?? []);
          window.history.replaceState(null, "", `/?conversation=${id}${conversation ? "" : "&new=1"}`);
        }
      } catch {
        if (!controller.signal.aborted) setHistoryError("Nie udało się wczytać rozmowy. Odśwież stronę, aby spróbować ponownie.");
      } finally {
        if (!controller.signal.aborted) setLoadingHistory(false);
      }
    })();
    return () => controller.abort();
  }, [setMessages]);

  function newConversation() {
    if (busy || stopping || sendLock.current) return;
    window.location.assign("/?new=1");
  }
  const [stopping, setStopping] = useState(false);
  const [photo, setPhoto] = useState<FileUIPart | null>(null);
  const [readingPhoto, setReadingPhoto] = useState(false);
  const [preparingSession, setPreparingSession] = useState(false);
  const [imageRequested, setImageRequested] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const sessionRequest = useRef<AbortController | null>(null);
  const sendLock = useRef(false);
  const photoReader = useRef<FileReader | null>(null);
  useEffect(() => () => { sessionRequest.current?.abort(); photoReader.current?.abort(); }, []);
  const startedAt = useRef(0);
  const chatBusy = status === "submitted" || status === "streaming";
  const busy = chatBusy || preparingSession || readingPhoto || loadingHistory || Boolean(historyError);
  const generating = (chatBusy || preparingSession) && (imageRequested || Boolean(messages.at(-1)?.parts.some(part => isToolUIPart(part) && getToolName(part) === "generujObraz" && (part.state === "input-streaming" || part.state === "input-available"))));

  async function submitChat(text: string, files: FileUIPart[] = [], generateImage = false, retry = false) {
    if (sendLock.current || busy || stopping) return;
    sendLock.current = true;
    const controller = new AbortController();
    sessionRequest.current = controller;
    setPreparingSession(true); setImageRequested(generateImage); setMediaError("");
    try {
      await startSession(controller.signal);
      controller.signal.throwIfAborted();
      startedAt.current = performance.now();
      setPreparingSession(false);
      if (retry) await regenerate({ body: { mode: "chat", generateImage, conversationId } });
      else {
        setMessage(""); setPhoto(null);
        if (fileInput.current) fileInput.current.value = "";
        await sendMessage({ text: generateImage ? `Wygeneruj obraz: ${text}` : text, ...(files.length ? { files } : {}) }, { body: { mode: "chat", generateImage, conversationId } });
      }
    } catch (failure) {
      if (!controller.signal.aborted) setMediaError(failure instanceof Error ? failure.message : "Nie udało się wysłać wiadomości.");
    } finally {
      if (sessionRequest.current === controller) { sessionRequest.current = null; setPreparingSession(false); setImageRequested(false); sendLock.current = false; }
    }
  }

  function selectPhoto(file?: File) {
    if (!file) return;
    setMediaError("");
    setPhoto(null);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 4 * 1024 * 1024 || file.size === 0) {
      setMediaError("Wybierz zdjęcie JPG, PNG lub WebP o rozmiarze do 4 MB.");
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    const reader = new FileReader();
    photoReader.current = reader;
    setReadingPhoto(true);
    reader.onload = async () => {
      const url = String(reader.result);
      const preview = new Image();
      preview.src = url;
      try {
        await preview.decode();
        setPhoto({ type: "file", mediaType: file.type, filename: file.name, url });
      } catch {
        setMediaError("Nie udało się odczytać zdjęcia. Wybierz poprawny plik JPG, PNG lub WebP.");
        if (fileInput.current) fileInput.current.value = "";
      } finally { setReadingPhoto(false); }
    };
    reader.onerror = () => { setMediaError("Nie udało się odczytać zdjęcia. Wybierz je ponownie."); setReadingPhoto(false); };
    reader.onabort = () => setReadingPhoto(false);
    reader.readAsDataURL(file);
  }

  async function generatePicture() {
    const prompt = message.trim();
    if (!prompt || busy || stopping || sendLock.current) return;
    if (prompt.length > 500) { setMediaError("Opis obrazu może mieć maksymalnie 500 znaków."); return; }
    if (photo) { setMediaError("Aby wygenerować obraz z opisu, najpierw usuń załączone zdjęcie."); return; }
    await submitChat(prompt, [], true);
  }

  async function handleStop() {
    if (!busy || stopping) return;
    if (preparingSession) { sessionRequest.current?.abort(); return; }
    if (readingPhoto) { photoReader.current?.abort(); return; }
    setStopping(true);
    try {
      await stop();
      setMessages(current => markInterrupted(current, performance.now() - startedAt.current));
    } finally { setStopping(false); }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if ((!text && !photo) || busy || stopping) return;
    void submitChat(text || "Opisz to zdjęcie.", photo ? [photo] : []);
  }

  return (
    <section id={`panel-${mode}`} role="tabpanel" aria-labelledby={`tab-${mode}`} hidden={!active}>
      <div className="media-actions chat-navigation"><button type="button" disabled={busy || stopping} onClick={newConversation}>Nowa rozmowa</button><a className="history-back" href="/history">Historia</a><a className="history-back" href="/profile">Profil</a><a className="history-back" href="/upload">Baza wiedzy</a></div>
      {loadingHistory && <p role="status">Wczytuję rozmowę…</p>}
      {historyError && <div className="error" role="alert">{historyError}</div>}
      <div className="conversation" role="log" aria-label={mode === "chat" ? "Rozmowa" : "Analiza JSON"} aria-live="polite" tabIndex={0}>
        {messages.length === 0 && !loadingHistory && !historyError && <div className="welcome"><span className="welcome-mark" aria-hidden="true">i.</span><p className="eyebrow">Twój asystent i-sofa</p><h2>{profileName ? `Cześć, ${profileName}!` : "Cześć!"}</h2><p>{profileName ? "W czym mogę Ci dzisiaj pomóc?" : "Jak mam się do Ciebie zwracać?"}</p></div>}
        {messages.map((item) => {
          const sources = item.parts.filter(part => part.type === "source-url" && /^https?:\/\//i.test(part.url));
          const usedTools = usedToolLabels(item.parts);
          const knowledge = knowledgeSources(item.parts, item.metadata?.knowledgeSources);
          if (knowledge.length && !usedTools.some(tool => tool.name === "searchKnowledge")) usedTools.push({ id: "saved-knowledge", name: "searchKnowledge" });
          return (
          <div className={`message ${item.role}`} key={item.id}>
            <strong>{item.role === "user" ? "Ty" : "i-sofa"}</strong>
            {item.role === "assistant" && usedTools.length > 0 && <ol className="agent-steps" aria-label="Użyte narzędzia w kolejności">
              {usedTools.map(({ id, name }, index) => <li key={id}><span>{index + 1}. {name === "searchKnowledge" ? "📚 baza wiedzy" : name === "webSearch" ? "🔎 wyszukiwanie" : name === "aktualnyCzas" ? "🕒 aktualnyCzas" : name === "generujObraz" ? "🎨 generujObraz" : name}</span>{index < usedTools.length - 1 && <span className="step-arrow" aria-hidden="true">→</span>}</li>)}
            </ol>}
            {item.parts.map((part, index) => {
              if (part.type === "file" && /^data:image\/(png|jpeg|webp);base64,/.test(part.url)) return <div key={index}>
                <img className={item.role === "user" ? "chat-photo" : "generated-image"} src={part.url} alt={part.filename || (item.role === "user" ? "Przesłane zdjęcie" : "Wygenerowany obraz")} />
                {item.metadata?.generatedImage && <a className="image-download" href={part.url} download={`i-sofa-obraz.${part.mediaType === "image/jpeg" ? "jpg" : part.mediaType === "image/webp" ? "webp" : "png"}`}>Pobierz</a>}
              </div>;
              if (part.type === "text") return <p key={index}>{item.role === "assistant" ? withoutKnowledgeMarkers(part.text) : part.text}</p>;
              if (!isToolUIPart(part)) return null;
              const output = part.state === "output-available" ? part.output as { ok?: boolean; message?: string; sourceUrl?: string; url?: string; mediaType?: string; modelId?: string } | undefined : undefined;
              const failed = part.state === "output-error" || output?.ok === false;
              const done = part.state === "output-available" || part.state === "output-denied";
              const interrupted = item.metadata?.interrupted && !failed && !done;
              const source = output?.sourceUrl;
              return <div className="tool-result" key={index}>
                <span className="tool-badge">{getToolName(part)} · {interrupted ? "Przerwane" : failed ? "Nie udało się" : done ? "Gotowe" : "Pracuje…"}</span>
                {failed && <p className="hint">{output?.message ?? "Narzędzie nie mogło wykonać zadania. Sprawdź argumenty i spróbuj ponownie."}</p>}
                {getToolName(part) === "generujObraz" && output?.ok && output.url && /^data:image\/(png|jpeg|webp);base64,/.test(output.url) && <div>
                  <img className="generated-image" src={output.url} alt="Wygenerowany obraz" />
                  <a className="image-download" href={output.url} download={`i-sofa-obraz.${output.mediaType === "image/jpeg" ? "jpg" : output.mediaType === "image/webp" ? "webp" : "png"}`}>Pobierz</a>
                  <small className="image-model">Model: {output.modelId || "dostawca nie zwrócił identyfikatora"}</small>
                </div>}
                {source && /^https:\/\/(pl\.wikipedia\.org|open-meteo\.com|api\.nbp\.pl|date\.nager\.at)\//.test(source) && <a className="source-badge" href={source} target="_blank" rel="noopener noreferrer">Źródło ↗</a>}
              </div>;
            })}
            {item.role === "assistant" && (item.metadata?.vision || item.metadata?.generatedImage) && <small className="image-model">Model: {item.metadata.modelId || "dostawca nie zwrócił identyfikatora"}</small>}
            {item.role === "assistant" && knowledge.length > 0 && <div className="knowledge-sources">
              <strong>Źródła z bazy wiedzy</strong>
              <p className="hint">Podobieństwo oznacza dopasowanie tekstów, nie pewność odpowiedzi.</p>
              <ul>{knowledge.map(source => <li key={source.sourceId}>
                <span className="knowledge-source-title">{source.title}</span>
                <span className="knowledge-similarity">Podobieństwo: {(source.similarity * 100).toLocaleString("pl-PL", { maximumFractionDigits: 1 })}%</span>
                <details><summary>Pokaż fragment</summary><blockquote>{source.content}</blockquote></details>
              </li>)}</ul>
            </div>}
            {item.role === "assistant" && sources.length > 0 && <div className="message-sources">
              <strong>Źródła</strong>
              <ul>{sources.map(source => {
                if (source.type !== "source-url") return null;
                const fetchedAt = item.metadata?.sourcesFetchedAt?.[source.sourceId];
                return <li key={source.sourceId}>
                  <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title?.trim() || source.url}</a>
                  {fetchedAt && <small> · pobrano: <time dateTime={fetchedAt}>{new Date(fetchedAt).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw", dateStyle: "short", timeStyle: "medium" })}</time></small>}
                </li>;
              })}</ul>
            </div>}
            {item.role === "assistant" && !item.metadata?.generatedImage && item.metadata?.elapsedMs !== undefined && <small className="agent-stats">Kroki: {item.metadata.steps} · Wywołania narzędzi: {item.metadata.toolCalls} · Czas: {(item.metadata.elapsedMs / 1000).toLocaleString("pl-PL", { maximumFractionDigits: 1 })} s</small>}
          </div>
        ); })}
      </div>
      {busy && !loadingHistory && !historyError && <p className="typing" role="status"><span aria-hidden="true" />{generating ? "Generuję obraz…" : readingPhoto ? "Wczytuję zdjęcie…" : status === "submitted" ? "Czekam na odpowiedź…" : "Agent pisze…"}</p>}
      {mediaError && <div className="error" role="alert">{mediaError}</div>}
      {error && (
        <div className="error" role="alert">
          <p>{errorMessage(error)}</p>
          <button type="button" disabled={busy || stopping} onClick={() => { void submitChat("", [], imageRequested, true); }}>Spróbuj ponownie</button>
        </div>
      )}
      <form className="composer" onSubmit={handleSubmit}>
        {photo && <div className="photo-preview"><img src={photo.url} alt="Zdjęcie gotowe do wysłania" /><span>{photo.filename}</span><button type="button" disabled={busy} onClick={() => { setPhoto(null); if (fileInput.current) fileInput.current.value = ""; }}>Usuń zdjęcie</button></div>}
        <div className="media-actions">
          <input className="sr-only" id="chat-photo" type="file" accept="image/jpeg,image/png,image/webp" ref={fileInput} disabled={busy || stopping} onChange={event => selectPhoto(event.target.files?.[0])} />
          <button type="button" disabled={busy || stopping} onClick={() => fileInput.current?.click()}>Dodaj zdjęcie</button>
          <button type="button" disabled={busy || stopping || !message.trim() || Boolean(photo)} onClick={() => { void generatePicture(); }}>Wygeneruj obraz</button>
          <small>JPG, PNG, WebP · do 4 MB. Opis do generowania: do 500 znaków.</small>
        </div>
        <label className="sr-only" htmlFor={`message-${mode}`}>Wiadomość klienta</label>
        <div className="input-row">
          <input id={`message-${mode}`} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Napisz wiadomość…" autoComplete="off" disabled={busy} />
          {loadingHistory || historyError ? <button type="submit" disabled>Wyślij</button> : busy || stopping
            ? <button type="button" disabled={stopping} onClick={() => { void handleStop(); }}>{stopping ? "Zatrzymuję…" : "Stop"}</button>
            : <button type="submit" disabled={!message.trim() && !photo}>Wyślij</button>}
        </div>
        <div className="image-suggestions" role="group" aria-label="Podpowiedzi opisów obrazu">
          {imageSuggestions.map((prompt, index) => <button key={prompt} type="button" disabled={busy || stopping} onClick={() => { setMessage(prompt); setMediaError(""); document.getElementById(`message-${mode}`)?.focus(); }}>{["Beżowa sofa w salonie", "Kącik z zielonym fotelem", "Salon z narożnikiem"][index]}</button>)}
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
      await startSession(current.signal);
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "analyze", message: message.trim() }),
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



