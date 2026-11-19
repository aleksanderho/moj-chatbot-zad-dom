import { getToolName, isToolUIPart } from "ai";
import type { AgentMessage } from "./chat-interruption.ts";

export function usedToolLabels(parts: AgentMessage["parts"]) {
  const labels: { id: string; name: string }[] = [];
  const explicitSearchSteps = new Set<number>();
  let step = 0;
  for (const part of parts) {
    if (part.type === "step-start") step++;
    if (isToolUIPart(part) && getToolName(part) === "webSearch") explicitSearchSteps.add(step);
  }
  const nativeSearchSteps = new Set<number>();
  step = 0;
  for (const part of parts) {
    if (part.type === "step-start") step++;
    if (isToolUIPart(part)) labels.push({ id: part.toolCallId, name: getToolName(part) });
    // Native search may emit citations without a tool-call part. Several citations
    // from one step describe one search, placed where its first citation arrived.
    if (part.type === "source-url" && /^https?:\/\//i.test(part.url) && !explicitSearchSteps.has(step) && !nativeSearchSteps.has(step)) {
      nativeSearchSteps.add(step);
      labels.push({ id: `native-search-${step}`, name: "webSearch" });
    }
  }
  return labels;
}
