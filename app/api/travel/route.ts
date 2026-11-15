import { z } from "zod";
import { sameOrigin, validSession } from "../../travel-session.mjs";
import { travelReport } from "./travel.mjs";
import { compareTravel } from "./compare.mjs";

const schema = z.object({ miasto: z.string().trim().min(2).max(160), drugieMiasto: z.string().trim().min(2).max(160).optional(), dzien: z.iso.date().refine(day => Number(day.slice(0, 4)) >= 1900 && Number(day.slice(0, 4)) <= 2099) });
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  if (!validSession(request)) return Response.json({ error: "Sesja wygasła. Odśwież stronę." }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: "Niedozwolone źródło żądania." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Podaj miasto i poprawną datę." }, { status: 400 });
  try {
    const options = { signal: AbortSignal.any([request.signal, AbortSignal.timeout(60000)]) };
    const result = parsed.data.drugieMiasto
      ? await compareTravel({ ...parsed.data, drugieMiasto: parsed.data.drugieMiasto }, options)
      : await travelReport(parsed.data, options);
    return Response.json(result, { status: "error" in result ? 404 : 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Nie udało się ustalić miasta — źródło nie odpowiada. Spróbuj ponownie." }, { status: 502 });
  }
}
