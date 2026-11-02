// community-privacy-scan.ts — the privacy gate every community post/comment must pass BEFORE it can be
// published. It REUSES the platform's existing deterministic redactor (ai-voice-transcription-redaction) for
// payment/ID data, and ADDS the community-specific customer-PII layer: unlike the transcription redactor
// (which deliberately KEEPS 10-digit phones for customer matching), the community must REDACT customer phone
// numbers, emails, addresses, customer/appointment identifiers, and credentials — because these posts are seen
// by OTHER tenants and must never identify or expose a customer.
//
// Output classifies findings into:
//   - blocked: hard-stop categories (payment card, CVV, bank, SSN, gov id) — the post CANNOT be published.
//   - flagged: customer-PII categories that were auto-redacted — the post is routed to review
//     (sensitive_data_detected) so a human confirms the redaction is sufficient.
// PURE — deterministic; the only import is the shared redactor.
import { redactTranscriptText as redactText, type RedactionCategory } from '@aipowersalon/ai';

export type CommunityPiiCategory =
  | RedactionCategory                      // card | cvv | ssn | bank | secret | gov_id  (BLOCK)
  | 'phone' | 'email' | 'address' | 'customer_id' | 'appointment_code' | 'credential'  // (FLAG + redact)
  | 'name' | 'dob';                        // BUILD_PLAN Phase 8: person names / social handles, dates of birth (FLAG + redact)

const BLOCK: ReadonlySet<CommunityPiiCategory> = new Set(['card', 'cvv', 'ssn', 'bank', 'gov_id']);

export interface CommunityScanResult {
  redactedText: string;
  findings: { category: CommunityPiiCategory; count: number }[];
  blocked: boolean;                 // any hard-stop category present
  flagged: boolean;                 // any customer-PII redaction applied → route to review
  categories: CommunityPiiCategory[];
}

const PLACEHOLDER: Record<string, string> = {
  phone: '[REDACTED_PHONE]', email: '[REDACTED_EMAIL]', address: '[REDACTED_ADDRESS]',
  customer_id: '[REDACTED_ID]', appointment_code: '[REDACTED_CODE]', credential: '[REDACTED_CREDENTIAL]',
  name: '[REDACTED_NAME]', handle: '[REDACTED_HANDLE]', dob: '[REDACTED_DOB]',
};

// Capitalised words that start a sentence or a clause after "customer"/"client" — never treated as a person's name.
const NOT_A_NAME = new Set(['The', 'This', 'That', 'Then', 'She', 'He', 'They', 'Who', 'When', 'Was', 'Is', 'Had', 'Has', 'And', 'But', 'Or',
  'On', 'In', 'At', 'For', 'With', 'Called', 'Came', 'Asked', 'Said', 'Paid', 'Tried', 'Wanted', 'Service', 'Support', 'Account', 'Id', 'Number']);
const NAME_WORD = '[A-Z][a-z]+(?:[-\'][A-Z]?[a-z]+)?';
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';

