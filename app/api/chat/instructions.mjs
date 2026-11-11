import { companyFacts, persona, reasoningInstruction, responseFormat, rules } from "./chat-instructions.mjs";

// Assembled by the server, never taken from the user's message or request body.
export function systemPrompt(stepByStep = false) {
  return [
    `Persona: ${persona}`,
    `Informacje firmy:\n${companyFacts.map((fact) => `- ${fact}`).join("\n")}`,
    `Zasady:\n${rules.map((rule) => `- ${rule}`).join("\n")}`,
    `Format: ${responseFormat}`,
    ...(stepByStep ? [reasoningInstruction] : []),
  ].join("\n\n");
}
