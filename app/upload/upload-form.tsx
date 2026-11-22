"use client";

import { useRef, useState, type FormEvent } from "react";

export default function UploadForm() {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [touched, setTouched] = useState({ title: false, text: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const lock = useRef(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const titleError = touched.title && !title.trim();
  const textError = touched.text && !text.trim();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    setTouched({ title: true, text: true });
    setError(""); setSuccess("");
    if (!title.trim() || !text.trim()) {
      (!title.trim() ? titleInput : textInput).current?.focus();
      return;
    }
    lock.current = true; setBusy(true);
    try {
      const response = await fetch("/api/documents", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), text }),
      });
      const data = await response.json().catch(() => { throw new Error("Serwer zwrócił nieprawidłową odpowiedź. Sprawdź zapis w Supabase przed ponowieniem."); });
      if (!response.ok) throw new Error(data.error || "Nie udało się zapisać dokumentu. Spróbuj ponownie.");
      setSuccess(`Zapisano dokument „${data.title}”: ${data.chunks} fragmentów`);
      setTitle(""); setText(""); setTouched({ title: false, text: false });
    } catch (cause) {
      setError(cause instanceof Error && cause.message !== "Failed to fetch" ? cause.message : "Nie udało się połączyć z serwerem. Sprawdź połączenie i spróbuj ponownie.");
    } finally { lock.current = false; setBusy(false); }
  }

  return <form className="upload-form" onSubmit={submit} noValidate aria-busy={busy}>
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
    {success && <p className="upload-success" role="status">{success}</p>}
    <button type="submit" disabled={busy}>{busy ? "Zapisywanie…" : "Dodaj do bazy wiedzy"}</button>
  </form>;
}

