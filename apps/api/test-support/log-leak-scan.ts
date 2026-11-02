// log-leak-scan.ts — Security Deep Scan §128: find credential / card-data SHAPES (and exact known secret values) in captured
// log text. Shapes: a Luhn-valid 13–19 digit run (PAN), an unredacted Bearer / Basic value, a JWT, a platform refresh /
// not-me / device-approval token, a provider API key (OpenAI / Anthropic / SendGrid / AWS / Stripe-style), a private key.
export interface Leak { kind: string; context: string }

function luhn(d: string): boolean {
  let sum = 0, dbl = false;
  for (let i = d.length - 1; i >= 0; i--) { let n = Number(d[i]); if (dbl) { n *= 2; if (n > 9) n -= 9; } sum += n; dbl = !dbl; }
  return sum % 10 === 0;
}
const SHAPES: Array<[string, RegExp, ((m: string) => boolean)?]> = [
  ['pan', /(?<![\d])\d(?:[ -]?\d){12,18}(?![\d])/g, (m) => { const d = m.replace(/\D/g, ''); return d.length >= 13 && d.length <= 19 && luhn(d); }],
  ['bearer', /\b(?:Bearer|Basic)\s+(?!\[REDACTED\])[A-Za-z0-9\-._~+/]{8,}=*/gi],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
  ['refresh_token', /\b(?:rt|nm|pda)_[A-Za-z0-9_-]{24,}/g],
  ['provider_key', /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}|SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}|(?:AKIA|ASIA)[0-9A-Z]{16}|rk_live_[A-Za-z0-9]{16,}|sk_live_[A-Za-z0-9]{16,})/g],
  ['private_key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
];

export function leaksIn(text: string, exactValues: string[] = []): Leak[] {
  const out: Leak[] = [];
  const ctx = (i: number, len: number) => text.slice(Math.max(0, i - 40), i + len + 40).replace(/\s+/g, ' ');
  for (const [kind, re, ok] of SHAPES) for (const m of text.matchAll(re)) if (!ok || ok(m[0])) out.push({ kind, context: ctx(m.index ?? 0, m[0].length) });
  for (const v of exactValues) { let i = text.indexOf(v); while (i >= 0) { out.push({ kind: 'exact', context: ctx(i, v.length).replace(v, '<SECRET>') }); i = text.indexOf(v, i + 1); } }
  return out;
}
