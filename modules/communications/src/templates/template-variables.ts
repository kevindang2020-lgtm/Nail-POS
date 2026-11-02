// template-variables.ts — the ONE variable registry + renderer for the salon's message templates (Message Templates &
// Automation Center Complete Build Guide §08, §15, §18). Pure: no DB, no I/O — the service resolves VALUES from authorized
// records and hands them here.
//
// Token syntax: {token} (the canonical form, the same braces Campaign Center uses for {salon_name}). Backward compatible:
// the legacy [name] and {name} the old New Template form told staff to type both mean customer_first_name, and saved
// templates are NEVER bulk-rewritten — the resolver understands the old forms in place.
//
// Safety rules enforced here (guide §08 "Validation and safety rules", §18):
//   - a strict allowlist: a token that is not registered is UNKNOWN (warned in preview, blocks activation) — no SQL paths,
//     no raw PII fields, no expressions; verification codes, card data and staff pay are not variables at all;
//   - a token is only allowed in the categories whose workflow can actually supply it (an appointment time in a birthday
//     template would always be empty);
//   - values are inserted as TEXT: SMS gets the plain value, the email HTML preview escapes every value AND the body;
//   - a missing value never renders as a blank "Hi , ": a variable with an explicit fallback policy uses it, anything else
//     is reported as missing so the caller can refuse (Inbox) or keep its built-in text (automations).
import { estimateSmsSegments } from '@aipowersalon/api-contracts';

export type TemplateChannel = 'sms' | 'email';
export type MessageClass = 'transactional' | 'marketing' | 'conversational';

export const TEMPLATE_CATEGORIES = [
  'booking_confirmation', 'appointment_reminder', 'reschedule_cancellation', 'customer_follow_up', 'missed_call_follow_up',
  'review_request', 'birthday', 'loyalty_rewards', 'membership', 'receipt', 'promotions', 'general',
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

/** transactional vs marketing (guide §15): consent / opt-out is checked at SEND time by the sending workflow; the class
 *  decides what a template must contain (a marketing SMS needs the STOP line) and which consent the sender applies. */
export const CATEGORY_CLASS: Record<TemplateCategory, MessageClass> = {
  booking_confirmation: 'transactional', appointment_reminder: 'transactional', reschedule_cancellation: 'transactional',
  customer_follow_up: 'transactional', missed_call_follow_up: 'conversational', review_request: 'marketing', birthday: 'marketing',
  loyalty_rewards: 'marketing', membership: 'transactional', receipt: 'transactional', promotions: 'marketing', general: 'conversational',
};

export type VariableGroup = 'customer' | 'salon' | 'appointment' | 'follow_up' | 'receipt';
export interface TemplateVariable {
  token: string; group: VariableGroup; label: string; source: string; sample: string;
  /** categories whose workflow supplies this value; '*' = every category */
  categories: readonly (TemplateCategory | '*')[];
  /** an explicit, documented fallback when the value is unknown (guide §08 "explicit authorized fallback policy") */
  fallback?: string;
}

const APPT: TemplateCategory[] = ['booking_confirmation', 'appointment_reminder', 'reschedule_cancellation'];
const FOLLOW: TemplateCategory[] = ['customer_follow_up', 'review_request'];

export const TEMPLATE_VARIABLES: readonly TemplateVariable[] = [
  { token: 'customer_first_name', group: 'customer', label: 'Customer first name', source: 'customers.first_name (the customer the message is for)', sample: 'Ava', categories: ['*'], fallback: 'there' },
  { token: 'customer_full_name', group: 'customer', label: 'Customer full name', source: 'customers.full_name', sample: 'Ava Nguyen', categories: ['*'] },
  { token: 'salon_name', group: 'salon', label: 'Salon name', source: 'tenants.display_name', sample: 'Pilot Nail Salon', categories: ['*'] },
  { token: 'branch_name', group: 'salon', label: 'Branch name', source: 'branches.name (the branch of the booking / conversation)', sample: 'Main', categories: ['*'] },
  { token: 'salon_phone', group: 'salon', label: 'Salon phone', source: 'branches.phone, else the salon\'s phone', sample: '(609) 555-0100', categories: ['*'] },
  { token: 'appointment_date', group: 'appointment', label: 'Appointment date', source: 'appointments.appt_date, in the salon\'s time zone', sample: 'Tue, Nov 3', categories: APPT },
  { token: 'appointment_time', group: 'appointment', label: 'Appointment time', source: 'appointments.start_time, in the salon\'s time zone', sample: '2:30 PM', categories: APPT },
  { token: 'booking_reference', group: 'appointment', label: 'Booking reference', source: 'appointments reference (short id)', sample: 'BK-7F3A21', categories: APPT },
  { token: 'service_name', group: 'appointment', label: 'Service', source: 'the booked service', sample: 'Gel Manicure', categories: [...APPT, ...FOLLOW] },
  { token: 'technician_name', group: 'appointment', label: 'Technician', source: 'the assigned technician (booking) / the technician of the completed service (follow-up)', sample: 'Lily', categories: [...APPT, ...FOLLOW] },
  { token: 'last_service', group: 'follow_up', label: 'Last service', source: 'the last completed (paid) service', sample: 'Pedicure', categories: [...FOLLOW, 'birthday', 'loyalty_rewards', 'promotions'] },
  { token: 'last_visit_date', group: 'follow_up', label: 'Last visit date', source: 'the last paid ticket, in the salon\'s time zone', sample: 'Oct 12', categories: [...FOLLOW, 'birthday', 'loyalty_rewards', 'promotions'] },
  { token: 'receipt_reference', group: 'receipt', label: 'Receipt reference', source: 'the finalized ticket number', sample: 'T-1042', categories: ['receipt'] },
];
const BY_TOKEN = new Map(TEMPLATE_VARIABLES.map((v) => [v.token, v]));
/** legacy placeholders (the old form's hint: "[name] … filled in per recipient") — understood, never rewritten */
export const LEGACY_ALIASES: Record<string, string> = { '[name]': 'customer_first_name', '{name}': 'customer_first_name', '[first_name]': 'customer_first_name' };
/** never a variable (guide §15, §18): codes, card data, staff pay — a template asking for one is refused, not filled */
const FORBIDDEN = /^(otp|code|verification(_code)?|pin|password|card(_number)?|cvv|pan|ssn|pay(roll)?|wage|salary|commission|tips?)$/i;

/** {{token}} (the Super Admin / platform template syntax, communications-templates-core) | {token} (canonical) | [name] (legacy) */
const TOKEN_RE = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}|\{\s*([a-z][a-z0-9_]*)\s*\}|\[(name|first_name)\]/gi;

