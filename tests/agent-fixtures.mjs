import { POST } from "../app/api/agent/route.ts";
import { issueSession } from "../app/travel-session.mjs";

// Shared authenticated requests for the existing chat and analysis regression tests.
async function authenticated(request, mode) {
  const body = await request.json().catch(() => null);
  const headers = new Headers(request.headers);
  headers.set("cookie", `${headers.get("cookie") || ""}; travel_session=${issueSession()}`);
  return POST(new Request("http://localhost/api/agent", {
    method: "POST", headers, body: JSON.stringify({ mode, ...body }), signal: request.signal,
  }));
}
export const chatPOST = request => authenticated(request, "chat");
export const analyzePOST = request => authenticated(request, "analyze");
