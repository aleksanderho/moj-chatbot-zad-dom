import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { validSession } from "../travel-session.mjs";
import { readProfileRecord } from "../../lib/user-profile";
import ProfileEditor from "./profile-editor";

export const metadata = { title: "Profil · i-sofa" };
export default async function ProfilePage() {
  const request = new Request("http://localhost/profile", { headers: { cookie: (await cookies()).toString() } });
  if (!validSession(request)) redirect("/?session=expired");
  let profile;
  try { profile = await readProfileRecord(); } catch { /* Pokaż błąd zamiast pustego profilu. */ }
  return <main className="history-shell">
    <header className="app-header"><div className="brand"><span className="brand-mark" aria-hidden="true">i.</span><div><h1>Twój profil</h1><p>Informacje, które asystent pamięta o Tobie.</p></div></div><a className="history-back" href="/">Wróć do czatu</a></header>
    {profile ? <ProfileEditor initialProfile={profile} /> : <p className="error" role="alert">Nie udało się wczytać profilu. <a href="/profile">Spróbuj ponownie</a>.</p>}
  </main>;
}
