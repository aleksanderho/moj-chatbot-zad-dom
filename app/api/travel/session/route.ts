import { issueSession, sameOrigin, SESSION_COOKIE } from "../../../travel-session.mjs";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Niedozwolone źródło żądania.", { status: 403 });
  try {
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store", "Set-Cookie": `${SESSION_COOKIE}=${issueSession()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${new URL(request.url).protocol === "https:" ? "; Secure" : ""}` } });
  } catch {
    return Response.json({ error: "Brak konfiguracji sesji na serwerze." }, { status: 503 });
  }
}
