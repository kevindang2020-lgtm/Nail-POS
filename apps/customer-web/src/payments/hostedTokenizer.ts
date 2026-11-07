// hostedTokenizer.ts — the browser side of the Fiserv CardSecure hosted iFrame tokenizer (Fiserv master build §4 / §8).
//
// The card number, expiry and CVV are typed into a page served by the salon's Fiserv gateway host inside an <iframe>.
// This app never has DOM access to those fields; the iframe posts back ONLY a CardSecure token (+ expiry). Every message
// is checked: exact expected origin, the message must come from OUR iframe window, and the payload must look like a
// tokenizer answer. Anything else is ignored — a forged postMessage from another frame or origin cannot inject a token.
// Raw message contents are never logged or stored.

export interface TokenizerFrame { url: string; origin: string }

/** Accept a tokenizer config from the API only if it names an https *.cardconnect.com page under /itoke/. */
export function trustedTokenizerFrame(cfg: { available?: boolean; url?: string; origin?: string } | null | undefined): TokenizerFrame | null {
  if (!cfg?.available || !cfg.url || !cfg.origin) return null;
  try {
    const u = new URL(cfg.url);
    const o = new URL(cfg.origin);
    if (u.protocol !== 'https:' || o.protocol !== 'https:') return null;
    if (u.origin !== o.origin) return null;
    if (!/^[a-z0-9-]+\.cardconnect\.com$/i.test(u.hostname)) return null;
    if (!u.pathname.startsWith('/itoke/')) return null;
    return { url: u.toString(), origin: u.origin };
  } catch { return null; }
}

export type TokenizerMessage =
  | { kind: 'token'; token: string; expiry?: string }
  | { kind: 'error'; message: string }
  | { kind: 'ignore' };

/** Interpret one window 'message' event. `expectedSource` is our iframe's contentWindow. */
export function readTokenizerMessage(ev: { origin: string; source: unknown; data: unknown }, frame: TokenizerFrame, expectedSource: unknown): TokenizerMessage {
  if (ev.origin !== frame.origin) return { kind: 'ignore' };
  if (!expectedSource || ev.source !== expectedSource) return { kind: 'ignore' };
  let d: any = ev.data;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return { kind: 'ignore' }; } }
  if (!d || typeof d !== 'object') return { kind: 'ignore' };
  const errorCode = d.errorCode != null ? String(d.errorCode) : '0';
  if (d.validationError || (errorCode !== '0' && errorCode !== '')) {
    return { kind: 'error', message: 'Please check the card details.' };   // generic: never echo provider text that may contain input
  }
  const token = typeof d.message === 'string' ? d.message.trim() : typeof d.token === 'string' ? d.token.trim() : '';
  if (!/^9\d{12,18}$/.test(token)) return token ? { kind: 'error', message: 'Please check the card details.' } : { kind: 'ignore' };
  const expiry = typeof d.expiry === 'string' && /^\d{4,6}$/.test(d.expiry) ? d.expiry : undefined;
  return { kind: 'token', token, expiry };
}

/** CardSecure expiry ("MMYY", or "YYYYMM" with some options) → month / 4-digit year. */
export function parseTokenizerExpiry(expiry?: string): { expMonth?: number; expYear?: number } {
  if (!expiry) return {};
  if (/^\d{4}$/.test(expiry)) return { expMonth: Number(expiry.slice(0, 2)), expYear: 2000 + Number(expiry.slice(2)) };
  if (/^\d{6}$/.test(expiry)) return { expMonth: Number(expiry.slice(4)), expYear: Number(expiry.slice(0, 4)) };
  return {};
}
