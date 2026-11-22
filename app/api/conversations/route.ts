import { validSession, sameOrigin } from "../../travel-session.mjs";
import { getSupabase } from "../../../lib/supabase.ts";
import { chatOwner, getConversation, latestConversation, listConversations, storageError } from "../../../lib/chat-store.ts";
import { z } from "zod";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!validSession(request)) return Response.json({ error: "Sesja wygasła. Odśwież stronę." }, { status: 401, headers });
  if (!sameOrigin(request)) return Response.json({ error: "Niedozwolone źródło żądania." }, { status: 403, headers });
  const id = new URL(request.url).searchParams.get("id");
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "Nieprawidłowy identyfikator rozmowy." }, { status: 400, headers });
  try {
    // Funkcja SQL sprawdza właściciela i usuwa oba zestawy danych atomowo.
    const { data, error } = await getSupabase().rpc("delete_owned_conversation", {
      p_conversation_id: id, p_owner_id: chatOwner(request).id,
    });
    if (error) throw error;
    if (!data) return Response.json({ error: "Nie znaleziono rozmowy." }, { status: 404, headers });
    return new Response(null, { status: 204, headers });
  } catch {
    return Response.json({ error: "Nie udało się usunąć rozmowy. Spróbuj ponownie." }, { status: 503, headers });
  }
}

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!validSession(request)) return Response.json({ error: "Sesja wygasła. Rozpocznij rozmowę ponownie." }, { status: 401, headers });
  const query = new URL(request.url).searchParams;
  const id = query.get("id");
  if (id !== null && !z.string().uuid().safeParse(id).success) return Response.json({ error: "Nieprawidłowy identyfikator rozmowy." }, { status: 400, headers });
  const owner = chatOwner(request);
  try {
    if (query.get("list") === "1") return Response.json({ conversations: await listConversations(owner.id) }, { headers });
    const conversation = id ? await getConversation(id, owner.id) : await latestConversation(owner.id);
    if (id && !conversation) return Response.json({ error: "Nie znaleziono rozmowy." }, { status: 404, headers });
    return Response.json({ conversation }, {
      headers: { ...headers, "Set-Cookie": owner.cookie },
    });
  } catch {
    return Response.json({ error: storageError }, { status: 503, headers });
  }
}