export interface ParsedToken { raw: string; token: string; legacy: boolean }
export function parseTokens(text: string | null | undefined): ParsedToken[] {
  const out: ParsedToken[] = [];
  for (const m of String(text ?? '').matchAll(TOKEN_RE)) {
    if (m[3]) out.push({ raw: m[0], token: LEGACY_ALIASES[`[${m[3].toLowerCase()}]`] ?? 'customer_first_name', legacy: true });
    else { const t = String(m[1] ?? m[2]).toLowerCase(); out.push({ raw: m[0], token: LEGACY_ALIASES[`{${t}}`] ?? t, legacy: t === 'name' }); }
  }
  return out;
}
export function variablesFor(category: string | null | undefined): TemplateVariable[] {
  const c = (TEMPLATE_CATEGORIES as readonly string[]).includes(String(category)) ? (category as TemplateCategory) : 'general';
  return TEMPLATE_VARIABLES.filter((v) => v.categories.includes('*') || v.categories.includes(c));
}

export interface TemplateDraft { channel: string; category?: string | null; subject?: string | null; body: string; name?: string }
export interface Finding { code: string; token?: string; message: string }
export interface Validation { errors: Finding[]; warnings: Finding[]; tokens: string[] }

export const SMS_MAX = 1600, EMAIL_MAX = 20_000, SUBJECT_MAX = 200, NAME_MAX = 120;
const STOP_RE = /\b(reply|text)\s+stop\b|\bstop\s+to\s+(opt|unsubscribe|end)/i;