export function scanCommunityText(input: string): CommunityScanResult {
  const counts = new Map<CommunityPiiCategory, number>();
  const bump = (c: CommunityPiiCategory, n = 1) => counts.set(c, (counts.get(c) ?? 0) + n);

  // 1) Reuse the platform redactor for payment/ID data (card/cvv/ssn/bank/secret/gov_id).
  const base = redactText(input);
  for (const cat of base.categories) bump(cat as CommunityPiiCategory);
  let text = base.text;

  // 2) Community-specific customer-PII layer (redact — these must never reach other tenants).
  // email
  text = text.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, () => { bump('email'); return PLACEHOLDER.email; });
  // phone: 10-digit North-American patterns (with or without separators / country code)
  text = text.replace(/(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g, () => { bump('phone'); return PLACEHOLDER.phone; });
  // street address (number + street words)
  text = text.replace(/\b\d{1,6}\s+[A-Za-z0-9.\s]{2,40}\b(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way|place|pl|terrace|ter)\.?\b/gi, () => { bump('address'); return PLACEHOLDER.address; });
  // appointment confirmation code (keyword-anchored alnum token)
  // BUILD_PLAN Phase 8: the keyword must be a whole word and the code must carry a digit — "confirmation scam" used to
  // become "conf [REDACTED_CODE] scam" (the 'conf' alternative matched inside 'confirmation').
  text = text.replace(/\b(confirmation|appointment|booking|conf)\b\s*(code|#|number|no\.?)?\s*[:#]?\s*((?=[A-Z]*\d)[A-Z0-9]{5,12})\b/gi, (_m, k) => { bump('appointment_code'); return `${k} ${PLACEHOLDER.appointment_code}`; });
  // customer/account id (keyword-anchored)
  text = text.replace(/\b(customer|client|account|acct|member)\s*(id|number|no\.?|#)\s*[:#]?\s*([A-Za-z0-9-]{4,})\b/gi, (_m, k, k2) => { bump('customer_id'); return `${k} ${k2} ${PLACEHOLDER.customer_id}`; });
  // BUILD_PLAN Phase 8 — dates of birth (keyword-anchored, so an incident date is never touched)
  text = text.replace(new RegExp(`\\b(dob|d\\.o\\.b\\.?|date of birth|birth\\s*date|birthday|born(?:\\s+on)?)\\s*[:\\-]?\\s*(\\d{1,2}[\\/.-]\\d{1,2}[\\/.-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}|\\d{1,2}\\s+${MONTH}\\s+\\d{4})`, 'gi'),
    (_m, k) => { bump('dob'); return `${k} ${PLACEHOLDER.dob}`; });
  // social handles (@name) — emails were already replaced above, so what is left is a handle
  text = text.replace(/(?<![\w.])@[A-Za-z0-9_][A-Za-z0-9_.]{1,29}\b/g, () => { bump('name'); return PLACEHOLDER.handle; });
  // a person's name after an honorific ("Mr. Lee", "Mrs Jane Smith")
  text = text.replace(new RegExp(`\\b(Mr|Mrs|Ms|Miss|Mx|Dr)\\.?\\s+${NAME_WORD}(?:\\s+${NAME_WORD})?`, 'g'), () => { bump('name'); return PLACEHOLDER.name; });
  // "her name is …", "named …", "goes by …" — a second word is part of the name only when it is capitalised
  const keepTail = (second: string | undefined) => (second && !/^\s+[A-Z]/.test(second) ? second : '');
  text = text.replace(/\b((?:her|his|their|the customer'?s|the client'?s|the caller'?s)\s+name\s+(?:is|was)|named|goes by|called (?:himself|herself|themselves))\s+([A-Za-z][A-Za-z'-]+)(\s+[A-Za-z][A-Za-z'-]+)?/gi,
    (_m, k, _first, second) => { bump('name'); return `${k} ${PLACEHOLDER.name}${keepTail(second)}`; });
  // "customer Jane Smith", "client Maria" — a role word followed by a CAPITALISED word that is not a common one
  text = text.replace(/\b(customer|client|guest|caller|patron)\s+([A-Za-z][A-Za-z'-]+)(\s+[A-Za-z][A-Za-z'-]+)?/gi, (m, k, first, second) => {
    if (!/^[A-Z][a-z]/.test(first) || NOT_A_NAME.has(first)) return m;
    bump('name'); return `${k} ${PLACEHOLDER.name}${keepTail(second)}`;
  });
  // credentials (password/pin/otp)
  // a value after "password:" / "pin=" is a credential; without the separator only a token holding a digit is (so "the
  // login code sent to the owner" stays readable — found by the Phase 8 browser proof)
  text = text.replace(/\b(password|passcode|pin|otp|verification code|login)(?:\s*[:=]\s*\S{3,}|\s+(?=\S*\d)\S{3,})/gi, (_m, k) => { bump('credential'); return `${k}: ${PLACEHOLDER.credential}`; });

  const findings = [...counts.entries()].map(([category, count]) => ({ category, count }));
  const categories = findings.map((f) => f.category);
  const blocked = categories.some((c) => BLOCK.has(c));
  const flagged = findings.length > 0;
  return { redactedText: text, findings, blocked, flagged, categories };
}

/** The workflow gate: given a scan, decide the next disposition for a submitted post. */
export function scanDisposition(scan: CommunityScanResult): 'blocked' | 'needs_review' | 'clean' {
  if (scan.blocked) return 'blocked';            // payment/ID data present — cannot publish
  if (scan.flagged) return 'needs_review';       // customer PII was redacted — human confirms
  return 'clean';
}
