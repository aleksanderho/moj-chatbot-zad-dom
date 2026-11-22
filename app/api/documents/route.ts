import { z } from "zod";
import { validSession, sameOrigin } from "../../travel-session.mjs";
import { getSupabase } from "../../../lib/supabase.ts";
import { splitDocument } from "../../../lib/document-chunks.ts";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };
const schema = z.object({
  title: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(20_000),
}).strict();

export async function POST(request: Request) {
  if (!validSession(request)) return Response.json({ error: "Sesja wygasła. Rozpocznij rozmowę ponownie." }, { status: 401, headers });
  if (!sameOrigin(request)) return Response.json({ error: "Niedozwolone źródło żądania." }, { status: 403, headers });

  // Ogranicz także rzeczywisty rozmiar strumienia, nie tylko Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "Podaj tytuł i tekst dokumentu." }, { status: 400, headers });
  let raw = "";
  let bytes = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 320_000) {
        await reader.cancel();
        return Response.json({ error: "Dokument jest za duży." }, { status: 413, headers });
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } catch {
    return Response.json({ error: "Nie udało się odczytać dokumentu." }, { status: 400, headers });
  } finally { reader.releaseLock(); }
  const parsed = schema.safeParse(await Promise.resolve().then(() => JSON.parse(raw)).catch(() => null));
  if (!parsed.success) return Response.json({ error: "Podaj tytuł (1–200 znaków) i tekst (1–20 000 znaków)." }, { status: 400, headers });

  const content = splitDocument(parsed.data.text);
  try {
    const db = getSupabase();
    const { data: document, error: documentError } = await db.from("documents")
      .insert({ title: parsed.data.title }).select("id").single();
    if (documentError || !document) throw new Error("Nie udało się zapisać dokumentu.");
    try {
      const { error } = await db.from("chunks").insert(content.map((text, index) => ({
        document_id: document.id, chunk_index: index, content: text,
      })));
      if (error) throw new Error("Nie udało się zapisać fragmentów.");
    } catch {
      // Osobne żądania REST nie są transakcją: posprzątaj po nieudanym zapisie.
      const cleanupChunks = await db.from("chunks").delete().eq("document_id", document.id);
      const cleanupDocument = cleanupChunks.error ? null : await db.from("documents").delete().eq("id", document.id);
      if (cleanupChunks.error || !cleanupDocument || cleanupDocument.error) {
        return Response.json({ error: "Zapis nie został potwierdzony, a sprzątanie nie powiodło się. Sprawdź dokument w Supabase przed ponowieniem.", documentId: document.id }, { status: 503, headers });
      }
      throw new Error("Zapis wycofany.");
    }
    return Response.json({ documentId: document.id, title: parsed.data.title, chunks: content.length }, { status: 201, headers });
  } catch {
    return Response.json({ error: "Nie udało się zapisać dokumentu. Spróbuj ponownie za chwilę." }, { status: 503, headers });
  }
}

