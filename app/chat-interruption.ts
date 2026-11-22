import type { KnowledgeSource } from "./knowledge-sources.ts";
import { isToolUIPart, type UIMessage } from "ai";

export type AgentMetadata = { knowledgeSources?: KnowledgeSource[]; steps: number; toolCalls: number; elapsedMs: number; interrupted?: boolean; sourcesFetchedAt?: Record<string, string>; modelId?: string; vision?: boolean; generatedImage?: boolean };
export type AgentMessage = UIMessage<AgentMetadata>;

// Called only after SDK stop() has drained the stream, so no late chunk overwrites the note.
export function markInterrupted(messages: AgentMessage[], elapsedMs: number): AgentMessage[] {
  const last = messages.at(-1);
  const assistant: AgentMessage = last?.role === "assistant" ? last : {
    id: crypto.randomUUID(), role: "assistant", parts: [],
  };
  if (assistant.metadata?.interrupted) return messages;
  const updated: AgentMessage = {
    ...assistant,
    parts: [
      ...assistant.parts.map(part => part.type === "text" ? { ...part, state: "done" as const } : part),
      { type: "text", text: "Przerwane przez użytkownika", state: "done" },
    ],
    metadata: {
      ...assistant.metadata,
      sourcesFetchedAt: assistant.metadata?.sourcesFetchedAt,
      steps: assistant.metadata?.steps ?? assistant.parts.filter(part => part.type === "step-start").length,
      toolCalls: assistant.metadata?.toolCalls ?? assistant.parts.filter(isToolUIPart).length,
      elapsedMs: assistant.metadata?.elapsedMs ?? Math.max(0, Math.round(elapsedMs)),
      interrupted: true,
    },
  };
  return last?.role === "assistant" ? [...messages.slice(0, -1), updated] : [...messages, updated];
}

