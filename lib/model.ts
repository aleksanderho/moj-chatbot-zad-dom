import "server-only";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

function provider() {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("Brak konfiguracji OpenRouter.");
  return createOpenRouter({ apiKey });
}

export function getChatModel() {
  const model = process.env.OPENROUTER_MODEL?.trim();
  if (!model) throw new Error("Brak konfiguracji modelu rozmowy.");
  return provider()(model);
}

// Test 2026-11-22: openai/text-embedding-3-small zwrócił 1536 liczb dla „test”.
// Wspólna konfiguracja embeddingów dokumentów i przyszłych zapytań RAG.
export function getEmbeddingModel() {
  const model = process.env.OPENROUTER_EMBEDDING_MODEL?.trim();
  if (!model) throw new Error("Brak konfiguracji modelu embeddingów.");
  return provider().textEmbeddingModel(model);
}
