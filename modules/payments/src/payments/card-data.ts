// card-data.ts — the ONE place that decides what card data may enter this backend (PCI DSS).
//
// A card number (PAN) must never be stored, and should never even reach the API: cards are typed into the gateway's
// CardSecure hosted iFrame tokenizer and only a TOKEN comes back. CardSecure tokens are 16 digits beginning with 9 (no
// card brand issues 9-prefixed numbers), so a Luhn-valid 13–19 digit value that does not start with 9 is a card number.
// Used by every place that accepts a card "token": customer saved cards, the salon's hardware-plan card.

/** Luhn check (mod 10) — true for a structurally valid card number. */
export function luhnOk(d: string): boolean {
  let sum = 0, dbl = false;
  for (let i = d.length - 1; i >= 0; i--) { let n = d.charCodeAt(i) - 48; if (dbl) { n *= 2; if (n > 9) n -= 9; } sum += n; dbl = !dbl; }
  return sum % 10 === 0;
}

/** Does this value look like a RAW card number (PAN)? */
export function looksLikeRawPan(token: string): boolean {
  const t = String(token ?? '').replace(/[\s-]+/g, '');
  return /^\d{13,19}$/.test(t) && t[0] !== '9' && luhnOk(t);
}

/** Is this a CardSecure token (what the hosted tokenizer returns)? */
export function isCardSecureToken(token: string): boolean {
  return /^9\d{12,18}$/.test(String(token ?? '').trim());
}

/** The CardSecure hosted iFrame tokenizer on a gateway host — only an https *.cardconnect.com host qualifies (the iframe
 *  must be the gateway's own page). Expiry + CVV collected there; tokenize when the field goes idle. */
export function tokenizerForGatewayBase(baseUrl: string | null | undefined): { available: boolean; url?: string; origin?: string; reason?: string } {
  if (!baseUrl) return { available: false, reason: 'gateway_not_configured' };
  let origin: string;
  try {
    const u = new URL(String(baseUrl));
    if (u.protocol !== 'https:' || !/\.cardconnect\.com$/i.test(u.hostname)) return { available: false, reason: 'unsupported_gateway_host' };
    origin = u.origin;
  } catch { return { available: false, reason: 'invalid_gateway_url' }; }
  const q = new URLSearchParams({ useexpiry: 'true', usecvv: 'true', formatinput: 'true', tokenizewheninactive: 'true', inactivityto: '600', invalidinputevent: 'true', enhancedresponse: 'true' });
  return { available: true, url: `${origin}/itoke/ajax-tokenizer.html?${q.toString()}`, origin };
}
