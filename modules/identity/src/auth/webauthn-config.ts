// webauthn-config.ts — WebAuthn's expected origin / RP ID, derived rather than configured.
//
// ── Why this exists ──
//
// WebAuthn requires the server to state the origin and RP ID it expects, and the browser's ceremony must match
// them exactly. Historically those came from `WEBAUTHN_ORIGIN` / `WEBAUTHN_RP_ID`, and getting either wrong is the
// single most common cause of "Face ID doesn't work": the ceremony fails **closed**, which is correct behaviour
// but looks exactly like a bug, and the error the browser shows says nothing useful.
//
// That is a configuration trap, and configuration traps get sprung. So we do not ask for the answer — we take it
// from the request:
//
//   expectedOrigin = the browser's own `Origin` header
//   rpId           = that origin's hostname
//
// The browser sets `Origin` itself and page script cannot forge it, so this cannot be manipulated. And it cannot
// disagree with the browser, because it *is* the browser's value.
//
// ── The security condition ──
//
// Taking the origin from the request would be dangerous if we accepted *any* origin: a phishing site could relay a
// ceremony and have us validate it against its own origin. So the origin is only accepted when it is in the
// **trusted allowlist** — the same one CORS uses. Anything else is refused, and the ceremony fails.
//
// Native shells are deliberately excluded: they do NOT use WebAuthn (they use Apple/Android biometrics with a
// Keychain-held token), so a WebAuthn ceremony claiming to come from `capacitor://localhost` is not something we
// should ever be validating.
//
// `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` remain honoured as explicit overrides for anyone who needs them, but
// nothing has to be set for this to work correctly.
import { AsyncLocalStorage } from 'async_hooks';
import { nativeOrigins } from './native-client';

/** Request-scoped origin. AsyncLocalStorage rather than a module variable: a shared mutable would race under
 *  concurrent requests and could validate one customer's ceremony against another's origin. */
const originStore = new AsyncLocalStorage<string>();

/** Run a request handler with its browser origin bound. */
export function withRequestOrigin<T>(origin: string | undefined, fn: () => T): T {
  return originStore.run(String(origin ?? ''), fn);
}

/** The origins we trust for a WebAuthn ceremony: the configured web origins. NOT the native schemes. */
export function trustedWebOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = (env.WEB_CORS_ORIGINS || 'https://aipowersalon.com,https://www.aipowersalon.com')
    .split(',').map((o) => o.trim()).filter(Boolean);

  const dev = env.NODE_ENV === 'development'
    ? [5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180, 5181].flatMap((p) => [`http://localhost:${p}`, `http://127.0.0.1:${p}`])
    : [];

  const native = new Set(nativeOrigins(env).map((o) => o.toLowerCase()));
  // Native shells do not use WebAuthn — exclude them so we never validate a ceremony against a native origin.
  return [...configured, ...dev].filter((o) => !native.has(o.toLowerCase()));
}

export class WebAuthnOriginError extends Error {
  constructor(public origin: string, trusted: string[] = trustedWebOrigins()) {
    super(
      `WebAuthn: the request Origin "${origin || '(none)'}" is not a trusted web origin. ` +
      `Add it to WEB_CORS_ORIGINS. (Trusted: ${trusted.join(', ') || 'none configured'})`,
    );
    this.name = 'WebAuthnOriginError';
  }
}

/** The hostname WebAuthn should use as the RP ID for a given origin. */
export function rpIdFor(origin: string): string {
  return new URL(origin).hostname;   // always a valid RP ID for that origin
}

/**
 * The config the ceremony is validated against.
 *
 * Derived from the request when possible; the env vars are honoured as overrides. Throws when the origin is not
 * trusted — a ceremony we cannot attribute to a known origin must not be validated at all.
 */
export function webAuthnConfig(env: NodeJS.ProcessEnv = process.env): { rpId: string; rpName: string; expectedOrigin: string } {
  const rpName = 'AI PowerSalon';

  // Explicit override wins, for anyone who needs it.
  if (env.WEBAUTHN_ORIGIN && env.WEBAUTHN_RP_ID) {
    return { rpId: env.WEBAUTHN_RP_ID, rpName, expectedOrigin: env.WEBAUTHN_ORIGIN };
  }

  const origin = originStore.getStore() || '';
  const trusted = trustedWebOrigins(env);
  const match = trusted.find((o) => o.toLowerCase() === origin.toLowerCase());
  if (!match) throw new WebAuthnOriginError(origin, trusted);   // list what IS trusted, from the SAME env we checked

  return {
    rpId: env.WEBAUTHN_RP_ID || rpIdFor(match),
    rpName,
    expectedOrigin: env.WEBAUTHN_ORIGIN || match,
  };
}
