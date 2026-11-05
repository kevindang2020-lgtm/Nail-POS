// allowed-origins.ts — ONE browser-origin allow-list, shared by CORS (main.ts) and the realtime gateway.
//
// Constitution 9 §196: CORS alone does not protect a credentialed SSE stream — the browser sends the request
// with cookies, the server opens the stream and starts writing, and only THEN does the browser decide whether
// the page may read it. "Do not accept arbitrary credentialed origin" means the SERVER must refuse before
// opening. Computing the list here, once, keeps the gateway's answer identical to CORS's answer.
//
// Absent Origin is allowed: native shells and non-browser clients (curl, server-side EventSource) send none,
// exactly as the existing CORS policy already treats them.
import { nativeOrigins } from '@aipowersalon/identity';

export function computeAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const defaultOrigins = 'https://aipowersalon.com,https://www.aipowersalon.com,https://app.aipowersalon.com,https://app.aipowersalon.com:8081,https://app.aipowersalon.com:8082,https://app.aipowersalon.com:8083,https://app.aipowersalon.com:8084,https://app.aipowersalon.com:8085,https://app.aipowersalon.com:8086,https://app.aipowersalon.com:8087,https://app.aipowersalon.com:3000';
  const corsOrigins = (env.WEB_CORS_ORIGINS || defaultOrigins)
    .split(',').map((s) => s.trim()).filter(Boolean);
  const isDev = env.NODE_ENV === 'development';
  const devOrigins = isDev
    ? [5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180, 5181].flatMap((p) => [`http://localhost:${p}`, `http://127.0.0.1:${p}`])
    : [];
  return [...corsOrigins, ...devOrigins, ...nativeOrigins()];
}

let cached: string[] | null = null;
/** True when the request may be served with credentials from this origin. Missing Origin ⇒ allowed (see above). */
export function isOriginAllowed(origin: string | undefined | null, list?: string[]): boolean {
  if (!origin) return true;                                   // same-origin / non-browser callers carry no Origin
  const allowed = list ?? computeAllowedOrigins();
  if (allowed.includes(origin)) return true;
  try {
    const u = new URL(origin);
    if (u.protocol === 'https:' && (u.hostname === 'aipowersalon.com' || u.hostname.endsWith('.aipowersalon.com'))) {
      return true;
    }
    if (process.env.NODE_ENV === 'development') {
      if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname))) return true;
    }
  } catch { /* not a URL */ }
  return false;
}

export function _resetAllowedOriginsCache(): void { cached = null; }
