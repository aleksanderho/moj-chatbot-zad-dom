import { z } from "zod";
import { validSession, sameOrigin } from "../../travel-session.mjs";
import { readProfileRecord, safeProfileValue } from "../../../lib/user-profile.ts";
import { getSupabase } from "../../../lib/supabase.ts";

const headers = { "Cache-Control": "no-store" };
function denied(request: Request, mutation = false) {
  if (!validSession(request)) return Response.json({ error: "Sesja wygasła. Odśwież stronę." }, { status: 401, headers });
  if (mutation && !sameOrigin(request)) return Response.json({ error: "Niedozwolone źródło żądania." }, { status: 403, headers });
}
const failure = () => Response.json({ error: "Nie udało się odczytać lub zmienić profilu. Spróbuj ponownie." }, { status: 503, headers });

export async function GET(request: Request) {
  const refusal = denied(request);
  if (refusal) return refusal;
  try { return Response.json({ profile: await readProfileRecord() }, { headers }); }
  catch { return failure(); }
}

const changeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("name"), value: z.string().trim().min(1).max(80).nullable() }).strict(),
  z.object({ kind: z.literal("preference"), key: z.string().min(1).max(100), value: z.string().trim().min(1).max(160).nullable() }).strict(),
]);

export async function PATCH(request: Request) {
  const refusal = denied(request, true);
  if (refusal) return refusal;
  const parsed = changeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || (parsed.data.value !== null && !safeProfileValue(parsed.data.value, parsed.data.kind === "name"))) {
    return Response.json({ error: "Podaj krótką, poprawną wartość bez sekretów, danych wrażliwych i poleceń dla agenta." }, { status: 400, headers });
  }
  try {
    const change = parsed.data;
    if (change.kind === "name") {
      const { data, error } = await getSupabase().from("user_profiles").update({ name: change.value }).eq("id", 1).select("id").single();
      if (error || !data) throw error;
    } else {
      // Porównanie wersji JSON zapobiega utracie faktu dopisanego równolegle przez agenta.
      let saved = false;
      for (let attempt = 0; attempt < 3 && !saved; attempt++) {
        const current = await readProfileRecord();
        if (!Object.hasOwn(current.preferences, change.key)) return Response.json({ error: "Ta pozycja została już usunięta. Odśwież profil." }, { status: 409, headers });
        const preferences = { ...current.preferences };
        if (change.value === null) delete preferences[change.key];
        else preferences[change.key] = change.value;
        const { data, error } = await getSupabase().from("user_profiles").update({ preferences }).eq("id", 1)
          .eq("preferences", JSON.stringify(current.preferences)).select("id").maybeSingle();
        if (error) throw error;
        saved = Boolean(data);
      }
      if (!saved) return Response.json({ error: "Profil zmienił się w trakcie zapisu. Spróbuj ponownie." }, { status: 409, headers });
    }
    return Response.json({ profile: await readProfileRecord() }, { headers });
  } catch { return failure(); }
}

export async function DELETE(request: Request) {
  const refusal = denied(request, true);
  if (refusal) return refusal;
  try {
    const { data, error } = await getSupabase().from("user_profiles")
      .update({ name: null, preferences: {} }).eq("id", 1).select("id").single();
    if (error || !data) throw error;
    return Response.json({ profile: await readProfileRecord() }, { headers });
  } catch { return failure(); }
}
