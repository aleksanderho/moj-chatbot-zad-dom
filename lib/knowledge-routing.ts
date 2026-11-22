import type { UIMessage } from "ai";
const companyTopic = /(?:\b(?:ofert\w*|cen[ayęie]\w*|cennik\w*|koszt\w*|zapłac\w*|plac\w*|płat\w*|platn\w*|rabat\w*|promoc\w*|regulamin\w*|zasad\w*|firm\w*|sklep\w*|sof\w*|narożnik\w*|naroznik\w*|fotel\w*|mebl\w*|materac\w*|dostaw\w*|zwrot\w*|reklamac\w*|gwaranc\w*)\b|i-sofa)/iu;
const acknowledgement = /^(?:dziękuję|dzieki|dzięki|ok|okej|rozumiem|super|cześć|hej)[.!\s]*$/iu;
const unrelated = /\b(?:pogod\w*|oblicz|pomnóż|podziel|godzin\w*|stolic\w*|kurs walut)\b/iu;
const textOf = (message: UIMessage) => message.parts.filter(part => part.type === "text").map(part => part.text).join("\n").trim();

export function requiresKnowledgeSearch(messages: UIMessage[]): boolean {
  const users = messages.filter(message => message.role === "user");
  const current = users.at(-1);
  if (!current) return false;
  const text = textOf(current);
  if (!text || acknowledgement.test(text)) return false;
  if (companyTopic.test(text)) return true;
  // Krótkie doprecyzowanie (np. „Bella”, „140 cm”, „A z pojemnikiem?”).
  // Uwzględniamy poprzednie wypowiedzi użytkownika, nie deklaracje błędu asystenta.
  if (text.length <= 160 && !unrelated.test(text)) {
    return users.slice(-4, -1).some(message => companyTopic.test(textOf(message)));
  }
  return false;
}
export function knowledgeStepPolicy(required: boolean, stepNumber: number) {
  return required && stepNumber === 0 ? { toolChoice: { type: "tool" as const, toolName: "searchKnowledge" as const } } : {};
}
