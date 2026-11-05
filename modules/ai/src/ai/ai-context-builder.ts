// ai-context-builder.ts — Constitution 10 Phase 9: tenant-safe context, PII classification, redaction (§55–§62).
//
// Two distinct protections, in order:
//   1. §59/§60 CLASSIFICATION — every field the platform puts in front of a model carries a data class. PROHIBITED
//      fields (password, OTP, CVV, PAN, tokens, keys) are refused at build time by NAME: if a caller passes
//      `{ cvv: '123' }` the build throws before any provider exists in the call stack. This is the structural
//      guarantee. Constitution 8's FORBIDDEN_AI_PAYLOAD_KEYS is the other direction (what may not be LOGGED
//      after the fact); this is what may not be SENT.
//   2. §62 REDACTION — a pattern scrub over free text for things that slipped into a review body or a transcript
//      by content rather than by field name: card numbers, government ids, auth codes, keys. Best-effort by
//      nature and therefore the SECOND line, never the first.
//
// §57/§58: the builder is given only the fields a task declares it needs, and each field carries a budget.
// There is no "attach the customer record" — there is "attach customer.display_name (CUSTOMER_PII, 80 chars)".
import { createHash } from 'node:crypto';

/** §59. */
export type DataClass = 'PUBLIC' | 'BUSINESS_INTERNAL' | 'CUSTOMER_PII' | 'EMPLOYEE_PII' | 'FINANCIAL_SENSITIVE' | 'SECURITY_SENSITIVE' | 'PROHIBITED';

/** §60: never sent, under any workflow. Matched against field names, case-insensitive, after stripping _ and -. */
export const PROHIBITED_FIELD_PATTERNS: readonly RegExp[] = Object.freeze([
  /^(pass(word|phrase|wd)?|pwd|pin(code|hash)?)$/i,
  /^(otp|one ?time ?(code|pass(word)?)|mfa(code|secret)?|totp(secret)?|verification ?code|auth ?code)$/i,
  /^(cvv|cvc|cvv2|cvc2|csc|card ?(security|verification) ?code)$/i,
  /^(card ?number|pan|primary ?account ?number|cc ?number|creditcard(number)?)$/i,
  /^(auth(orization)? ?token|access ?token|refresh ?token|bearer|session ?token|jwt|api ?key|apikey|secret ?key|client ?secret|private ?key)$/i,
  /^(db ?password|database ?password|connection ?string|dsn)$/i,
  /(password|secret|token|cvv|apikey)$/i,   // suffix: user_password, merchant_secret, stripe_token
]);

/** §61: may be sent only inside an approved specialized workflow; otherwise masked or excluded. */
export const FINANCIAL_SENSITIVE_PATTERNS: readonly RegExp[] = Object.freeze([
  /^(bank ?account|account ?number|routing ?number|iban|swift|bic|sort ?code)$/i,
  /(merchant ?(id|secret|key)|processor ?(credential|key|secret)|gateway ?(key|secret))$/i,
]);

const norm = (k: string) => k.replace(/[_\-\s]+/g, '').toLowerCase();

export function classifyFieldName(name: string): DataClass | null {
  const n = norm(name);
  for (const re of PROHIBITED_FIELD_PATTERNS) if (re.test(n) || re.test(name)) return 'PROHIBITED';
  for (const re of FINANCIAL_SENSITIVE_PATTERNS) if (re.test(n) || re.test(name)) return 'FINANCIAL_SENSITIVE';
  return null;   // caller must declare the class explicitly
}

export class ProhibitedAiDataError extends Error {
  readonly status = 500;   // §60: a programming error, never a user-facing one
  readonly code = 'AI_PROHIBITED_DATA';
  constructor(readonly field: string) { super(`Field "${field}" is PROHIBITED AI data (§60) and cannot be placed in any AI context`); this.name = 'ProhibitedAiDataError'; }
}

// ---------------------------------------------------------------------------------------------------------------
// §62 free-text redaction. Patterns are deliberately conservative — the cost of a false positive (a masked
// number in a review) is far lower than the cost of a miss. Every replacement is a labelled token.
// ---------------------------------------------------------------------------------------------------------------
const REDACTIONS: ReadonlyArray<{ label: string; re: RegExp; keep?: (m: string) => string }> = Object.freeze([
  // Payment card: 13–19 digits with optional separators, Luhn-checked so order numbers are not masked.
  { label: 'CARD', re: /\b(?:\d[ -]?){12,18}\d\b/g, keep: (m) => (luhn(m.replace(/\D/g, '')) ? `[CARD…${m.replace(/\D/g, '').slice(-4)}]` : m) },
  // US SSN / ITIN and similar 3-2-4 ids.
  { label: 'GOV_ID', re: /\b\d{3}-\d{2}-\d{4}\b/g },
  // Auth/verification codes stated as such ("code 482913", "OTP: 4829").
  { label: 'AUTH_CODE', re: /\b(?:otp|one[- ]time[- ]code|verification code|auth(?:orization)? code|passcode|pin)\s*(?:is|:)?\s*\d{4,8}\b/gi, keep: (m) => m.replace(/\d{4,8}$/, '[AUTH_CODE]') },
  // API-key shapes.
  { label: 'KEY', re: /\b(?:sk|pk|rk|ak)_(?:live|test|prod)?_?[A-Za-z0-9]{16,}\b|\bsk-[A-Za-z0-9]{20,}\b|\bAKIA[0-9A-Z]{16}\b|\bghp_[A-Za-z0-9]{36}\b/g },
  { label: 'BEARER', re: /\bBearer\s+[A-Za-z0-9\-._~+/]{20,}=*/g },
  // Email and phone are CUSTOMER_PII, not PROHIBITED — redacted only when the task did not declare it needs them.
  { label: 'EMAIL', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { label: 'PHONE', re: /(?:\+?1[ -.]?)?\(?\b\d{3}\)?[ -.]?\d{3}[ -.]?\d{4}\b/g },
]);

function luhn(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0, dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) { let d = Number(digits[i]); if (dbl) { d *= 2; if (d > 9) d -= 9; } sum += d; dbl = !dbl; }
  return sum % 10 === 0;
}

