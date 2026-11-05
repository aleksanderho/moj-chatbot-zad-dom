import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { APICallError, convertToModelMessages, streamText } from "ai";
import { z } from "zod";

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

// This chat accepts only text from the user and the previous assistant replies.
const requestSchema = z.object({
  messages: z.array(z.object({
    id: z.string().min(1),
    role: z.enum(["user", "assistant"]),
    parts: z.array(z.discriminatedUnion("type", [
      z.object({ type: z.literal("text"), text: z.string() }),
      z.object({ type: z.literal("step-start") }),
      z.object({ type: z.literal("reasoning"), text: z.string() }),
    ])).min(1).transform((parts) => parts.filter((part) => part.type === "text")),
  })).min(1),
});

export async function POST(request: Request) {
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
    const result = streamText({
      model: openrouter(model),
      messages: await convertToModelMessages(messages),
      abortSignal: request.signal,
      maxRetries: 0,
      // Do not log provider errors, which may contain request details.
      onError: () => {},
    });

    return result.toUIMessageStreamResponse({
      onError: providerErrorMessage,
    });
  } catch (error) {
    return new Response(providerErrorMessage(error), { status: 500 });
  }
}
