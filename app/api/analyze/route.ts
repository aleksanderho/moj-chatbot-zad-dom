import { z } from "zod";
import { analyzeMessage, analysisFailure } from "./analysis.mjs";

export const runtime = "nodejs";
export const maxDuration = 60;
const requestSchema = z.strictObject({ message: z.string().trim().min(1).max(20000) });

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const model = process.env.OPENROUTER_MODEL?.trim();
  const headers = { "Cache-Control": "no-store" };
  if (!apiKey || !model) return Response.json({ error: { code: "configuration", message: "Brak konfiguracji. Uzupełnij OPENROUTER_API_KEY i OPENROUTER_MODEL na serwerze." } }, { status: 503, headers });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { code: "invalid_request", message: "Wpisz wiadomość klienta (od 1 do 20 000 znaków)." } }, { status: 400, headers });
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45000)]);
  try {
    const result = await analyzeMessage(parsed.data.message, { apiKey, model, signal });
    signal.throwIfAborted();
    return Response.json({ result }, { headers });
  } catch (error) {
    const failure = analysisFailure(error, signal.aborted);
    return Response.json({ error: { code: failure.code, message: failure.message } }, { status: failure.status, headers });
  }
}