export interface RedactionResult { text: string; redactions: Record<string, number> }

/** §62. `allow` lists PII labels the task legitimately needs (e.g. receptionist reply needs no phone; a callback task might). */
export function redactText(text: string, allow: readonly string[] = []): RedactionResult {
  const counts: Record<string, number> = {};
  let out = text;
  for (const r of REDACTIONS) {
    if (allow.includes(r.label)) continue;
    out = out.replace(r.re, (m) => {
      const rep = r.keep ? r.keep(m) : `[${r.label}]`;
      if (rep !== m) counts[r.label] = (counts[r.label] ?? 0) + 1;
      return rep;
    });
  }
  return { text: out, redactions: counts };
}

// ---------------------------------------------------------------------------------------------------------------
// §56/§57 the builder
// ---------------------------------------------------------------------------------------------------------------
export interface ContextField {
  name: string;
  value: unknown;
  dataClass: DataClass;
  /** §57 budget for THIS field. Strings beyond it are truncated; objects beyond it are refused (a truncated JSON is a lie). */
  maxChars: number;
  /** §27: user-controlled text — passed on to the prompt registry as untrusted. */
  untrusted?: boolean;
  /** §58: CUSTOMER_PII that a task can do without becomes a stable pseudonym instead of the value. */
  pseudonymize?: boolean;
}

export interface BuiltContext {
  tenantId: string;
  values: Record<string, unknown>;
  /** What was done, for the trace (§116) — never the values themselves. */
  manifest: Array<{ name: string; dataClass: DataClass; chars: number; truncated: boolean; redactions: Record<string, number>; pseudonymized: boolean }>;
  totalChars: number;
}

export interface BuildOptions {
  /** §57: whole-context ceiling. */
  maxTotalChars: number;
  /** §62: PII labels the task may keep in free text. */
  allowInText?: readonly string[];
  /** §61: set only by an approved workflow. Without it FINANCIAL_SENSITIVE fields are masked to their last 4. */
  financialWorkflowApproved?: boolean;
}

/** §58: stable per-tenant pseudonym so the same customer is the same token within a tenant and unrelated across tenants. */
export function pseudonym(tenantId: string, kind: string, value: string): string {
  return `${kind}#${createHash('sha256').update(tenantId).update('\u0000').update(kind).update('\u0000').update(value).digest('hex').slice(0, 10)}`;
}

export function buildContext(tenantId: string, fields: ContextField[], opts: BuildOptions): BuiltContext {
  if (!tenantId) throw new Error('buildContext requires a tenantId (§7: never process without validated tenant context)');
  const values: Record<string, unknown> = {};
  const manifest: BuiltContext['manifest'] = [];
  let total = 0;
  for (const f of fields) {
    // 1. §60 by NAME, regardless of declared class — a caller cannot launder `cvv` by declaring it PUBLIC.
    const implied = classifyFieldName(f.name);
    if (implied === 'PROHIBITED' || f.dataClass === 'PROHIBITED') throw new ProhibitedAiDataError(f.name);
    if (f.dataClass === 'SECURITY_SENSITIVE') throw new ProhibitedAiDataError(f.name);   // there is no approved workflow for this class
    const dataClass = implied ?? f.dataClass;
    let v = f.value;
    let pseudonymized = false, redactions: Record<string, number> = {};
    // 2. §61 financial: masked unless the workflow is approved.
    if (dataClass === 'FINANCIAL_SENSITIVE' && !opts.financialWorkflowApproved) v = typeof v === 'string' ? `…${v.slice(-4)}` : '[FINANCIAL_SENSITIVE]';
    // 3. §58 minimization: pseudonymize PII the task can do without.
    if (f.pseudonymize && (dataClass === 'CUSTOMER_PII' || dataClass === 'EMPLOYEE_PII') && typeof v === 'string') { v = pseudonym(tenantId, f.name, v); pseudonymized = true; }
    // 4. §62 redaction over free text.
    if (typeof v === 'string' && !pseudonymized) { const r = redactText(v, opts.allowInText); v = r.text; redactions = r.redactions; }
    // 5. §57 per-field budget.
    let truncated = false;
    const str = typeof v === 'string' ? v : JSON.stringify(v);
    if (str.length > f.maxChars) {
      if (typeof v !== 'string') throw new Error(`context field "${f.name}" (${str.length} chars) exceeds its ${f.maxChars}-char budget and is not a string — a truncated JSON is a lie; narrow the query instead (§57)`);
      v = str.slice(0, f.maxChars) + ' …[truncated]'; truncated = true;
    }
    const chars = typeof v === 'string' ? v.length : str.length;
    total += chars;
    if (total > opts.maxTotalChars) throw new Error(`context exceeds ${opts.maxTotalChars} chars at field "${f.name}" (§57 — do not send the tenant database into the prompt)`);
    values[f.name] = v;
    manifest.push({ name: f.name, dataClass, chars, truncated, redactions, pseudonymized });
  }
  return { tenantId, values, manifest, totalChars: total };
}
