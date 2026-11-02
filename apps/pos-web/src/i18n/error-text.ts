// error-text.ts — the POS's localized API error messages (English + Vietnamese POS mandate §22, §23; build plan WP-D1).
// The server answers with a language-neutral CODE (packages/api-contracts/src/errors.ts ERROR_REGISTRY) and an English
// message; the POS shows `errors.<CODE>` from ns/errors in the cashier's language. Never a raw key, never blank.
//
//   errorText(code, details, fallback)     the catalogue text for a code ({placeholders} filled from details), else the
//                                          fallback (the server's own message). Pure lookup.
//   apiErrorMessage(code, details, server) what a screen shows for a failed API call:
//     • Vietnamese → the Vietnamese text for a known code; the server's English only for a code the POS does not know.
//     • English    → the server's own English message (it can be more specific than the registry's generic one —
//                    "phone is required" vs "Some fields are invalid."), else the registry text for the code.
//     • both: a validation answer with a field + rule the POS has a label for is worded from errors.rule.* (fieldErrorText).
//     • V-5: the code that words it is details.messageCode when the server sent one (withCode), else the answer's code.
// The error object keeps `code` (the authority — screens branch on it, never on the text) and `serverMessage`.
import { t, getLanguage } from '@aipowersalon/mobile-sdk/i18n';

type Vars = Record<string, string | number>;

/** only the primitive details can fill a {placeholder}; objects / arrays are dropped (never "[object Object]") */
function varsOf(details: Record<string, unknown> | null | undefined): Vars | undefined {
  if (!details || typeof details !== 'object') return undefined;
  const out: Vars = {};
  for (const [k, v] of Object.entries(details)) if (typeof v === 'string' || typeof v === 'number') out[k] = v;
  return out;
}

/** is there a catalogue text for this error code? */
export function hasErrorText(code: string | null | undefined): boolean {
  if (!code) return false;
  const key = `errors.${code}`;
  return t(key) !== key;
}

export function errorText(code: string | null | undefined, details?: Record<string, unknown> | null, fallback?: string | null): string {
  if (code) {
    const key = `errors.${code}`;
    const text = t(key, varsOf(details));
    if (text !== key) return text;
  }
  return fallback ?? '';
}

/** the label of a body field (`items[0].phone` → errors.field.phone), or null when the POS has no label for it */
function fieldLabel(path: unknown): string | null {
  if (typeof path !== 'string' || !path) return null;
  const leaf = path.replace(/\[\d+\]/g, '').split('.').pop() || '';
  const key = `errors.field.${leaf}`;
  const v = t(key);
  return v === key ? null : v;
}
const cap = (s: string) => (s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s);

/**
 * Vietnamese POS §2 / §21 / §58: a validation answer that names its field and rule (request-schema FieldError.rule / params,
 * service ValidationErrors with a field — `details.field / rule / params`, `details.fields[0]`) is worded here, in the
 * cashier's language: errors.rule.<RULE> with the field's label ("Phone is required." / "Bắt buộc nhập số điện thoại.").
 * null when the answer has no rule or the field has no label — the caller keeps its current wording.
 */
export function fieldErrorText(details?: Record<string, unknown> | null): string | null {
  if (!details || typeof details !== 'object') return null;
  const d = details as { field?: unknown; rule?: unknown; params?: unknown; fields?: unknown };
  const first = (Array.isArray(d.fields) ? d.fields[0] : null) as { path?: unknown; rule?: unknown; params?: unknown } | null;
  const rule = typeof d.rule === 'string' ? d.rule : typeof first?.rule === 'string' ? first.rule : null;
  const path = d.field ?? first?.path;
  const params = (d.params ?? first?.params ?? {}) as Record<string, unknown>;
  if (!rule) return null;
  const label = fieldLabel(path);
  if (!label) return null;
  const key = `errors.rule.${rule}`;
  const vars: Vars = { field: label };
  for (const [k, v] of Object.entries(params)) if (typeof v === 'string' || typeof v === 'number') vars[k] = v;
  if (typeof params.other === 'string') vars.other = fieldLabel(params.other) ?? params.other;
  const text = t(key, vars);
  return text === key ? null : cap(text);   // a sentence that starts with the label ("số điện thoại …") starts upper-case
}

export function apiErrorMessage(code: string | null | undefined, details?: Record<string, unknown> | null, serverMessage?: string | null): string {
  const server = typeof serverMessage === 'string' && serverMessage.trim() ? serverMessage : '';
  // V-5 (Oct 27 2026): a refusal the server coded with withCode(…) carries its registry code in details.messageCode — the
  // answer's `code` may stay a legacy kind a screen branches on ('stale_record'), so the WORDING follows messageCode
  const messageCode = details && typeof details.messageCode === 'string' && hasErrorText(details.messageCode) ? details.messageCode : null;
  if (messageCode) code = messageCode;
  // a field + rule the POS can word wins in both languages (the server's English stays on the error as serverMessage)
  const worded = fieldErrorText(details);
  if (worded) return worded;
  if (getLanguage() !== 'vi' && server) return server;
  return errorText(code, details, server) || server || t('errors.client.requestFailed');
}

/** The raw server text of an error answer (the same read posHttp makes). */
const rawServerText = (body: any): string => (Array.isArray(body?.message) ? body.message.join(' ') : body?.error?.message || body?.message) || '';
/**
 * VietnamesePOS §22 / §58 (Oct 28 2026 audit): the words to show for a refusal. `message` is what posHttp already chose — the
 * cashier's language for a code the POS knows, the server's English for one it does not. On a Vietnamese screen that English is
 * replaced by the screen's own Vietnamese `fallback` ("Lịch bị trùng", "Không lưu được") — never an English sentence mid-checkout.
 * An English screen keeps the server's specific sentence.
 */
export function localizedOr(message: string | null | undefined, body: unknown, fallback: string): string {
  const m = typeof message === 'string' ? message.trim() : '';
  if (!m) return fallback;
  if (getLanguage() === 'vi' && m === rawServerText(body).trim()) return fallback;
  return m;
}
/** The same rule for a caught error (PosHttpError / a module ApiError carrying `body`), for the screens' errText helpers. */
export function errorTextOf(e: any, fallback: string): string {
  if (e == null) return fallback;
  if (typeof e === 'string') return localizedOr(e, undefined, fallback);
  return localizedOr(typeof e.message === 'string' ? e.message : '', e.body, fallback);
}
