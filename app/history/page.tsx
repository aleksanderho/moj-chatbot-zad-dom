import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { validSession } from "../travel-session.mjs";
import { chatOwner, listConversations } from "../../lib/chat-store";
import DeleteConversation from "./delete-conversation";

export const metadata = { title: "Historia rozmów · i-sofa" };

export default async function HistoryPage() {
  const request = new Request("http://localhost/history", {
    headers: { cookie: (await cookies()).toString() },
  });
  if (!validSession(request)) redirect("/?session=expired");

  let conversations: Awaited<ReturnType<typeof listConversations>> = [];
  let failed = false;
  try { conversations = await listConversations(chatOwner(request).id); }
  catch { failed = true; }

  return (
    <main className="history-shell">
      <header className="app-header">
        <div className="brand"><span className="brand-mark" aria-hidden="true">i.</span><div><h1>Historia rozmów</h1><p>Wróć do rozmowy i kontynuuj ją.</p></div></div>
        <a className="history-back" href="/">Wróć do czatu</a>
      </header>
      <nav className="history-actions" aria-label="Rozmowy"><a className="history-new" href="/?new=1">Nowa rozmowa</a></nav>
      {failed ? <div className="error" role="alert">Nie udało się wczytać historii. <a href="/history">Spróbuj ponownie</a>.</div>
        : conversations.length === 0 ? <p className="history-empty">Nie masz jeszcze zapisanych rozmów. Rozpocznij pierwszą rozmowę.</p>
        : <ol className="history-list" aria-label="Zapisane rozmowy, od najnowszej">
          {conversations.map(conversation => <li key={conversation.id}>
            <a className="history-item" href={`/?conversation=${encodeURIComponent(conversation.id)}`}>
              <span className="history-title">{conversation.title || "Nowa rozmowa"}</span>
              <span className="history-details"><time dateTime={conversation.created_at}>{new Date(conversation.created_at).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw", dateStyle: "medium", timeStyle: "short" })}</time><span>Wiadomości: {conversation.messageCount}</span></span>
            </a>
            <DeleteConversation id={conversation.id} title={conversation.title || "Nowa rozmowa"} />
          </li>)}
        </ol>}
    </main>
  );
}
