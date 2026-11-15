import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const symbol = Symbol.for("i-sofa.travel-session-key");
function sessionKey() {
  const secret = process.env.TRAVEL_SESSION_SECRET?.trim() || process.env.OPENROUTER_API_KEY?.trim();
  if (secret) return createHmac("sha256", secret).update("i-sofa/travel-session/v1").digest();
  if (process.env.VERCEL) throw new Error("Brak konfiguracji sesji.");
  globalThis[symbol] ??= randomBytes(32);
  return globalThis[symbol];
}
const sign = value => createHmac("sha256", sessionKey()).update(value).digest("hex");
export const SESSION_COOKIE = "travel_session";

// Anonymous session by explicit user choice: the dashboard has no password.
export function issueSession() {
  const payload = `${Date.now() + 8 * 3600000}.${randomBytes(16).toString("hex")}`;
  return `${payload}.${sign(payload)}`;
}
export function validSession(request) {
  const token = request.headers.get("cookie")?.match(/(?:^|;\s*)travel_session=([^;]+)/)?.[1];
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expires, nonce, signature] = parts;
  if (!/^\d+$/.test(expires) || Number(expires) <= Date.now() || !/^[a-f0-9]{32}$/.test(nonce ?? "") || !/^[a-f0-9]{64}$/.test(signature ?? "")) return false;
  try { return timingSafeEqual(Buffer.from(signature), Buffer.from(sign(`${expires}.${nonce}`))); }
  catch { return false; }
}
export function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const source = new URL(origin);
    const destination = new URL(request.url);
    return source.host === (request.headers.get("host") ?? destination.host) && source.protocol === destination.protocol;
  } catch { return false; }
}
