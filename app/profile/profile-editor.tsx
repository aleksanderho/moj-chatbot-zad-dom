"use client";
import { useState } from "react";

type Profile = { name: string | null; preferences: Record<string, unknown> };
type Change = { kind: "name"; value: string | null } | { kind: "preference"; key: string; value: string | null };
const labels: Record<string, string> = { miasto: "Miasto", ulubione_jedzenie: "Ulubione jedzenie", styl_odpowiedzi: "Styl odpowiedzi", hobby: "Hobby", zawod: "Zawód", jezyk: "Język", ulubiony_kolor: "Ulubiony kolor" };

function Field({ label, initial, pending, save, remove }: { label: string; initial: string; pending: boolean; save: (value: string) => void; remove: () => void }) {
  const [value, setValue] = useState(initial);
  return <form className="profile-field" onSubmit={event => { event.preventDefault(); save(value); }}>
    <label><span>{label}</span><input aria-label={label} value={value} onChange={event => setValue(event.target.value)} disabled={pending} maxLength={160} /></label>
    <div className="profile-field-actions"><button type="submit" disabled={pending || !value.trim() || value === initial} aria-label={`Zapisz: ${label}`}>Zapisz</button><button type="button" disabled={pending || !initial} onClick={remove} aria-label={`Usuń: ${label}`}>Usuń</button></div>
  </form>;
}

export default function ProfileEditor({ initialProfile }: { initialProfile: Profile }) {
  const [profile, setProfile] = useState(initialProfile);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  async function mutate(change?: Change) {
    if (pending) return;
    setPending(true); setError(""); setStatus("");
    try {
      const response = await fetch("/api/profile", { method: change ? "PATCH" : "DELETE", headers: { "Content-Type": "application/json" }, ...(change ? { body: JSON.stringify(change) } : {}) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Nie udało się zmienić profilu.");
      setProfile(body.profile);
      setStatus(change ? change.value === null ? "Usunięto pozycję." : "Zapisano zmianę." : "Profil został wyczyszczony.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Nie udało się zmienić profilu."); }
    finally { setPending(false); }
  }
  return <section className="profile-editor" aria-label="Edycja profilu">
    <Field key={`name:${profile.name}`} label="Imię" initial={profile.name ?? ""} pending={pending} save={value => { void mutate({ kind: "name", value }); }} remove={() => { void mutate({ kind: "name", value: null }); }} />
    <h2>Preferencje</h2>
    {Object.entries(profile.preferences).map(([key, value]) => <Field key={`${key}:${JSON.stringify(value)}`} label={labels[key] ?? key} initial={typeof value === "string" ? value : JSON.stringify(value)} pending={pending} save={value => { void mutate({ kind: "preference", key, value }); }} remove={() => { void mutate({ kind: "preference", key, value: null }); }} />)}
    {Object.keys(profile.preferences).length === 0 && <p className="history-empty">Nie masz zapisanych preferencji.</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <p role="status" aria-live="polite">{pending ? "Zapisuję…" : status}</p>
    <button type="button" disabled={pending || (!profile.name && !Object.keys(profile.preferences).length)} onClick={() => { if (window.confirm("Wyczyścić imię i wszystkie preferencje? Historie rozmów pozostaną zapisane.")) void mutate(); }}>Wyczyść cały profil</button>
  </section>;
}
