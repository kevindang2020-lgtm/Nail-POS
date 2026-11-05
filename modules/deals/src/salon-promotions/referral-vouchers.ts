// referral-vouchers.ts — Refer a Friend / Referral Rewards build (Nov 5 2026) R026, R038–R041: a referral reward VOUCHER is a
// customer-bound, single-use, salon-local wallet coupon on the ONE discount authority (deals). It is never cash, a gift card,
// global points or tokens (R003). The customers module's referral program (which cannot depend on deals — deals depends on
// customers) reaches it through the global token REFERRAL_VOUCHERS, inside ITS transaction (one atomic activation /
// qualification). Checkout then finds the voucher in the customer's wallet and applies, reserves, redeems and releases it
// exactly like any coupon (apply-offer → payment → refund / removal), so the discount is one record, not a tender.
//
// One system coupon deal per (salon, role, face value, minimum spend): legacy_source 'referral_friend' / 'referral_referrer'.
// The voucher code is generated with the coupon generator, shown once, stored only as a hash + last 4.
import { Global, Module } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { canMoveToSql } from '@aipowersalon/database';
import { generateCodes, hashCode, codeHint } from '../engine/coupons';
import { DEAL_COUPON_CODE } from '../engine/deal-lifecycles';

export const REFERRAL_VOUCHERS = 'REFERRAL_VOUCHERS';
type Exec = Kysely<any>;
type Row = Record<string, any>;
export type VoucherRole = 'friend' | 'referrer';

export interface IssuedVoucher { dealId: string; couponCodeId: string; code: string; hint: string }
export interface VoucherUsage { couponCodeId: string; status: 'active' | 'revoked' | 'exhausted'; used: boolean; expiresAt: string | null; ticketId: string | null; discountCents: number }

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

export class ReferralVoucherIssuer {
  /** the salon's system coupon deal for this reward (created once, active, code-only, never stacked with another offer) */
  private async dealFor(x: Exec, tenantId: string, role: VoucherRole, faceCents: number, minSpendCents: number): Promise<string> {
    const src = role === 'friend' ? 'referral_friend' : 'referral_referrer';
    const found = (await sql<Row>`SELECT id FROM deals WHERE tenant_id = ${tenantId}::uuid AND kind = 'coupon' AND legacy_source = ${src} AND discount_cents = ${faceCents}
      AND coalesce(min_spend_cents, 0) = ${minSpendCents} AND status = 'active' ORDER BY created_at LIMIT 1`.execute(x)).rows[0];
    if (found) return String(found.id);
    const title = role === 'friend' ? `Referral welcome — ${money(faceCents)} off` : `Referral thank-you — ${money(faceCents)} off`;
    const terms = `${role === 'friend' ? 'First-visit referral discount' : 'Reward for a friend\'s qualifying first visit'}. One use, this salon only${minSpendCents > 0 ? `, minimum spend ${money(minSpendCents)}` : ''}. Not cash, not a gift card; no change given.`;
    const r = (await sql<Row>`INSERT INTO deals (tenant_id, branch_id, owner_type, kind, title, short_description, terms, discount_type, discount_cents, min_spend_cents, status,
        stackable, requires_code, legacy_source, published_at)
      VALUES (${tenantId}::uuid, NULL, 'salon', 'coupon', ${title}, ${role === 'friend' ? 'Your referral welcome discount' : 'Thanks for referring a friend'}, ${terms},
        'fixed', ${faceCents}, ${minSpendCents > 0 ? minSpendCents : null}, 'active', false, true, ${src}, now()) RETURNING id`.execute(x)).rows[0];
    await sql`INSERT INTO deal_versions (deal_id, tenant_id, version, terms, changed_by_user_id) VALUES (${r.id}, ${tenantId}::uuid, 1, ${JSON.stringify({ title, kind: 'coupon', source: src, discountCents: faceCents, minSpendCents })}::jsonb, NULL)`.execute(x);
    return String(r.id);
  }

