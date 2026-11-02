// ai-voice-transcription-redaction.ts — PURE, deterministic sensitive-data redaction. Runs BEFORE any transcript
// text is stored in the redacted column, sent to an AI model, or indexed for search. Conservative by design:
// it over-redacts rather than risk a leak, but it deliberately preserves data the salon needs downstream —
// 10-digit phone numbers (customer matching), clock times, and prices — by anchoring on structure/keywords.
import type { TranscriptSegment } from './ai-voice-transcription.dto';

export type RedactionCategory = 'card' | 'cvv' | 'ssn' | 'bank' | 'secret' | 'gov_id';

export interface RedactionResult { text: string; categories: RedactionCategory[]; applied: boolean; }

const PLACEHOLDER: Record<RedactionCategory, string> = {
  card: '[REDACTED_CARD]', cvv: '[REDACTED_CVV]', ssn: '[REDACTED_SSN]',
  bank: '[REDACTED_BANK]', secret: '[REDACTED_SECRET]', gov_id: '[REDACTED_ID]',
};

// Count digits in a matched run (ignoring spaces/dashes) to distinguish a card (13-19) from a phone (10).
const digitCount = (s: string) => (s.match(/\d/g) || []).length;

export function redactText(input: string): RedactionResult {
  let text = input;
  const cats = new Set<RedactionCategory>();
  const hit = (c: RedactionCategory) => cats.add(c);

  // SSN first (xxx-xx-xxxx, or "social security" + 9 digits) — do before generic digit runs.
  text = text.replace(/\b\d{3}-\d{2}-\d{4}\b/g, () => { hit('ssn'); return PLACEHOLDER.ssn; });
  text = text.replace(/\b(social security(?:\s+number)?)\D{0,10}(\d[\d\s-]{7,}\d)/gi, (_m, k) => { hit('ssn'); return `${k} ${PLACEHOLDER.ssn}`; });

  // CVV / security code: keyword-anchored 3-4 digits (redact the value, keep the label).
  text = text.replace(/\b(cvv|cvc|cvv2|security code|card code|card verification(?:\s+value)?)\b\D{0,8}(\d{3,4})\b/gi,
    (_m, k) => { hit('cvv'); return `${k} ${PLACEHOLDER.cvv}`; });

  // Card number: 13-19 digits allowing spaces/dashes as separators (won't match a 10-digit phone).
  text = text.replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => { if (digitCount(m) >= 13 && digitCount(m) <= 19) { hit('card'); return PLACEHOLDER.card; } return m; });
  // Card keyword-anchored fallback (e.g. dictated with words around it).
  text = text.replace(/\b(card number|credit card|debit card)\b\D{0,8}(\d[\d\s-]{10,}\d)/gi, (_m, k) => { hit('card'); return `${k} ${PLACEHOLDER.card}`; });

  // Bank routing/account: keyword-anchored 6-17 digits.
  text = text.replace(/\b(routing(?:\s+number)?|account number|acct(?:\s+number)?|iban)\b\D{0,8}([a-z0-9][a-z0-9\s-]{5,})/gi,
    (_m, k) => { hit('bank'); return `${k} ${PLACEHOLDER.bank}`; });

  // Secrets: password / PIN / OTP / verification|authentication code + the value that follows.
  text = text.replace(/\b(password|pass code|passcode|pin|one[- ]?time (?:code|password)|otp|verification code|authentication code|auth code|access code)\b(?:\s+(?:is|are|:|=))?\s*([a-z0-9][a-z0-9-]{2,})/gi,
    (_m, k) => { hit('secret'); return `${k} ${PLACEHOLDER.secret}`; });

  // Government IDs: passport / driver's license / license number + alphanumeric value.
  text = text.replace(/\b(passport(?:\s+number)?|driver'?s? licen[sc]e(?:\s+number)?|licen[sc]e number|national id|government id)\b\D{0,8}([a-z0-9-]{5,})/gi,
    (_m, k) => { hit('gov_id'); return `${k} ${PLACEHOLDER.gov_id}`; });

  const categories = [...cats];
  return { text, categories, applied: categories.length > 0 };
}

// Redact a set of normalized segments. Returns the redacted segments (text replaced), the raw texts kept aside
// (for access-gated raw retention only), and the aggregate categories seen across the call.
export function redactSegments(segments: TranscriptSegment[]): {
  segments: TranscriptSegment[]; rawTexts: (string | null)[]; categories: RedactionCategory[]; anyApplied: boolean;
} {
  const cats = new Set<RedactionCategory>();
  const rawTexts: (string | null)[] = [];
  let anyApplied = false;
  const out = segments.map((s) => {
    const r = redactText(s.text);
    rawTexts.push(r.applied ? s.text : null); // only keep raw where something was redacted
    for (const c of r.categories) cats.add(c);
    if (r.applied) anyApplied = true;
    return { ...s, text: r.text };
  });
  return { segments: out, rawTexts, categories: [...cats], anyApplied };
}
