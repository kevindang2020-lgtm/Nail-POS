// membership-comms-core.ts — pure composition of member-facing membership messages (welcome / renewal reminder / payment
// failed / canceled). No I/O. Messages are delivered in-app (customer_notifications); an external SMS/email channel can be
// layered later and stays inert until a sender is configured. The reference strings make delivery idempotent.

export type MemberCommEvent = 'welcome' | 'renewal_reminder' | 'expiry_reminder' | 'payment_failed' | 'canceled';

export interface MemberCommContext { customerName: string | null; planName: string | null; nextBillingAt?: string | null }
export interface ComposedComm { type: string; title: string; body: string }

export const MEMBER_COMM_TYPE = 'membership';

function firstName(full: string | null): string {
  const n = (full || '').trim().split(/\s+/)[0];
  return n || 'there';
}
function fmtDate(iso?: string | null): string {
  if (!iso) return 'soon';
  const d = new Date(iso);
  // next_billing_at is a billing CALENDAR date stored at UTC midnight — format it in UTC so the server's own zone can
  // never move "July 27" to "July 26" (it did on an east-coast host)
  return isNaN(d.getTime()) ? 'soon' : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export function composeMemberComm(event: MemberCommEvent, ctx: MemberCommContext): ComposedComm {
  const name = firstName(ctx.customerName);
  const plan = ctx.planName || 'membership';
  switch (event) {
    case 'welcome':
      return { type: MEMBER_COMM_TYPE, title: `Welcome to ${plan}!`, body: `Hi ${name}, your ${plan} membership is active. Enjoy your member benefits on your next visit.` };
    case 'renewal_reminder':
      return { type: MEMBER_COMM_TYPE, title: `Your ${plan} renews soon`, body: `Hi ${name}, your ${plan} membership renews on ${fmtDate(ctx.nextBillingAt)}. No action needed — we look forward to seeing you.` };
    case 'expiry_reminder':
      return { type: MEMBER_COMM_TYPE, title: `Your ${plan} ends soon`, body: `Hi ${name}, your ${plan} membership ends on ${fmtDate(ctx.nextBillingAt)}. Ask the salon if you would like to renew.` };
    case 'payment_failed':
      return { type: MEMBER_COMM_TYPE, title: `Payment issue on your ${plan}`, body: `Hi ${name}, we couldn't process the latest payment for your ${plan} membership. Please update your payment method or contact the salon.` };
    case 'canceled':
      return { type: MEMBER_COMM_TYPE, title: `Your ${plan} membership was canceled`, body: `Hi ${name}, your ${plan} membership has been canceled. We'd love to welcome you back anytime.` };
  }
}

/** Stable per-period reference so a renewal reminder is sent at most once per billing date. */
export function renewalReminderReference(membershipId: string, nextBillingAt?: string | null): string {
  return `membership-renewal:${membershipId}:${(nextBillingAt || '').slice(0, 10)}`;
}
export function welcomeReference(membershipId: string): string { return `membership-welcome:${membershipId}`; }
export function paymentFailedReference(membershipId: string, dayIso: string): string { return `membership-payment-failed:${membershipId}:${dayIso.slice(0, 10)}`; }

/** Stable per-term reference so an expiry reminder is sent at most once per end date. */
export function expiryReminderReference(membershipId: string, endsAt?: string | null): string {
  return `membership-expiry:${membershipId}:${(endsAt || '').slice(0, 10)}`;
}

/**
 * Architecture §151 (Kevin's decision, Oct 28 2026): the renewal / expiry reminder is ALSO texted, through the salon's own
 * messenger (its number, opt-outs, ledger). ENGLISH — every customer message is (customerMessageLanguage). A transactional
 * reminder about the customer's own membership (purpose 'reminder', not metered, no marketing consent needed); a customer who
 * replied STOP is blocked by the messenger. No amount, no link. ≤ 160 characters for a usual salon / plan name.
 */
export function composeMemberSms(event: 'renewal_reminder' | 'expiry_reminder', ctx: MemberCommContext & { salonName?: string | null }): string {
  const salon = (ctx.salonName || '').trim() || 'Your salon';
  const plan = ctx.planName || 'membership';
  const when = fmtDate(ctx.nextBillingAt);
  return event === 'renewal_reminder'
    ? `${salon}: your ${plan} membership renews on ${when}. Reply STOP to opt out.`
    : `${salon}: your ${plan} membership ends on ${when}. Ask us if you'd like to renew. Reply STOP to opt out.`;
}
