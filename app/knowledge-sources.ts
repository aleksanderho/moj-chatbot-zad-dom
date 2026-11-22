import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { KNOWLEDGE_MIN_SIMILARITY } from "../lib/knowledge-config.ts";

export type KnowledgeSource = { sourceId: string; title: string; content: string; similarity: number };
// History stores a snapshot of sources approved when the answer was written.
// Do not reapply a later calibration threshold to an existing answer.
export function parseKnowledgeSources(value: unknown): KnowledgeSource[] {
  if (!Array.isArray(value)) return [];
  return value.filter((source): source is KnowledgeSource => Boolean(source) &&
    typeof source.sourceId === "string" && /^[a-zA-Z0-9_-]+$/.test(source.sourceId) &&
    typeof source.title === "string" && typeof source.content === "string" &&
    Number.isFinite(source.similarity) && source.similarity >= 0 && source.similarity <= 1)
    .map(({ sourceId, title, content, similarity }) => ({ sourceId, title, content, similarity }));
}
export function knowledgeSources(parts: UIMessage["parts"], saved?: KnowledgeSource[]): KnowledgeSource[] {
  const text = parts.filter(p => p.type === "text").map(p => p.text).join("\n");
  const cited = new Set([...text.matchAll(/\[\[kb:([a-zA-Z0-9_-]+)\]\]/g)].map(match => match[1]));
  const sources = new Map<string, KnowledgeSource>();
  if (saved) return parseKnowledgeSources(saved).filter(source => cited.has(source.sourceId));
  for (const part of parts) {
    if (!isToolUIPart(part) || getToolName(part) !== "searchKnowledge" || part.state !== "output-available") continue;
    const output = part.output as { ok?: boolean; fragments?: KnowledgeSource[] } | undefined;
    if (!output?.ok || !Array.isArray(output.fragments)) continue;
    for (const fragment of output.fragments) {
      if (cited.has(fragment.sourceId) && typeof fragment.title === "string" && typeof fragment.content === "string" && Number.isFinite(fragment.similarity) && fragment.similarity >= KNOWLEDGE_MIN_SIMILARITY && fragment.similarity <= 1) sources.set(fragment.sourceId, fragment);
    }
  }
  return [...sources.values()];
}
export function withoutKnowledgeMarkers(text: string) {
  return text.replace(/\[\[kb:[a-zA-Z0-9_-]+\]\]/g, "").replace(/\[\[kb:[a-zA-Z0-9_-]*\]?$/, "");
}

