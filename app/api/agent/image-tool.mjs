import { generateImage, tool } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import { withinSignal } from "../chat/task-budget.mjs";

export function createImageTool({ apiKey, signal, budget }) {
  return tool({
    description: "Wygeneruj nowy obraz na wyraźną prośbę użytkownika, np. wizualizację salonu, sofy lub fotela. Podaj opis obrazu do 500 znaków. To tworzenie obrazu, a nie analiza przesłanego zdjęcia. Obraz i identyfikator modelu są pokazywane bezpośrednio użytkownikowi; po sukcesie wystarczy krótkie potwierdzenie. Nie wypisuj pliku ani kodu base64.",
    inputSchema: z.object({ prompt: z.string().trim().min(1).max(500) }),
    execute: async ({ prompt }) => {
      if (budget && !budget.admit()) return { ok: false, message: "Osiągnięto limit zadania. Obraz nie został wygenerowany." };
      const timedSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(55000)]);
      try {
        const openrouter = createOpenRouter({ apiKey });
        const result = await withinSignal(() => generateImage({
          model: openrouter.imageModel("google/gemini-3.1-flash-image-preview"),
          prompt, maxRetries: 0, abortSignal: timedSignal,
        }), timedSignal);
        const modelId = result.responses[0]?.modelId;
        if (!modelId?.trim()) throw new Error("missing model id");
        return { ok: true, url: `data:${result.image.mediaType};base64,${result.image.base64}`, mediaType: result.image.mediaType, modelId };
      } catch {
        const message = timedSignal.aborted ? "Upłynął czas generowania obrazu. Spróbuj ponownie."
          : "Nie udało się wygenerować obrazu. Model może być niedostępny, odrzucić opis lub konto nie ma środków. Spróbuj ponownie później lub zmień opis.";
        budget?.fail(message);
        return { ok: false, message };
      }
    },
    // The full result goes to the UI, only this short text returns to the model.
    toModelOutput: ({ output }) => ({ type: "text", value: output.ok ? "obraz wygenerowany" : output.message }),
  });
}
