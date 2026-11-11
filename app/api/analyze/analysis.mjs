import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { APICallError, generateText, NoObjectGeneratedError, NoOutputGeneratedError, Output } from "ai";
import { z } from "zod";
import { analysisSchema, validateAnalysis } from "../../analysis-schema.mjs";
import { companyFacts, persona, rules } from "../chat/chat-instructions.mjs";

export class AnalysisError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const unsupported = () => new AnalysisError("unsupported_model",
  "Ustawiony model lub jego dostawca nie obsługuje wymaganego structured output. W OPENROUTER_MODEL potrzebny jest model z obsługą structured_outputs oraz dostępny endpoint obsługujący json_schema. Model nie został zmieniony. Wybór modelu o innym koszcie wymaga Twojej zgody.", 422);

const modelsSchema = z.object({ data: z.array(z.object({
  id: z.string(), supported_parameters: z.array(z.string()).optional(),
})) });

export async function checkModelSupport(model, signal) {
  // Public metadata only. No generation and no API key in this request.
  const response = await fetch("https://openrouter.ai/api/v1/models", { signal, cache: "no-store" });
  if (!response.ok) throw new AnalysisError("capability_check", "Nie udało się sprawdzić możliwości modelu w OpenRouter. Spróbuj ponownie; analiza nie została uruchomiona.", 503);
  const parsed = modelsSchema.safeParse(await response.json());
  if (!parsed.success) throw new AnalysisError("capability_check", "OpenRouter zwrócił nieprawidłowy opis możliwości modeli. Analiza nie została uruchomiona.", 503);
  const configured = parsed.data.data.find((entry) => entry.id === model);
  if (!configured?.supported_parameters?.includes("structured_outputs")) throw unsupported();
}

export const analysisSystem = [
  persona,
  `Informacje firmy:\n${companyFacts.join("\n")}`,
  `Zasady:\n${rules.join("\n")}`,
  "Analizuj wyłącznie podaną wiadomość klienta i zwróć obiekt zgodny ze schematem.",
  "category: sales = oferta i cena; support = problem techniczny; billing = płatność lub zwrot; unknown = brak rozpoznanej sprawy. Jeśli wiadomość zawiera kilka spraw, wybierz główną; przy niejasności ustaw needs_review=true.",
  "priority: high wyłącznie przy blokadzie opłaconego spotkania zaczynającego się w ciągu godziny. Muszą być podane wszystkie te warunki. Pozostałe sprawy, także pilne zamówienia mebli, mają normal. Nie zakładaj, że i-sofa oferuje spotkania, i nie rezerwuj ich.",
  "needs_review=true przy braku danych lub konieczności decyzji pracownika. Każdy wynik jest szkicem, także przy needs_review=false.",
  "draft: krótka, uprzejma propozycja odpowiedzi po polsku. Przy brakach wskaż je w szkicu i skieruj sprawę do pracownika, bez twierdzenia, że przekazanie już nastąpiło. Nie dodawaj innych pól.",
].join("\n\n");

const examples = [
  ["Proszę o ofertę 8 sof.", { category: "sales", priority: "normal", draft: "Dziękuję za wiadomość. Czy chodzi o osiem sof do spania codziennego, czy bez funkcji spania? Model i wycena większej liczby sztuk wymagają sprawdzenia przez pracownika.", needs_review: true }],
  ["Nie mogę się zalogować.", { category: "support", priority: "normal", draft: "Napisz proszę, jaki komunikat pojawia się podczas logowania. Przyczyna problemu wymaga sprawdzenia przez pracownika.", needs_review: true }],
  ["Proszę o zwrot mojej wpłaty.", { category: "billing", priority: "normal", draft: "Dziękuję za wiadomość. Możliwość i warunki zwrotu wymagają sprawdzenia przez pracownika sklepu. Prosimy o kontakt z pracownikiem w tej sprawie.", needs_review: true }],
  ["Dzień dobry.", { category: "unknown", priority: "normal", draft: "Dzień dobry, w czym możemy pomóc? Prosimy o doprecyzowanie sprawy, aby pracownik mógł ją sprawdzić.", needs_review: true }],
  ["Nie działa link do opłaconego spotkania. Zaczyna się za 30 minut.", { category: "support", priority: "high", draft: "Dziękuję za zgłoszenie. Prosimy o pilny kontakt z pracownikiem w celu sprawdzenia blokady dostępu do wskazanego spotkania.", needs_review: true }],
];

