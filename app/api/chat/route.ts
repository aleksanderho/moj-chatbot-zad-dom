import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { APICallError, convertToModelMessages, createUIMessageStreamResponse, streamText, stepCountIs } from "ai";
import { withLimitSummary } from "./agent-loop.mjs";
import { createTaskBudget } from "./task-budget.mjs";
import { randomUUID } from "node:crypto";
import { createTools, STEP_LIMIT } from "./tools.mjs";
import { z } from "zod";
import { exampleMessages } from "./chat-instructions.mjs";
import { systemPrompt } from "./instructions.mjs";

export const runtime = "nodejs";
export const maxDuration = 60;

function providerErrorMessage(error: unknown): string {
  let code: number | undefined;
  if (APICallError.isInstance(error)) {
    code = error.statusCode;
  }
  // Some providers report errors inside a stream rather than as HTTP errors.
  const streamError = z.object({
    code: z.number().optional(),
    error: z.object({ code: z.number().optional() }).optional(),
  }).safeParse(error);
  if (code === undefined && streamError.success) {
    code = streamError.data.error?.code ?? streamError.data.code;
  }

  switch (code) {
    case 400: return "OpenRouter (400): Nieprawidłowe żądanie lub identyfikator modelu. Sprawdź OPENROUTER_MODEL w .env.local.";
    case 401: return "OpenRouter (401): Klucz API jest nieprawidłowy lub nieaktywny. Popraw OPENROUTER_API_KEY w .env.local.";
    case 402: return "OpenRouter (402): Niewystarczające środki lub limit wydatków klucza. Sprawdź saldo i limity w panelu OpenRouter.";
    case 403: return "OpenRouter (403): Dostęp zablokowany. Sprawdź uprawnienia klucza i zasady konta OpenRouter.";
    case 404: return "OpenRouter (404): Nie znaleziono modelu lub jego dostawcy. Sprawdź dokładny identyfikator OPENROUTER_MODEL w .env.local.";
    case 408: case 504: return "OpenRouter (408/504): Przekroczono czas oczekiwania. Spróbuj ponownie za chwilę.";
    case 429: return "OpenRouter (429): Przekroczono limit zapytań. Odczekaj chwilę przed ponowną próbą.";
    case 502: case 503: return "OpenRouter (502/503): Model jest chwilowo niedostępny. Spróbuj później lub wybierz inny model w .env.local.";
    default: return "Nie udało się uzyskać odpowiedzi AI. Błąd połączenia lub nieoczekiwana odpowiedź OpenRouter. Spróbuj ponownie.";
  }
}

// Accept tool UI parts on subsequent turns, but never trust client tool results.
// Only text is forwarded; current-turn results come directly from server tools.
const requestSchema = z.object({
  stepByStep: z.boolean().default(false),
  mode: z.literal("chat").default("chat"),
  messages: z.array(z.object({
    id: z.string().min(1),
    role: z.enum(["user", "assistant"]),
    parts: z.array(z.union([
      z.object({ type: z.literal("text"), text: z.string() }),
      z.object({ type: z.literal("step-start") }),
      z.object({ type: z.literal("reasoning"), text: z.string() }),
      z.object({ type: z.string().refine((value) => value.startsWith("tool-") || value === "dynamic-tool" || value === "source-url") }),
    ])).min(1).transform((parts) => parts.filter((part): part is { type: "text"; text: string } => part.type === "text" && "text" in part)),
  })).min(1),
});

export async function POST(request: Request) {
  const started = performance.now();
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const model = process.env.OPENROUTER_MODEL?.trim();

  if (!apiKey || !model) {
    return new Response(
      "Brak konfiguracji. Uzupełnij OPENROUTER_API_KEY i OPENROUTER_MODEL w pliku .env.local.",
      { status: 503 },
    );
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return new Response("Nieprawidłowa historia rozmowy.", { status: 400 });
  }
  const messages = parsed.data.messages;
  const lastMessage = messages.at(-1)!;
  if (lastMessage.role !== "user" || !lastMessage.parts.some((part) => part.text.trim())) {
    return new Response("Wpisz wiadomość przed wysłaniem.", { status: 400 });
  }

  try {
    const openrouter = createOpenRouter({ apiKey });
    const existingOwner = request.headers.get("cookie")?.match(/(?:^|;\s*)chat_notes=([a-f0-9-]{36})(?:;|$)/)?.[1];
    const owner = existingOwner ?? randomUUID();
    const budget = createTaskBudget({ signal: request.signal, timeoutMs: Math.max(1, 60000 - (performance.now() - started)) });
    const tools = {
      ...createTools({ model, owner, signal: budget.signal, budget }),
      webSearch: openrouter.tools.webSearch({ maxResults: 3, engine: "native" }),
    };
    const result = streamText({
      model: openrouter(model),
      system: systemPrompt(parsed.data.stepByStep),
      tools,
      stopWhen: [stepCountIs(STEP_LIMIT), () => Boolean(budget.reason)],
      prepareStep: () => { budget.steps++; return {}; },
      onStepFinish: ({ toolResults, toolCalls }) => {
        const pendingLocal = toolCalls.filter(call => !call.providerExecuted && !toolResults.some(result => result.toolCallId === call.toolCallId));
        if (pendingLocal.length > 0 && !budget.reason) budget.fail("Nie udało się poprawnie wykonać wywołania narzędzia.");
      },
      messages: [...exampleMessages, ...await convertToModelMessages(messages)],
      abortSignal: budget.signal,
      maxRetries: 0,
      // Do not log provider errors, which may contain request details.
      onError: () => {},
    });

    return createUIMessageStreamResponse({
      headers: existingOwner ? {} : { "Set-Cookie": `chat_notes=${owner}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${new URL(request.url).protocol === "https:" ? "; Secure" : ""}` },
      stream: result.toUIMessageStream({
        sendSources: true,
        sendReasoning: false,
        onError: providerErrorMessage,
      }).pipeThrough(withLimitSummary(budget)),
    });
  } catch (error) {
    return new Response(providerErrorMessage(error), { status: 500 });
  }
}
