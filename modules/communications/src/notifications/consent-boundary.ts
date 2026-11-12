// consent-boundary.ts — Phone & Messaging 12 "Consent Boundary Checker" (Kevin, Nov 12 2026: booking verification codes still
// go out after STOP — they are transactional; marketing and follow-ups are blocked by STOP).
//
// ONE table of what a customer's STOP (SMS) or unsubscribe (email) does to each kind of message. The SMS send path reads
// smsStopExempt() from here, so the checker can never describe a rule the sender does not apply. Read-only: nothing here
// sends, opts anyone in or out, or changes a setting.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';

/** Texts a STOP does not stop: the person asked for them (a phone-change code / security notice). */
export const SMS_STOP_EXEMPT_PURPOSES: readonly string[] = ['account'];
export const smsStopExempt = (purpose: string | null | undefined): boolean => !!purpose && SMS_STOP_EXEMPT_PURPOSES.includes(purpose);

export type BoundaryKind = 'booking_code' | 'account' | 'receipt' | 'reminder' | 'notification' | 'conversation' | 'followup' | 'marketing'
  | 'email_transactional' | 'email_marketing';
export interface BoundaryRule {
  kind: BoundaryKind;
  channel: 'sms' | 'email';
  /** the stored purpose of that message on the notifications ledger; null = not sent through it */
  purpose: string | null;
  /** does the customer's STOP (sms) / full unsubscribe (email) stop it? */
  blockedByOptOut: boolean;
  /** does a marketing-only unsubscribe stop it (email) */
  blockedByMarketingUnsubscribe: boolean;
  /** why: transactional (asked for by the customer) vs marketing / service messages */
  basis: 'transactional' | 'service' | 'marketing';
  /** how it is sent: the salon's Twilio Verify service (never via the notifications ledger) or the notifications send path */
  path: 'verify_service' | 'notifications';
}

const sms = (kind: BoundaryKind, purpose: string, basis: BoundaryRule['basis']): BoundaryRule =>
  ({ kind, channel: 'sms', purpose, blockedByOptOut: !smsStopExempt(purpose), blockedByMarketingUnsubscribe: false, basis, path: 'notifications' });

export const CONSENT_BOUNDARY: readonly BoundaryRule[] = [
  // Six-digit booking codes go through the salon's Twilio Verify service (booking-verification-provider), which never reads
  // the opt-out list: a code is transactional — the customer is asking for it right now (Kevin, Nov 12 2026).
  { kind: 'booking_code', channel: 'sms', purpose: null, blockedByOptOut: false, blockedByMarketingUnsubscribe: false, basis: 'transactional', path: 'verify_service' },
  sms('account', 'account', 'transactional'),
  sms('receipt', 'receipt', 'service'),
  sms('reminder', 'reminder', 'service'),
  sms('notification', 'notification', 'service'),
  sms('conversation', 'conversation', 'service'),
  sms('followup', 'followup', 'service'),
  sms('marketing', 'marketing', 'marketing'),
  // email: a full unsubscribe stops everything; a marketing-only unsubscribe stops marketing mail only (748)
  { kind: 'email_transactional', channel: 'email', purpose: 'receipt', blockedByOptOut: true, blockedByMarketingUnsubscribe: false, basis: 'service', path: 'notifications' },
  { kind: 'email_marketing', channel: 'email', purpose: 'marketing', blockedByOptOut: true, blockedByMarketingUnsubscribe: true, basis: 'marketing', path: 'notifications' },
];

/** The checker: the rules plus this salon's evidence over the last 30 days (counts from the ledger, never inferred). */
export async function consentBoundary(db: Kysely<DB>, tenantId: string) {
  type Ev = { sms_opted_out: number; email_opted_out: number };
  const e = (await sql<Ev>`select
      (select count(*)::int from notification_opt_outs o where o.tenant_id = ${tenantId} and o.channel = 'sms' and o.scope = 'all') as sms_opted_out,
      (select count(*)::int from notification_opt_outs o where o.tenant_id = ${tenantId} and o.channel = 'email') as email_opted_out`.execute(db)).rows[0];
  type Bl = { channel: string; purpose: string | null; blocked: number; sent_despite: number };
  // blocked = recorded as blocked for an opt-out; sent_despite = let through the send path (sent / delivered, or simulated in a
  // test environment) while the address was opted out
  const rows = (await sql<Bl>`select n.channel, n.purpose,
        count(*) filter (where n.status = 'blocked' and n.failure_reason = 'opted_out')::int as blocked,
        count(*) filter (where n.status in ('sent', 'delivered', 'simulated') and exists (select 1 from notification_opt_outs o where o.tenant_id = n.tenant_id and o.channel = n.channel
          and o.address = n.to_address and o.scope = 'all' and o.opted_out_at < n.created_at))::int as sent_despite
      from notifications n where n.tenant_id = ${tenantId} and n.created_at > now() - interval '30 days' and n.channel in ('sms', 'email')
      group by n.channel, n.purpose`.execute(db)).rows;
  const ofRule = (r: BoundaryRule) => {
    const m = rows.filter((x) => x.channel === r.channel && x.purpose === r.purpose);
    const blocked = m.reduce((a, x) => a + Number(x.blocked || 0), 0), sentDespite = m.reduce((a, x) => a + Number(x.sent_despite || 0), 0);
    // a message the rule says STOP blocks that still went to an opted-out address is a breach the checker must show
    const state = r.path === 'verify_service' ? 'not_on_ledger' as const : r.blockedByOptOut && sentDespite > 0 ? 'breach' as const : 'consistent' as const;
    return { ...r, last30Days: r.path === 'verify_service' ? null : { blocked, sentToOptedOut: sentDespite }, state };
  };
  const rules = CONSENT_BOUNDARY.map(ofRule);
  return {
    rules, optedOut: { sms: Number(e?.sms_opted_out ?? 0), email: Number(e?.email_opted_out ?? 0) },
    overall: rules.some((r) => r.state === 'breach') ? 'breach' as const : 'consistent' as const,
    note: 'Read-only. STOP blocks every text except booking verification codes and account / security texts, which the customer asks for. Marketing also needs its own opt-in.',
  };
}
