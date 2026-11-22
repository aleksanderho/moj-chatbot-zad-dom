import "server-only";
import { embedMany } from "ai";
import { getEmbeddingModel } from "./model.ts";
import { getSupabase } from "./supabase.ts";
import { splitDocument } from "./document-chunks.ts";

export type Version = { id: number; created_at: string };
export type ImportStage = "split" | "embedding" | "save";
export class KnowledgeError extends Error {
  status: number;
  constructor(message: string, status = 503) { super(message); this.status = status; }
}
export function databaseError(error: { code?: string; message?: string }): KnowledgeError {
  if (error.message?.includes("knowledge_version_conflict")) return new KnowledgeError("Dokument zmienił się w innej karcie. Odśwież listę i ponownie potwierdź operację.", 409);
  if (error.message?.includes("knowledge_pending_changed")) return new KnowledgeError("W bazie pojawiły się nowe fragmenty bez embeddingów. Spróbuj ponownie, aby je uzupełnić.", 409);
  if (error.code === "PGRST202") return new KnowledgeError("Baza wymaga aktualizacji. Uruchom migrację knowledge_document_versions w Supabase SQL Editor, a potem spróbuj ponownie.");
  return new KnowledgeError("Nie udało się zatwierdzić operacji w bazie. Odśwież listę, aby sprawdzić wynik, i spróbuj ponownie. Poprzednia wersja jest chroniona transakcją.");
}
export async function listDocuments(title?: string) {
  const db = getSupabase();
  const documents: { id: number; title: string; created_at: string; chunks: number }[] = [];
  let after: number | undefined;
  while (true) {
    let query = db.from("documents").select("id, title, created_at, chunks(count)").order("id").limit(500);
    if (title !== undefined) query = query.eq("title", title);
    if (after !== undefined) query = query.gt("id", after);
    const { data, error } = await query;
    if (error || !data) throw new KnowledgeError("Nie udało się pobrać dokumentów. Sprawdź połączenie i odśwież listę.");
    if (!data.length) return documents;
    documents.push(...data.map(row => ({ ...row, chunks: row.chunks[0]?.count ?? 0 })));
    after = data[data.length - 1].id;
  }
}
export async function importDocument(input: { title: string; text: string; expected: Version[] }, signal: AbortSignal, progress: (stage: ImportStage) => void) {
  progress("split");
  const content = splitDocument(input.text);
  const db = getSupabase();
  const pending: { id: number; content: string }[] = [];
  let after: number | undefined;
  while (true) {
    let query = db.from("chunks").select("id, content, document_id").is("embedding", null).order("id").limit(500);
    if (after !== undefined) query = query.gt("id", after);
    const { data, error } = await query;
    if (error || !data) throw new KnowledgeError("Nie udało się odczytać fragmentów. Sprawdź połączenie z bazą i ponów import.");
    if (!data.length) break;
    // Stare fragmenty zastępowanego źródła zostaną usunięte, nie wymagają embeddingów.
    pending.push(...data.filter(row => !input.expected.some(version => version.id === row.document_id)));
    after = data[data.length - 1].id;
  }
  progress("embedding");
  const values = [...content, ...pending.map(chunk => chunk.content)];
  let embeddings: number[][];
  try {
    ({ embeddings } = await embedMany({ model: getEmbeddingModel(), values, maxRetries: 0, maxParallelCalls: 2,
      abortSignal: AbortSignal.any([signal, AbortSignal.timeout(40_000)]) }));
  } catch { throw new KnowledgeError("Nie udało się utworzyć embeddingów. Sprawdź model, klucz i saldo OpenRouter, a potem ponów import. Dokumenty nie zostały zmienione."); }
  if (embeddings.length !== values.length || embeddings.some(vector => vector.length !== 1536 || !vector.every(Number.isFinite))) {
    throw new KnowledgeError("Model musi zwracać 1536 liczb na fragment. Sprawdź OPENROUTER_EMBEDDING_MODEL. Dokumenty nie zostały zmienione.", 502);
  }
  signal.throwIfAborted();
  progress("save");
  const { data, error } = await db.rpc("save_knowledge_document", {
    p_title: input.title, p_expected: input.expected,
    p_chunks: content.map((text, index) => ({ chunk_index: index, content: text, embedding: embeddings[index] })),
    p_pending: pending.map((chunk, index) => ({ id: chunk.id, content: chunk.content, embedding: embeddings[content.length + index] })),
  });
  if (error) throw databaseError(error);
  if (!data || data.title !== input.title || data.chunks !== content.length || !data.documentId) throw new KnowledgeError("Nie otrzymano potwierdzenia zapisu. Odśwież listę przed ponowieniem importu.");
  return data;
}
