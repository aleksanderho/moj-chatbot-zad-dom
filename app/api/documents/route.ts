import { z } from "zod";
import { validSession, sameOrigin } from "../../travel-session.mjs";
import { getSupabase } from "../../../lib/supabase.ts";
import { databaseError, importDocument, KnowledgeError, listDocuments, type ImportStage } from "../../../lib/knowledge-store.ts";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };
const version = z.object({ id: z.number().int().positive().safe(), created_at: z.string().datetime({ offset: true }) }).strict();
const schema = z.object({ title: z.string().trim().min(1).max(200), text: z.string().trim().min(1).max(20_000), expected: z.array(version).default([]) }).strict();
function denied(request: Request, mutation = false) {
  if (!validSession(request)) return Response.json({ error: "Sesja wygasła. Wróć do czatu, rozpocznij sesję i ponów operację.", stage: "session" }, { status: 401, headers });
  if (mutation && !sameOrigin(request)) return Response.json({ error: "Niedozwolone źródło żądania. Otwórz formularz w aplikacji.", stage: "validation" }, { status: 403, headers });
}
async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new KnowledgeError("Podaj tytuł i treść dokumentu.", 400);
  let raw = "", bytes = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 320_000) { await reader.cancel(); throw new KnowledgeError("Dokument jest za duży. Skróć treść do 20 000 znaków.", 413); }
      raw += decoder.decode(value, { stream: true });
    }
    return JSON.parse(raw + decoder.decode());
  } finally { reader.releaseLock(); }
}
export async function GET(request: Request) {
  const refusal = denied(request); if (refusal) return refusal;
  try { return Response.json({ documents: await listDocuments() }, { headers }); }
  catch { return Response.json({ error: "Nie udało się pobrać dokumentów. Spróbuj odświeżyć listę." }, { status: 503, headers }); }
}
export async function DELETE(request: Request) {
  const refusal = denied(request, true); if (refusal) return refusal;
  try {
    const parsed = version.safeParse(await readBody(request));
    if (!parsed.success) return Response.json({ error: "Odśwież listę i wybierz dokument ponownie." }, { status: 400, headers });
    const { data, error } = await getSupabase().rpc("delete_knowledge_document", { p_id: parsed.data.id, p_created_at: parsed.data.created_at });
    if (error) throw databaseError(error);
    if (data !== true) throw new KnowledgeError("Nie otrzymano potwierdzenia usunięcia. Odśwież listę.");
    return Response.json({ ok: true }, { headers });
  } catch (error) { return Response.json({ error: error instanceof KnowledgeError ? error.message : "Nie udało się usunąć dokumentu. Odśwież listę i spróbuj ponownie." }, { status: error instanceof KnowledgeError ? error.status : 503, headers }); }
}
export async function POST(request: Request) {
  const refusal = denied(request, true); if (refusal) return refusal;
  let input: z.infer<typeof schema>;
  try {
    const parsed = schema.safeParse(await readBody(request));
    if (!parsed.success) throw new KnowledgeError("Podaj tytuł (1–200 znaków) i treść (1–20 000 znaków).", 400);
    input = parsed.data;
    const existing = await listDocuments(input.title);
    if (existing.length !== input.expected.length || existing.some(row => !input.expected.some(v => v.id === row.id && Date.parse(v.created_at) === Date.parse(row.created_at)))) {
      return Response.json({ error: "Dokument o tym tytule już istnieje lub zmienił wersję. Potwierdź zastąpienie aktualnej wersji.", stage: "confirmation", documents: existing }, { status: 409, headers });
    }
  } catch (error) { return Response.json({ error: error instanceof KnowledgeError ? error.message : "Nie udało się odczytać dokumentu. Sprawdź dane i spróbuj ponownie.", stage: "validation" }, { status: error instanceof KnowledgeError ? error.status : 400, headers }); }
  let stage: ImportStage = "split";
  const failure = (error: unknown) => ({ type: "error", stage, error: error instanceof KnowledgeError ? error.message : "Operacja została przerwana. Sprawdź połączenie i odśwież listę dokumentów przed ponowieniem." });
  if (!request.headers.get("accept")?.includes("application/x-ndjson")) {
    try { return Response.json(await importDocument(input, request.signal, value => { stage = value; }), { status: 201, headers }); }
    catch (error) { return Response.json(failure(error), { status: error instanceof KnowledgeError ? error.status : 503, headers }); }
  }
  const encoder = new TextEncoder();
  let disconnected = false;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => { if (!disconnected) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n")); };
      try {
        const result = await importDocument(input, request.signal, value => { stage = value; send({ type: "progress", stage }); });
        send({ type: "complete", ...result });
      } catch (error) { send(failure(error)); }
      finally { if (!disconnected) controller.close(); }
    },
    cancel() { disconnected = true; },
  });
  return new Response(stream, { headers: { ...headers, "Content-Type": "application/x-ndjson", "X-Accel-Buffering": "no" } });
}
