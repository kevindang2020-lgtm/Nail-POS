// native-client.ts — decides whether a request comes from the NATIVE mobile app.
//
// Why this matters. Web sessions are an httpOnly cookie: the token never reaches JavaScript, so an XSS bug in the
// web app cannot *steal* it (it can abuse the session in-place, but it cannot exfiltrate a long-lived credential).
// That is a property worth protecting.
//
// A native app cannot use that cookie at all. Inside a Capacitor/WebView shell the page origin is
// `capacitor://localhost`, so a call to `api.aipowersalon.com` is CROSS-SITE and a `SameSite=Lax` cookie is
// simply not sent. The API already accepts `Authorization: Bearer <token>` — so native needs the token itself,
// held in the **Keychain / Keystore**.
//
// ── The trap, and why this file exists ──
//
// If "give me the token in the response body" were requested by a header the client controls (say
// `X-Client: native`), then **XSS in the web app could ask for it too** — and walk away with a 30-day bearer
// token. That would quietly destroy the exact protection the httpOnly cookie exists to provide.
//
// So the signal must be one a browser CANNOT forge. `Origin` is exactly that: it is set by the browser, not by
// page script. JavaScript cannot change it.
//
//   • Web app  → Origin is an https:// site origin  → NEVER gets a token. Cookie only.
//   • Native   → Origin is a native scheme (`capacitor://localhost`, `ionic://localhost`,
//                `http://localhost` for Android WebView) → gets a token.
//   • Native HTTP clients (React Native `fetch`, native URLSession) send **no Origin at all**. A browser always
//     sends Origin on a POST — same-origin included — so an absent Origin means "not a browser".
//
// Everything else fails closed: no token, cookie only.

/** Origins a native shell reports. Overridable, because shells and dev setups differ. */
const DEFAULT_NATIVE_ORIGINS = [
  'capacitor://localhost',   // Capacitor, iOS
  'ionic://localhost',       // Ionic, iOS
  'http://localhost',        // Capacitor/Android WebView
  'https://localhost',       // Capacitor/Android WebView (https scheme)
];

export function nativeOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const extra = (env.NATIVE_APP_ORIGINS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  return [...DEFAULT_NATIVE_ORIGINS, ...extra];
}

/**
 * True when this request is from the native app — and therefore may receive a bearer token in the body.
 *
 * Deliberately reads ONLY the `Origin` header. It does not look at `User-Agent` (trivially spoofed) or any
 * custom client header (an XSS payload can set those). It fails closed: anything it does not positively
 * recognise as native is treated as a browser.
 */
export function isNativeClient(req: any, env: NodeJS.ProcessEnv = process.env): boolean {
  const h = req?.headers ?? {};
  const raw = h.origin ?? h.Origin;

  // No Origin at all → not a browser. Browsers send Origin on every POST, including same-origin ones, so a
  // missing Origin means a native HTTP client (React Native fetch, URLSession, a mobile SDK).
  if (raw === undefined || raw === null || raw === '') return true;

  const origin = String(raw).trim().toLowerCase();
  if (origin === 'null') return false;   // an opaque origin (sandboxed iframe, data: URL) is NOT native — fail closed.

  return nativeOrigins(env).some((o) => origin === o.toLowerCase());
}

/**
 * Should the login response include the session token in its body?
 *
 * Only for native. A web browser always keeps the httpOnly cookie and never sees the token — so an XSS bug there
 * still cannot exfiltrate a credential.
 */
export function shouldReturnToken(req: any, env: NodeJS.ProcessEnv = process.env): boolean {
  return isNativeClient(req, env);
}
