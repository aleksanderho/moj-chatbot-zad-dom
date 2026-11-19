import { z } from "zod";
import { sameOrigin, validSession } from "../../travel-session.mjs";
import { handleChat } from "../chat/chat-handler.ts";
import { handleAnalyze } from "../analyze/analyze-handler.ts";

export const runtime = "nodejs";
export const maxDuration = 60;
const modeSchema = z.object({ mode: z.enum(["chat", "analyze"]) });
const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  // Authenticate before reading the body, checking configuration or calling any service.
  if (!validSession(request)) return Response.json({ error: { code: "session", message: "Sesja wygasła. Rozpocznij rozmowę ponownie." } }, { status: 401, headers });
  if (!sameOrigin(request)) return Response.json({ error: { code: "origin", message: "Niedozwolone źródło żądania." } }, { status: 403, headers });
  const body = await request.json().catch(() => null);
  const parsed = modeSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: { code: "invalid_mode", message: "Wybierz tryb chat lub analyze." } }, { status: 400, headers });
  if (parsed.data.mode === "chat") return handleChat(request, body);
  const { mode: _mode, ...input } = body;
  return handleAnalyze(request, input);
}
