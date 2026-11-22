"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
type Document = { id: number; title: string; created_at: string; chunks: number };
const labels: Record<string, string> = { split: "Dzielę tekst…", embedding: "Tworzę embeddingi…", save: "Zapisuję…", validation: "Sprawdzanie dokumentu", session: "Sprawdzanie sesji", confirmation: "Potwierdzenie wersji" };
const date = (value: string) => new Date(value).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" });

export default function UploadForm() {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [touched, setTouched] = useState({ title: false, text: false });
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const lock = useRef(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const titleError = touched.title && !title.trim();
  const textError = touched.text && !text.trim();
  const refresh = useCallback(async () => {
    setLoading(true); setListError("");
    try {
      const response = await fetch("/api/documents", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setDocuments(data.documents);
    } catch { setListError("Nie udało się odświeżyć listy. Sprawdź połączenie lub rozpocznij sesję w czacie i spróbuj ponownie."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function remove(document: Document) {
    if (lock.current || !window.confirm(`Usunąć dokument „${document.title}” (wersja ${date(document.created_at)}) i wszystkie jego fragmenty?`)) return;
    lock.current = true; setBusy(true); setSuccess(""); setError("");
    try {
      const response = await fetch("/api/documents", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: document.id, created_at: document.created_at }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setSuccess(`Usunięto dokument „${document.title}”.`);
    } catch (cause) { setError(`Usuwanie: ${cause instanceof Error && cause.message !== "Failed to fetch" ? cause.message : "Sprawdź połączenie i odśwież listę przed ponowieniem."}`); }
    finally { await refresh(); lock.current = false; setBusy(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    setTouched({ title: true, text: true }); setError(""); setSuccess("");
    if (!title.trim() || !text.trim()) { (!title.trim() ? titleInput : textInput).current?.focus(); return; }
    let expected = documents.filter(document => document.title === title.trim());
    const confirm = (rows: Document[]) => window.confirm(`Zastąpić dokument „${title.trim()}” (wersja ${rows.map(row => date(row.created_at)).join(", ")})? Stare fragmenty zostaną zastąpione nowymi po udanym imporcie.`);
    if (expected.length && !confirm(expected)) return;
    lock.current = true; setBusy(true); setStage("validation");
    let currentStage = "validation";
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await fetch("/api/documents", {
          method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
          body: JSON.stringify({ title: title.trim(), text, expected: expected.map(({ id, created_at }) => ({ id, created_at })) }),
        });
        if (!response.ok) {
          const data = await response.json();
          currentStage = data.stage || "validation";
          if (response.status === 409 && Array.isArray(data.documents) && data.documents.length && attempt < 2) {
            if (!confirm(data.documents)) return;
            expected = data.documents; continue;
          }
          throw new Error(data.error || "Nie udało się rozpocząć importu. Odśwież listę i spróbuj ponownie.");
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Brak informacji o postępie. Odśwież listę przed ponowieniem.");
        const decoder = new TextDecoder();
        let buffer = "", completed = false;
        const consume = (line: string) => {
          if (!line.trim()) return;
          const data = JSON.parse(line);
          if (data.type === "progress") { currentStage = data.stage; setStage(data.stage); }
          if (data.type === "error") { currentStage = data.stage; throw new Error(data.error); }
          if (data.type === "complete") {
            completed = true;
            setSuccess(`Zapisano dokument „${data.title}”: ${data.chunks} fragmentów`);
            setTitle(""); setText(""); setTouched({ title: false, text: false });
          }
        };
        try {
          while (true) {
            const { done, value } = await reader.read();
            buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
            const lines = buffer.split("\n"); buffer = lines.pop()!;
            for (const line of lines) consume(line);
            if (done) { consume(buffer); break; }
          }
        } finally { reader.releaseLock(); }
        if (!completed) throw new Error("Połączenie przerwano bez potwierdzenia. Odśwież listę przed ponowieniem importu.");
        return;
      }
    } catch (cause) {
      setError(`Etap: ${labels[currentStage] || currentStage} ${cause instanceof Error && cause.message !== "Failed to fetch" ? cause.message : "Sprawdź połączenie i odśwież listę przed ponowieniem importu."}`);
    } finally { setStage(""); await refresh(); lock.current = false; setBusy(false); }
  }

  return <>
    <form className="upload-form" onSubmit={submit} noValidate aria-busy={busy}>
      <p className="hint">Wklej treść dokumentu. Oddziel akapity pustą linią — każdy zostanie zapisany osobno.</p>
      <div><label htmlFor="document-title">Tytuł</label>
        <input ref={titleInput} id="document-title" value={title} maxLength={200} required disabled={busy} onChange={e => setTitle(e.target.value)} onBlur={() => setTouched(t => ({ ...t, title: true }))} aria-invalid={Boolean(titleError)} aria-describedby={titleError ? "title-error" : undefined} />
        {titleError && <p className="upload-field-error" id="title-error" role="alert">Wpisz tytuł dokumentu.</p>}
      </div>
      <div><label htmlFor="document-text">Treść</label>
        <textarea ref={textInput} id="document-text" rows={14} value={text} maxLength={20000} required disabled={busy} onChange={e => setText(e.target.value)} onBlur={() => setTouched(t => ({ ...t, text: true }))} aria-invalid={Boolean(textError)} aria-describedby={`text-count${textError ? " text-error" : ""}`} />
        <p className="upload-count" id="text-count">{text.length.toLocaleString("pl-PL")} / 20 000 znaków</p>
        {textError && <p className="upload-field-error" id="text-error" role="alert">Wklej treść dokumentu.</p>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {stage && <p className="upload-progress" role="status">{labels[stage]}</p>}
      {success && <p className="upload-success" role="status">{success}</p>}
      <button type="submit" disabled={busy}>{busy ? "Operacja w toku…" : "Dodaj do bazy wiedzy"}</button>
    </form>
    <section className="knowledge-list" aria-labelledby="documents-heading">
      <div className="knowledge-list-header"><h2 id="documents-heading">Dokumenty w bazie</h2><button type="button" onClick={() => void refresh()} disabled={busy || loading}>Odśwież listę</button></div>
      <p className="hint">Tytuł jest nazwą źródła. Data dodania oznacza jego wersję (czas polski).</p>
      {loading && <p>Wczytywanie dokumentów…</p>}
      {listError && <p role="alert" className="error">{listError}</p>}
      {!loading && !listError && documents.length === 0 && <p>Nie dodano jeszcze dokumentów.</p>}
      <ul>{documents.map(document => <li key={document.id}>
        <div><h3>{document.title}</h3><p>Wersja: <time dateTime={document.created_at}>{date(document.created_at)}</time></p><p>Fragmenty: {document.chunks}</p></div>
        <button type="button" className="knowledge-delete" disabled={busy || loading} aria-label={`Usuń: ${document.title}`} onClick={() => void remove(document)}>Usuń</button>
      </li>)}</ul>
    </section>
  </>;
}