  /** issue one customer-bound single-use voucher (in the caller's transaction) */
  async issue(x: Exec, a: { tenantId: string; customerId: string; role: VoucherRole; faceCents: number; minSpendCents: number; expiresAt: string }): Promise<IssuedVoucher> {
    const dealId = await this.dealFor(x, a.tenantId, a.role, a.faceCents, a.minSpendCents);
    const [code] = generateCodes(1, a.role === 'friend' ? 'WELCOME' : 'THANKS');
    const batch = (await sql<Row>`INSERT INTO deal_coupon_batches (tenant_id, deal_id, quantity, prefix, single_use, purpose, expires_at)
      VALUES (${a.tenantId}::uuid, ${dealId}::uuid, 1, ${a.role === 'friend' ? 'WELCOME' : 'THANKS'}, true, 'wallet', ${a.expiresAt}::timestamptz) RETURNING id`.execute(x)).rows[0];
    const c = (await sql<Row>`INSERT INTO deal_coupon_codes (tenant_id, deal_id, batch_id, code_hash, code_hint, single_use, customer_id, expires_at)
      VALUES (${a.tenantId}::uuid, ${dealId}::uuid, ${batch.id}, ${hashCode(a.tenantId, code)}, ${codeHint(code)}, true, ${a.customerId}::uuid, ${a.expiresAt}::timestamptz) RETURNING id`.execute(x)).rows[0];
    return { dealId, couponCodeId: String(c.id), code, hint: codeHint(code) };
  }

  /** cancel an UNUSED voucher (refund / reversal / dispute). A used one is not touched (returns false). */
  async revoke(x: Exec, tenantId: string, couponCodeId: string, reason: string): Promise<boolean> {
    const r = (await sql<Row>`UPDATE deal_coupon_codes SET status = 'revoked', revoked_at = now(), revoked_reason = ${reason.slice(0, 300)}, updated_at = now()
      WHERE tenant_id = ${tenantId}::uuid AND id = ${couponCodeId}::uuid AND status = 'active' AND use_count = 0 AND ${canMoveToSql(DEAL_COUPON_CODE, 'revoked')}
        AND NOT EXISTS (SELECT 1 FROM deal_redemptions d WHERE d.tenant_id = ${tenantId}::uuid AND d.coupon_code_id = ${couponCodeId}::uuid AND d.status IN ('applied', 'redeemed', 'partially_reversed'))
      RETURNING id`.execute(x)).rows[0];
    return !!r;
  }

  /** how each voucher stands on the discount authority (used = redeemed on a paid ticket) */
  async usage(x: Exec, tenantId: string, ids: string[]): Promise<Map<string, VoucherUsage>> {
    const out = new Map<string, VoucherUsage>();
    if (!ids.length) return out;
    const rows = (await sql<Row>`SELECT c.id, c.status, c.use_count, c.expires_at,
        (SELECT d.ticket_id FROM deal_redemptions d WHERE d.tenant_id = c.tenant_id AND d.coupon_code_id = c.id AND d.status IN ('redeemed', 'partially_reversed') ORDER BY d.created_at DESC LIMIT 1) AS ticket_id,
        (SELECT coalesce(sum(d.amount_discounted_cents), 0) FROM deal_redemptions d WHERE d.tenant_id = c.tenant_id AND d.coupon_code_id = c.id AND d.status IN ('redeemed', 'partially_reversed')) AS discount
      FROM deal_coupon_codes c WHERE c.tenant_id = ${tenantId}::uuid AND c.id = ANY(${ids}::uuid[])`.execute(x)).rows;
    for (const r of rows) out.set(String(r.id), { couponCodeId: String(r.id), status: r.status, used: Number(r.use_count) > 0 || !!r.ticket_id, expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null, ticketId: r.ticket_id ? String(r.ticket_id) : null, discountCents: Number(r.discount) || 0 });
    return out;
  }
}

/** the global provider (the customers module injects it optionally — without it, voucher rewards are refused, never faked) */
@Global()
@Module({ providers: [{ provide: REFERRAL_VOUCHERS, useValue: new ReferralVoucherIssuer() }], exports: [REFERRAL_VOUCHERS] })
export class ReferralVouchersModule {}
