import { STEP_LIMIT } from "./tools.mjs";

// This transform adds a deterministic ending without another model call.
export function withLimitSummary(budget) {
  const started = performance.now();
  let steps = 0;
  let finished = false;
  const names = new Map();
  const results = [];
  const pending = new Set();
  const openText = new Set();
  const sourcesFetchedAt = {};
  return new TransformStream({
    transform(chunk, controller) {
      if (chunk.type === "source-url") {
        sourcesFetchedAt[chunk.sourceId] ??= new Date().toISOString();
        controller.enqueue({ type: "message-metadata", messageMetadata: { sourcesFetchedAt: { ...sourcesFetchedAt } } });
      }
      if (chunk.type === "start-step") steps++;
      if (chunk.type === "text-start") openText.add(chunk.id);
      if (chunk.type === "text-end") openText.delete(chunk.id);
      if (chunk.type === "tool-input-start" || chunk.type === "tool-input-available") {
        names.set(chunk.toolCallId, chunk.toolName);
        pending.add(chunk.toolCallId);
      }
      if (chunk.type === "tool-output-available") {
        pending.delete(chunk.toolCallId);
        results.push({ name: names.get(chunk.toolCallId) ?? "narzędzie", output: chunk.output });
      }
      if (chunk.type === "tool-output-error") {
        pending.delete(chunk.toolCallId);
        budget?.fail("Nie udało się poprawnie wykonać narzędzia " + (names.get(chunk.toolCallId) ?? "") + ".");
        results.push({ name: names.get(chunk.toolCallId) ?? "narzędzie", output: { ok: false, message: "Nie udało się wykonać narzędzia." } });
      }
      const timedOut = budget?.reason === "timeout";
      if (finished) return;
      if (timedOut && chunk.type === "error") return;
      if (chunk.type === "finish" || (chunk.type === "abort" && timedOut)) {
        for (const id of openText) controller.enqueue({ type: "text-end", id });
        if (timedOut) for (const id of pending) {
          const message = `Nie udało się sprawdzić: ${names.get(id) ?? "narzędzie"} — upłynął czas zadania.`;
          controller.enqueue({ type: "tool-output-error", toolCallId: id, errorText: message });
          results.push({ name: names.get(id) ?? "narzędzie", output: { ok: false, message } });
        }
        const reason = budget?.reason;
        if (reason || steps >= STEP_LIMIT) {
        const findings = results.map(({ name, output }) => {
          if (name === "generujObraz" && output?.ok) return `${name}: obraz wygenerowany (model: ${output.modelId}).`;
          const formatted = JSON.stringify(output, null, 2) ?? "Brak wyniku.";
          return `${name}:\n${formatted.length > 3000 ? formatted.slice(0, 3000) + "\n… (skrócono wynik)" : formatted}`;
        });
        const heading = reason === "timeout" ? "Zatrzymałem się po 60 sekundach. Nie udało się ukończyć zadania."
          : reason === "error" ? `Nie udało się dokończyć sprawdzania: ${budget.failure} Kończę z wynikiem częściowym.`
          : reason === "tools" ? "Zatrzymałem się po 16 wywołaniach narzędzi."
          : `Przerwałem po ${STEP_LIMIT} krokach`;
        const summary = `\n\n${heading}\n\n` + (findings.length
          ? "Wyniki zebrane do tej pory (błędy oznaczają brak potwierdzonych danych):\n\n" + findings.join("\n\n")
          : "Nie uzyskałem potwierdzonych wyników narzędzi. Powyżej znajduje się dotychczasowa odpowiedź, jeśli została przygotowana.");
        const id = "agent-limit-summary";
        controller.enqueue({ type: "text-start", id });
        controller.enqueue({ type: "text-delta", id, delta: summary });
        controller.enqueue({ type: "text-end", id });
        }
        finished = true;
        budget?.dispose();
        controller.enqueue({ type: "finish", finishReason: chunk.type === "finish" ? chunk.finishReason : "stop", messageMetadata: {
          sourcesFetchedAt,
          steps: budget?.steps || steps, toolCalls: budget?.calls ?? results.length, elapsedMs: budget?.elapsedMs() ?? Math.round(performance.now() - started),
        } });
        return;
      }
      controller.enqueue(chunk);
    },
    flush() { budget?.dispose(); },
  });
}