/** what activation requires (errors) and what the editor should point out (warnings) — the same rules everywhere */
export function validateTemplate(d: TemplateDraft): Validation {
  const errors: Finding[] = [], warnings: Finding[] = [];
  const channel = d.channel === 'email' ? 'email' : d.channel === 'sms' ? 'sms' : null;
  if (!channel) errors.push({ code: 'TEMPLATE_CHANNEL_INVALID', message: 'Choose SMS or Email.' });
  const body = String(d.body ?? '');
  if (d.name != null && !String(d.name).trim()) errors.push({ code: 'TEMPLATE_NAME_REQUIRED', message: 'Give the template a name.' });
  if (d.name != null && String(d.name).trim().length > NAME_MAX) errors.push({ code: 'TEMPLATE_NAME_TOO_LONG', message: `Names can be at most ${NAME_MAX} characters.` });
  if (!body.trim()) errors.push({ code: 'TEMPLATE_BODY_REQUIRED', message: 'Write the message.' });
  if (channel === 'sms' && body.length > SMS_MAX) errors.push({ code: 'TEMPLATE_BODY_TOO_LONG', message: `An SMS template can be at most ${SMS_MAX} characters.` });
  if (channel === 'email' && body.length > EMAIL_MAX) errors.push({ code: 'TEMPLATE_BODY_TOO_LONG', message: `An email template can be at most ${EMAIL_MAX} characters.` });
  if (channel === 'email' && !String(d.subject ?? '').trim()) errors.push({ code: 'TEMPLATE_SUBJECT_REQUIRED', message: 'An email template needs a subject.' });
  if (String(d.subject ?? '').length > SUBJECT_MAX) errors.push({ code: 'TEMPLATE_SUBJECT_TOO_LONG', message: `Subjects can be at most ${SUBJECT_MAX} characters.` });
  const category = (TEMPLATE_CATEGORIES as readonly string[]).includes(String(d.category)) ? (d.category as TemplateCategory) : null;
  if (d.category && !category) errors.push({ code: 'TEMPLATE_CATEGORY_INVALID', message: 'Choose a category from the list.' });
  const allowed = new Set(variablesFor(category).map((v) => v.token));
  const tokens = [...parseTokens(body), ...parseTokens(d.subject)];
  const seen = new Set<string>();
  for (const t of tokens) {
    if (seen.has(t.raw)) continue; seen.add(t.raw);
    if (FORBIDDEN.test(t.token)) errors.push({ code: 'TEMPLATE_VARIABLE_FORBIDDEN', token: t.raw, message: `${t.raw} is not allowed: codes, card details and staff pay never go into a template.` });
    else if (!BY_TOKEN.has(t.token)) errors.push({ code: 'TEMPLATE_VARIABLE_UNKNOWN', token: t.raw, message: `${t.raw} is not a known variable. Pick one from the variable list.` });
    else if (!allowed.has(t.token)) errors.push({ code: 'TEMPLATE_VARIABLE_NOT_FOR_CATEGORY', token: t.raw, message: `${t.raw} is not available for ${category ? category.replace(/_/g, ' ') : 'a general message'} — that message never has it.` });
    if (t.legacy) warnings.push({ code: 'TEMPLATE_LEGACY_PLACEHOLDER', token: t.raw, message: `${t.raw} still works (it means {customer_first_name}).` });
  }
  if (channel === 'sms' && category && CATEGORY_CLASS[category] === 'marketing' && !STOP_RE.test(body)) {
    errors.push({ code: 'TEMPLATE_OPT_OUT_REQUIRED', message: 'A marketing text must tell people how to opt out — add "Reply STOP to opt out."' });
  } else if (channel === 'sms' && !STOP_RE.test(body) && category && CATEGORY_CLASS[category] === 'transactional') {
    warnings.push({ code: 'TEMPLATE_OPT_OUT_SUGGESTED', message: 'Automated texts usually end with "Reply STOP to opt out." Automations add it when the template does not have it.' });
  }
  return { errors, warnings, tokens: [...new Set(tokens.map((t) => t.token))] };
}

export type Values = Partial<Record<string, string | null | undefined>>;
export interface Rendered { subject: string | null; text: string; html: string | null; missing: string[]; used: string[]; unknown: string[]; sms: ReturnType<typeof estimateSmsSegments> | null }

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
function fill(text: string, values: Values, missing: Set<string>, used: Set<string>, unknown: Set<string>): string {
  return text.replace(TOKEN_RE, (raw, dbl: string | undefined, tok: string | undefined, legacy: string | undefined) => {
    const t = String(dbl ?? tok ?? '').toLowerCase();
    const token = legacy ? 'customer_first_name' : (LEGACY_ALIASES[`{${t}}`] ?? t);
    const def = BY_TOKEN.get(token);
    if (!def || FORBIDDEN.test(token)) { unknown.add(raw); return raw; }
    used.add(token);
    const v = values[token];
    if (v != null && String(v).trim()) return String(v).trim();
    if (def.fallback != null) return def.fallback;
    missing.add(token); return '';
  });
}
/** render for a channel; `ensureStop` appends the carrier opt-out line to an SMS that has none (automations) */
export function renderTemplate(d: { channel: string; subject?: string | null; body: string }, values: Values, opts: { ensureStop?: boolean } = {}): Rendered {
  const missing = new Set<string>(), used = new Set<string>(), unknown = new Set<string>();
  let text = fill(String(d.body ?? ''), values, missing, used, unknown).replace(/[ \t]+([,.!?])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();
  if (d.channel === 'sms' && opts.ensureStop && !STOP_RE.test(text)) text = `${text} Reply STOP to opt out.`;
  const subject = d.channel === 'email' ? fill(String(d.subject ?? ''), values, missing, used, unknown).trim() : null;
  // the email preview is plain text made safe: every character of the body AND of every value is escaped; no markup passes
  const html = d.channel === 'email' ? `<div style="font-family:system-ui,Arial,sans-serif;white-space:pre-wrap">${escapeHtml(text)}</div>` : null;
  return { subject, text, html, missing: [...missing], used: [...used], unknown: [...unknown], sms: d.channel === 'sms' ? estimateSmsSegments(text) : null };
}
/** the clearly fake preview data (guide §09 "clearly marked fake fixture data") */
export function fixtureValues(): Values { return Object.fromEntries(TEMPLATE_VARIABLES.map((v) => [v.token, v.sample])); }
