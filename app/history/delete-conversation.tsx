"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteConversation({ id, title }: { id: string; title: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  async function remove() {
    if (pending || !window.confirm(`Usunąć rozmowę „${title}” wraz ze wszystkimi wiadomościami? Tej operacji nie można cofnąć.`)) return;
    setPending(true); setError("");
    try {
      const response = await fetch(`/api/conversations?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || "Nie udało się usunąć rozmowy.");
      }
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Nie udało się usunąć rozmowy.");
    } finally { setPending(false); }
  }
  return <div className="history-delete"><button type="button" disabled={pending} aria-label={`Usuń rozmowę: ${title}`} onClick={remove}>{pending ? "Usuwam…" : "Usuń"}</button>{error && <p className="error" role="alert">{error}</p>}</div>;
}
