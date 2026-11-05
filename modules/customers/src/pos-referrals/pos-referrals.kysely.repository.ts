// pos-referrals.kysely.repository.ts — Kysely/Postgres adapter. Referral codes come from customer_referrals
// (migration 046); redemptions from referral_redemptions (migration 323). Tenant scoping is server-derived
// from ctx. Raw sql is used for referral_redemptions so we don't depend on generated table types.
import { canMoveToSql } from '@aipowersalon/database';
import { REFERRAL_REDEMPTION } from '../customer-lifecycles';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { ReferralsContext, ReferralRedemption } from './pos-referrals.dto';
import type { ReferralsRepositoryPort, CodeOwner } from './pos-referrals.repository';

function toDomain(r: any): ReferralRedemption {
  return {
    id: String(r.id),
    referrerCustomerId: String(r.referrer_customer_id),
    referrerName: r.referrer_name ?? null,
    referredCustomerId: r.referred_customer_id ? String(r.referred_customer_id) : null,
    referredName: r.referred_name ?? null,
    code: String(r.code),
    status: String(r.status) as any,
    rewardCents: Number(r.reward_cents || 0),
    redeemedAt: r.redeemed_at ? new Date(r.redeemed_at).toISOString() : '',
    rewardedAt: r.rewarded_at ? new Date(r.rewarded_at).toISOString() : null,
  };
}

export class KyselyReferralsRepository implements ReferralsRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}

  async countCodes(ctx: ReferralsContext): Promise<number> {
    const res: any = await sql`SELECT count(*)::int AS n FROM customer_referrals WHERE tenant_id = ${ctx.tenantId}`.execute(this.db as any).catch(() => ({ rows: [] }));
    return Number(res.rows?.[0]?.n ?? 0);
  }

  async listRedemptions(ctx: ReferralsContext): Promise<ReferralRedemption[]> {
    const res: any = await sql`
      SELECT rr.id, rr.referrer_customer_id, rr.referred_customer_id, rr.code, rr.status, rr.reward_cents, rr.redeemed_at, rr.rewarded_at,
             COALESCE(rc.full_name, rc.first_name || ' ' || rc.last_name, rc.email, '—') AS referrer_name,
             COALESCE(dc.full_name, dc.first_name || ' ' || dc.last_name, dc.email, '—') AS referred_name
      FROM referral_redemptions rr
      LEFT JOIN customers rc ON rc.id = rr.referrer_customer_id
      LEFT JOIN customers dc ON dc.id = rr.referred_customer_id
      WHERE rr.tenant_id = ${ctx.tenantId}
      ORDER BY rr.redeemed_at DESC
    `.execute(this.db as any).catch(() => ({ rows: [] }));
    return (res.rows ?? []).map(toDomain);
  }

  async findCodeOwner(ctx: ReferralsContext, code: string): Promise<CodeOwner | null> {
    const res: any = await sql`
      SELECT cr.customer_id, COALESCE(c.full_name, c.first_name || ' ' || c.last_name, c.email) AS full_name
      FROM customer_referrals cr
      LEFT JOIN customers c ON c.id = cr.customer_id
      WHERE lower(cr.code) = lower(${code}) LIMIT 1
    `.execute(this.db as any).catch(() => ({ rows: [] }));
    const r = res.rows?.[0];
    return r ? { customerId: String(r.customer_id), customerName: r.full_name ?? null } : null;
  }

  async customerName(ctx: ReferralsContext, customerId: string): Promise<string | null> {
    const res: any = await sql`SELECT full_name FROM customers WHERE tenant_id = ${ctx.tenantId} AND id = ${customerId} LIMIT 1`.execute(this.db as any).catch(() => ({ rows: [] }));
    return res.rows?.[0]?.full_name ?? null;
  }

  async hasReferred(ctx: ReferralsContext, referredCustomerId: string): Promise<boolean> {
    const res: any = await sql`SELECT 1 FROM referral_redemptions WHERE tenant_id = ${ctx.tenantId} AND referred_customer_id = ${referredCustomerId} LIMIT 1`.execute(this.db as any).catch(() => ({ rows: [] }));
    return (res.rows?.length ?? 0) > 0;
  }

  async record(ctx: ReferralsContext, input: { referrerCustomerId: string; referrerName: string | null; referredCustomerId: string; referredName: string | null; code: string }): Promise<ReferralRedemption> {
    const res: any = await sql`
      INSERT INTO referral_redemptions (tenant_id, referrer_customer_id, referred_customer_id, code, status, reward_cents)
      VALUES (${ctx.tenantId}, ${input.referrerCustomerId}, ${input.referredCustomerId}, ${input.code}, 'pending', 0)
      RETURNING id, referrer_customer_id, referred_customer_id, code, status, reward_cents, redeemed_at, rewarded_at
    `.execute(this.db as any);
    const row = toDomain(res.rows[0]);
    return { ...row, referrerName: input.referrerName, referredName: input.referredName };
  }

  async markRewarded(ctx: ReferralsContext, id: string, rewardCents: number): Promise<ReferralRedemption | null> {
    const res: any = await sql`
      UPDATE referral_redemptions SET status = 'rewarded', reward_cents = ${rewardCents}, rewarded_at = now()
      WHERE tenant_id = ${ctx.tenantId} AND id = ${id} AND ${canMoveToSql(REFERRAL_REDEMPTION, 'rewarded')}
      RETURNING id, referrer_customer_id, referred_customer_id, code, status, reward_cents, redeemed_at, rewarded_at
    `.execute(this.db as any).catch(() => ({ rows: [] }));
    const row = res.rows?.[0];
    if (row) {
      if (rewardCents > 0) {
        // 1. Credit the referrer customer
        await sql`
          INSERT INTO customer_wallet_ledger (tenant_id, customer_id, amount_cents, entry_type, currency, reference, idempotency_key)
          VALUES (${ctx.tenantId}, ${row.referrer_customer_id}, ${rewardCents}, 'promo', 'USD', ${`Referral Reward (code: ${row.code})`}, ${`ref_reward_${row.id}`})
          ON CONFLICT (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
        `.execute(this.db as any).catch(() => {});

        // 2. Credit the new referred customer if not already credited
        if (row.referred_customer_id) {
          await sql`
            INSERT INTO customer_wallet_ledger (tenant_id, customer_id, amount_cents, entry_type, currency, reference, idempotency_key)
            VALUES (${ctx.tenantId}, ${row.referred_customer_id}, ${rewardCents}, 'promo', 'USD', ${`Referral Welcome Bonus (code: ${row.code})`}, ${`ref_welcome_${row.referred_customer_id}`})
            ON CONFLICT (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
          `.execute(this.db as any).catch(() => {});
        }
      }
      return toDomain(row);
    }
    return null;
  }
}
