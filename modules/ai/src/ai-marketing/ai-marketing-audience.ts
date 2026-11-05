// ai-marketing-audience.ts — the APPROVED audience-dimension registry + pure validation (Section 9).
// This is the ONLY way an audience can be defined. There is no text-to-SQL: the model (or client) may only
// submit values for these named, bounded dimensions. Unknown keys are rejected; numbers are clamped; enums
// are checked. Branch is NEVER taken from the definition — it is server-derived from ctx by the repository,
// so a client cannot target an unauthorized branch.

export type AudienceChannel = 'sms' | 'email';

// The validated, safe shape the repository consumes. Every field maps to a real, verified customers/appointment
// column via parameterized query builders — never a raw predicate.
export interface AudienceDefinition {
  channel: AudienceChannel; // which consent column is required (sms → marketing_sms_opt_in, etc.)
  minDaysSinceLastCompletedVisit: number | null; // completed visit strictly older than N days (1..1000)
  excludeWithFutureAppointment: boolean; // default true — never re-market to someone already booked
  birthdayMonth: number | null; // 1..12, or null; 'current' is resolved by the caller before validation
  requireActiveStatus: boolean; // customers.status = 'active'
}

export class AudienceValidationError extends Error {}

const ALLOWED_KEYS = new Set([
  'channel',
  'minDaysSinceLastCompletedVisit',
  'excludeWithFutureAppointment',
  'birthdayMonth',
  'requireActiveStatus',
]);

const MIN_DAYS = 1;
const MAX_DAYS = 1000;

function clampInt(v: unknown, lo: number, hi: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) throw new AudienceValidationError('Expected a number');
  return Math.max(lo, Math.min(hi, n));
}

// Validate raw client/model input into a safe AudienceDefinition. Rejects any unknown key outright so no
// arbitrary field name, join, or predicate can slip through.
export function validateAudienceDefinition(raw: unknown): AudienceDefinition {
  if (!raw || typeof raw !== 'object') throw new AudienceValidationError('Audience definition required');
  const obj = raw as Record<string, unknown>;

  for (const k of Object.keys(obj)) {
    if (!ALLOWED_KEYS.has(k)) throw new AudienceValidationError(`Unknown audience dimension: ${k}`);
  }

  const channel = obj.channel;
  if (channel !== 'sms' && channel !== 'email') {
    throw new AudienceValidationError('channel must be "sms" or "email"');
  }

  let minDays: number | null = null;
  if (obj.minDaysSinceLastCompletedVisit != null) {
    minDays = clampInt(obj.minDaysSinceLastCompletedVisit, MIN_DAYS, MAX_DAYS);
  }

  let birthdayMonth: number | null = null;
  if (obj.birthdayMonth != null) {
    const m = clampInt(obj.birthdayMonth, 1, 12);
    birthdayMonth = m;
  }

  return {
    channel,
    minDaysSinceLastCompletedVisit: minDays,
    excludeWithFutureAppointment: obj.excludeWithFutureAppointment === false ? false : true, // default true
    birthdayMonth,
    requireActiveStatus: obj.requireActiveStatus === false ? false : true, // default true
  };
}

// Aggregate-only preview (Section 13). No customer rows are returned here — sample rows require a separate
// customer-detail permission in a later slice. `eligible` already excludes suppressed/opted-out/no-contact.
export interface AudiencePreview {
  channel: AudienceChannel;
  total: number; // matched the demographic/behavioral filters
  eligible: number; // total minus suppressed
  suppressed: number; // opted-out / on suppression list / missing usable contact
  breakdown: {
    missingContact: number;
    optedOut: number;
  };
  definitionEcho: AudienceDefinition; // so the UI can show exactly what was evaluated
  generatedAt: string;
}
