import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { UIMessage } from "ai";
import { getSupabase } from "./supabase.ts";

export const storageError = "Nie udało się odczytać lub zapisać rozmowy. Spróbuj ponownie.";

// Losowy sekret w HttpOnly cookie; w bazie przechowujemy tylko jego skrót.
export function chatOwner(request: Request) {
  const existing = request.headers.get("cookie")?.match(/(?:^|;\s*)chat_owner=([a-f0-9]{64})(?:;|$)/)?.[1];
  const token = existing ?? randomBytes(32).toString("hex");
  return {
    id: createHash("sha256").update(token).digest("hex"),
    cookie: `chat_owner=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
  };
}

export function messageText(message: UIMessage): string {
  return message.parts.map(part => {
    if (part.type === "text") return part.text.replace(/data:image\/[^\s)]+/g, "[obraz]");
    if (part.type === "file") return "[obraz]";
    if (part.type === "tool-generujObraz" && "output" in part &&
      (part.output as { ok?: boolean } | undefined)?.ok) return "[obraz]";
    return "";
  }).filter(Boolean).join("\n");
}

export async function openConversation(id: string, owner: string, title: string) {
  const db = getSupabase();
  const { data, error } = await db.from("conversations").select("id,owner_id").eq("id", id).maybeSingle();
  if (error) throw new Error(storageError);
  if (data) {
    if (data.owner_id !== owner) throw new Error(storageError);
    return;
  }
  const { error: inserted } = await db.from("conversations").insert({ id, owner_id: owner, title: title.slice(0, 100) || "Nowa rozmowa" });
  if (inserted) {
    // Równoległe ponowienie pierwszego żądania może już utworzyć rozmowę.
    const { data: existing, error: lookup } = await db.from("conversations").select("owner_id").eq("id", id).maybeSingle();
    if (lookup || existing?.owner_id !== owner) throw new Error(storageError);
  }
}

export async function loadMessages(id: string): Promise<UIMessage[]> {
  const result: UIMessage[] = [];
  // PostgREST ogranicza liczbę wierszy; pobieraj też dłuższe rozmowy.
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await getSupabase().from("messages")
      .select("id,role,content").eq("conversation_id", id)
      .order("position", { ascending: true }).range(offset, offset + 499);
    if (error) throw new Error(storageError);
    for (const row of data ?? []) {
      if (row.role !== "user" && row.role !== "assistant") throw new Error(storageError);
      result.push({ id: row.id.startsWith(`${id}:`) ? row.id.slice(id.length + 1) : row.id,
        role: row.role, parts: [{ type: "text", text: row.content }] });
    }
    if (!data || data.length < 500) return result;
  }
}

export async function latestConversation(owner: string) {
  const { data, error } = await getSupabase().from("conversations").select("id,title")
    .eq("owner_id", owner).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(storageError);
  return data ? { ...data, messages: await loadMessages(data.id) } : null;
}

export async function getConversation(id: string, owner: string) {
  const { data, error } = await getSupabase().from("conversations").select("id,title")
    .eq("id", id).eq("owner_id", owner).maybeSingle();
  if (error) throw new Error(storageError);
  return data ? { ...data, messages: await loadMessages(data.id) } : null;
}

export async function listConversations(owner: string) {
  const result: { id: string; title: string; created_at: string; messageCount: number }[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await getSupabase().from("conversations")
      .select("id,title,created_at,messages(count)").eq("owner_id", owner)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + 499);
    if (error) throw new Error(storageError);
    for (const row of data ?? []) result.push({
      id: row.id, title: row.title, created_at: row.created_at,
      messageCount: row.messages[0]?.count ?? 0,
    });
    if (!data || data.length < 500) return result;
  }
}

export async function saveTurn(id: string, user: UIMessage, assistant: UIMessage) {
  // Jeden atomowy INSERT obu wierszy. Stałe klucze chronią także przed ponowieniem żądania.
  const { error } = await getSupabase().from("messages").upsert([
    { id: `${id}:${user.id}`, conversation_id: id, role: "user", content: messageText(user) },
    { id: `${id}:reply-${user.id}`, conversation_id: id, role: "assistant", content: messageText(assistant) },
  ], { onConflict: "id", ignoreDuplicates: true });
  if (error) throw new Error(storageError);
}
