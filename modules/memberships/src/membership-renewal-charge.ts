// membership-renewal-charge.ts — the LIVE membership renewal charge: the member's saved default card, charged through the
// TENANT's own gateway as a merchant-initiated, scheduled stored-credential transaction (Visa/Mastercard Stored
// Credential Transaction Framework: cof 'M', cofscheduled 'Y'; card-not-present: ecomind 'E').
//
// Selected only when MEMBERSHIP_AUTOBILL_ENABLED=1 (membership-billing.module). Otherwise the sweep keeps reporting
// not_configured, as it always has — automated charging of real cards is opted into, never on by default.
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { MembershipChargeRequest } from './membership-billing.service';

/** The slice of the payments module's gateway resolver this needs — structural, so memberships does not depend on
 *  payments (that dependency closed a module cycle: ai -> queue -> memberships -> payments -> ai). The API's composition
 *  root supplies the real PaymentGatewayResolver. */
export interface MembershipGatewayLike {
  resolve(tenantId: string): Promise<{ configured: boolean; processor?: { authorizeAndCapture(input: any): Promise<{ retref?: string; respstat: string; respText: string; amountCents?: number }> } }>;
}
import type { CardPointeRenewalResult } from './membership-billing-core';

export function membershipAutobillEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (['1', 'true', 'yes', 'on'].includes(String(env.POST_RESTORE_HOLD ?? '').trim().toLowerCase())) return false;
  return ['1', 'true', 'yes', 'on'].includes(String(env.MEMBERSHIP_AUTOBILL_ENABLED ?? '').trim().toLowerCase());
}

/** The member's default saved card (a gateway TOKEN, never a PAN) at this salon, or null. */
export async function defaultSavedCard(db: Kysely<DB>, tenantId: string, customerId: string): Promise<{ token: string; expiry?: string } | null> {
  // Fiserv master build §8D / §8E: a merchant-initiated (cof 'M') renewal may only use a provider-verified hosted-iFrame
  // card whose holder gave SEPARATE consent for scheduled merchant-initiated charges, not revoked. The add-card flow
  // records only customer-initiated consent today, so this returns null until an MIT consent flow is certified.
  const r: any = await db.selectFrom('customer_payment_methods').select(['token', 'exp_month', 'exp_year', 'is_default'] as any)
    .where('tenant_id', '=', tenantId).where('customer_id', '=', customerId)
    .where('token_source' as any, '=', 'hosted_iframe').where('verified_at' as any, 'is not', null)
    .where('consent_scope' as any, '=', 'mit_scheduled').where('revoked_at' as any, 'is', null)
    .orderBy('is_default', 'desc').orderBy('created_at', 'desc').limit(1).executeTakeFirst().catch(() => undefined);
  if (!r?.token) return null;
  const mm = r.exp_month, yy = r.exp_year;
  return { token: String(r.token), expiry: mm && yy ? String(mm).padStart(2, '0') + String(yy).slice(-2) : undefined };
}

/** Builds the chargeFn a CardPointeMembershipChargeAdapter takes. */
export function renewalChargeFn(db: Kysely<DB>, gateway: MembershipGatewayLike): (req: MembershipChargeRequest) => Promise<CardPointeRenewalResult> {
  return async (req) => {
    const gw = await gateway.resolve(req.tenantId);
    if (!gw.configured || !gw.processor) return { respstat: 'C', resptext: 'No payment gateway configured for this salon' };
    const card = await defaultSavedCard(db, req.tenantId, req.customerId);
    if (!card) return { respstat: 'C', resptext: 'Member has no saved card' };
    const r = await gw.processor.authorizeAndCapture({
      account: card.token, expiry: card.expiry, amountCents: req.amountCents, orderId: req.membershipId, idempotencyKey: req.idempotencyKey,
      ecomind: 'E', cof: 'M', cofscheduled: 'Y',
    });
    return { retref: r.retref, respstat: r.respstat, resptext: r.respText, amount: r.amountCents != null ? (r.amountCents / 100).toFixed(2) : undefined };
  };
}