export async function analyzeMessage(message, { apiKey, model, signal }) {
  await checkModelSupport(model, signal);
  const openrouter = createOpenRouter({
    apiKey,
    fetch: async (url, options) => {
      const response = await fetch(url, options);
      // This provider version does not expose the refusal field in its content.
      // Inspect it before SDK parsing, without returning or logging raw details.
      if (response.ok) {
        const body = await response.clone().json().catch(() => null);
        if (body?.choices?.some((choice) => choice.message?.refusal || choice.finish_reason === "content_filter")) {
          throw new AnalysisError("refusal", "Model odmówił przygotowania analizy. Wynik nie został utworzony.");
        }
        if (body?.choices?.some((choice) => choice.finish_reason && choice.finish_reason !== "stop")) {
          throw new AnalysisError("incomplete", "Odpowiedź modelu została przerwana lub nie została ukończona. Nie ma poprawnego wyniku analizy. Spróbuj ponownie.");
        }
      }
      return response;
    },
  });
  const result = await generateText({
    model: openrouter(model, {
      structuredOutputs: { strict: true },
      provider: { require_parameters: true, allow_fallbacks: false },
    }),
    output: Output.object({ name: "i_sofa_message_analysis", schema: analysisSchema }),
    system: analysisSystem,
    messages: [
      ...examples.flatMap(([question, answer]) => [
        { role: /** @type {const} */ ("user"), content: question },
        { role: /** @type {const} */ ("assistant"), content: JSON.stringify(answer) },
      ]),
      { role: "user", content: message },
    ],
    abortSignal: signal,
    maxRetries: 0,
  });
  if (result.finishReason !== "stop") throw new AnalysisError("incomplete", "Odpowiedź modelu nie została ukończona. Analiza została odrzucona.");
  // SDK validation + explicit server boundary validation. No repaired fallback.
  const parsed = validateAnalysis(result.output);
  if (!parsed.success) throw new AnalysisError("invalid_output", "Model zwrócił wynik niezgodny ze schematem. Analiza została odrzucona.");
  return parsed.data;
}

export function analysisFailure(error, aborted = false) {
  if (aborted || error?.name === "AbortError" || error?.name === "TimeoutError") {
    return new AnalysisError("interrupted", "Analiza została przerwana lub przekroczyła czas oczekiwania. Nie ma zatwierdzonego wyniku.", 408);
  }
  if (error instanceof AnalysisError) return error;
  if (NoObjectGeneratedError.isInstance(error) || NoOutputGeneratedError.isInstance(error)) {
    return new AnalysisError("invalid_output", "Model nie zwrócił kompletnego wyniku zgodnego ze schematem (brakujące, dodatkowe lub nieprawidłowe pola). Analiza została odrzucona.");
  }
  if (APICallError.isInstance(error)) {
    if ([400, 404, 422].includes(error.statusCode)) return unsupported();
    const descriptions = {
      401: "Sprawdź OPENROUTER_API_KEY na serwerze.",
      402: "Sprawdź saldo i limit wydatków OpenRouter.",
      403: "Sprawdź uprawnienia klucza i zasady konta OpenRouter.",
      429: "Przekroczono limit zapytań. Spróbuj później.",
    };
    return new AnalysisError("provider_error", `Błąd dostawcy analizy (${error.statusCode ?? "nieznany"}). ${descriptions[error.statusCode] ?? "Spróbuj ponownie później."}`);
  }
  return new AnalysisError("provider_error", "Nie udało się uzyskać analizy: błąd połączenia lub nieprawidłowa odpowiedź dostawcy. Spróbuj ponownie.");
}
