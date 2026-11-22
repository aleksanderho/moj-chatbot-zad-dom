import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { validSession } from "../travel-session.mjs";
import UploadForm from "./upload-form";

export const metadata = { title: "Baza wiedzy · i-sofa" };
export default async function UploadPage() {
  const request = new Request("http://localhost/upload", { headers: { cookie: (await cookies()).toString() } });
  if (!validSession(request)) redirect("/?session=expired");
  return <main className="history-shell upload-shell">
    <header className="app-header"><div className="brand"><span className="brand-mark" aria-hidden="true">i.</span><div><h1>Baza wiedzy</h1><p>Dodaj dokument dla zespołu.</p></div></div><a className="history-back" href="/">Wróć do czatu</a></header>
    <UploadForm />
  </main>;
}
