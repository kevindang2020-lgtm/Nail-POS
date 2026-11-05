import { minutesSinceMidnight } from '@aipowersalon/date-time';
/** 'HH:MM' → minutes since midnight; the follow-up window's DEFAULT of 20:00 when malformed is this domain's policy. */
export function parseHHMM(s: string | null | undefined): number { return minutesSinceMidnight(s) ?? 20 * 60; }   // owned by @aipowersalon/date-time (Constitution 13 §87)
import type { FollowUpStatus, FollowUpTaskView, TechStats, FollowUpSettings } from '@aipowersalon/api-contracts/tenant';
// The wire type is the customer realm contract (Constitution 13 §15).
export type { RebookPreselect } from '@aipowersalon/api-contracts/customer';
import type { RebookPreselect } from '@aipowersalon/api-contracts/customer';
export type { FollowUpStatus, FollowUpTaskView, TechStats, FollowUpSettings };   // owned by packages/api-contracts (Constitution 13 §13)
/**
 * end-of-day-followups.dto.ts — types, deterministic message templates, and timezone/business-date helpers for the
 * Daily Follow-Up Queue. All time math uses the branch's IANA timezone via Intl (no extra dependency, DST-correct).
 */


export type FollowUpRole = 'tech' | 'manager' | 'customer';

export interface FollowUpContext {
  tenantId: string; branchId: string; userId: string; role?: string; permissions?: string[];
}





// ---- message templates (deterministic; AI may later *suggest*, tech confirms, system sends) ----
export interface TemplateVars { customerFirstName: string; technicianName: string; salonName: string; serviceName: string; }

export interface FollowUpTemplate { key: string; label: string; render: (v: TemplateVars) => string; }

const firstNameOr = (s: string) => (s && s.trim() ? s.trim().split(/\s+/)[0] : 'there');

export const FOLLOW_UP_TEMPLATES: FollowUpTemplate[] = [
  {
    key: 'thank_you', label: 'Thank You',
    render: (v) =>
      `Hi ${firstNameOr(v.customerFirstName)}, this is ${v.technicianName} from ${v.salonName}. Thank you for coming in today for your ${v.serviceName}. I hope you love your nails! If you have any questions or want to book your next visit, you can message us or book again in the app.`,
  },
  {
    key: 'aftercare', label: 'Aftercare Reminder',
    render: (v) =>
      `Hi ${firstNameOr(v.customerFirstName)}, thank you for coming in today. For best results, avoid harsh chemicals and apply cuticle oil daily. Hope you enjoy your new nails!`,
  },
  {
    key: 'book_again', label: 'Book Again Soon',
    render: (v) =>
      `Hi ${firstNameOr(v.customerFirstName)}, thank you for visiting today. For best maintenance, book your next appointment in 2-3 weeks. You can book directly in the app.`,
  },
  {
    key: 'review_request', label: 'Review Request',
    render: (v) =>
      `Hi ${firstNameOr(v.customerFirstName)}, thank you for visiting ${v.salonName} today for your ${v.serviceName}. If you enjoyed your visit, we'd love a quick rating in the app. It really helps!`,
  },
  {
    key: 'care_tips', label: 'Care Tips',
    render: (v) =>
      `Hi ${firstNameOr(v.customerFirstName)}, thanks for coming in for your ${v.serviceName}. Tip: wear gloves for cleaning and apply cuticle oil daily to keep your nails looking fresh longer.`,
  },
];

export const DEFAULT_TEMPLATE_KEY = 'thank_you';

export function renderTemplate(key: string | null, vars: TemplateVars): { key: string; message: string } {
  const tpl = FOLLOW_UP_TEMPLATES.find((t) => t.key === key) ?? FOLLOW_UP_TEMPLATES.find((t) => t.key === DEFAULT_TEMPLATE_KEY)!;
  return { key: tpl.key, message: tpl.render(vars) };
}

// ---- timezone / business-date helpers (Intl-based; DST-correct, no dependency) ----

/** Local calendar date (YYYY-MM-DD) for an instant in an IANA timezone. */
export function localDateInTz(d: Date, tz: string): string {
  // 'en-CA' formats as YYYY-MM-DD.
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  }
}

/** Minutes since local midnight for an instant in an IANA timezone (0..1439). */
export function localMinutesInTz(d: Date, tz: string): number {
  let hh = 0, mm = 0;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
    hh = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    mm = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  } catch { /* fall through to 0 */ }
  if (hh === 24) hh = 0; // some engines emit '24' at midnight
  return hh * 60 + mm;
}

/** Parse 'HH:mm' to minutes since midnight; tolerant of bad input (defaults to 20:00). */

export class FollowUpError extends Error {
  constructor(public code: 'forbidden' | 'not_found' | 'not_technician' | 'invalid_state' | 'validation', message: string) {
    super(message);
    this.name = 'FollowUpError';
  }
}
