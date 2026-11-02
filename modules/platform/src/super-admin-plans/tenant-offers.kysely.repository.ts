// tenant-offers.kysely.repository.ts — real reads/writes for tenant add-on/trial/promotion assignment.
import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type {
  TenantOffersRepo, AddOnCatalog, TrialCatalog, PromoCatalog, AddOnAssignment, TrialStart, PromoApply, AuditActor,
} from './tenant-offers.repository';
import { canMoveToSql } from '@aipowersalon/database';
import { TENANT_ADD_ON } from '../platform-lifecycles';

export class KyselyTenantOffersRepo implements TenantOffersRepo {
  constructor(private readonly db: Kysely<DB>) {}

  async getAddOnByCode(code: string): Promise<AddOnCatalog | null> {
    const r: any = await sql`SELECT id, code, name, unit_price_cents FROM plan_add_ons WHERE code = ${code}`.execute(this.db).catch(() => ({ rows: [] }));
    const x = r.rows[0]; return x ? { id: String(x.id), code: String(x.code), name: String(x.name), unitPriceCents: Number(x.unit_price_cents) } : null;
  }
  async getTrialByCode(code: string): Promise<TrialCatalog | null> {
    const r: any = await sql`SELECT id, code, name, duration_days FROM trial_definitions WHERE code = ${code}`.execute(this.db).catch(() => ({ rows: [] }));
    const x = r.rows[0]; return x ? { id: String(x.id), code: String(x.code), name: String(x.name), durationDays: Number(x.duration_days) } : null;
  }
  async getPromoByCode(code: string): Promise<PromoCatalog | null> {
    const r: any = await sql`SELECT id, code, name, status, per_tenant_limit, max_redemptions FROM promotions WHERE code = ${code}`.execute(this.db).catch(() => ({ rows: [] }));
    const x = r.rows[0]; return x ? { id: String(x.id), code: String(x.code), name: String(x.name), status: String(x.status), perTenantLimit: Number(x.per_tenant_limit), maxRedemptions: x.max_redemptions == null ? null : Number(x.max_redemptions) } : null;
  }

  async upsertAddOn(a: AddOnAssignment): Promise<void> {
    await sql`INSERT INTO tenant_add_ons (tenant_id, add_on_id, quantity, price_cents, status, started_at)
              VALUES (${a.tenantId}, ${a.addOnId}, ${a.quantity}, ${a.priceCents}, 'active', now())
              ON CONFLICT (tenant_id, add_on_id) DO UPDATE SET
                quantity = EXCLUDED.quantity, price_cents = EXCLUDED.price_cents, status = 'active',
                started_at = now(), cancelled_at = NULL, updated_at = now()
              WHERE ${canMoveToSql(TENANT_ADD_ON, 'active', 'tenant_add_ons')}`.execute(this.db);
  }
  async cancelAddOn(tenantId: string, addOnId: string): Promise<number> {
    const r: any = await sql`UPDATE tenant_add_ons SET status = 'cancelled', cancelled_at = now(), updated_at = now()
                             WHERE tenant_id = ${tenantId} AND add_on_id = ${addOnId} AND status = 'active' AND ${canMoveToSql(TENANT_ADD_ON, 'cancelled')}`.execute(this.db);
    return Number(r.numAffectedRows ?? r.numUpdatedRows ?? 0);
  }
  async startTrial(t: TrialStart): Promise<string> {
    const r: any = await sql`INSERT INTO tenant_trials (tenant_id, trial_definition_id, started_at, ends_at, status)
                             VALUES (${t.tenantId}, ${t.trialDefinitionId}, now(), now() + (${t.durationDays} || ' days')::interval, 'active')
                             RETURNING id`.execute(this.db);
    return String(r.rows[0].id);
  }
  async countTenantPromoRedemptions(tenantId: string, promotionId: string): Promise<number> {
    const r: any = await sql`SELECT COUNT(*)::int AS n FROM promotion_redemptions WHERE tenant_id = ${tenantId} AND promotion_id = ${promotionId} AND status = 'active'`.execute(this.db);
    return Number(r.rows[0]?.n ?? 0);
  }
  async countTotalPromoRedemptions(promotionId: string): Promise<number> {
    const r: any = await sql`SELECT COUNT(*)::int AS n FROM promotion_redemptions WHERE promotion_id = ${promotionId} AND status = 'active'`.execute(this.db);
    return Number(r.rows[0]?.n ?? 0);
  }
  async applyPromo(p: PromoApply): Promise<string> {
    const r: any = await sql`INSERT INTO promotion_redemptions (promotion_id, tenant_id, redeemed_at, status)
                             VALUES (${p.promotionId}, ${p.tenantId}, now(), 'active') RETURNING id`.execute(this.db);
    return String(r.rows[0].id);
  }
  async writeAudit(actor: AuditActor, action: string, entityId: string, meta: Record<string, unknown>): Promise<void> {
    await (this.db as any).insertInto('audit_logs').values({
      id: sql`gen_random_uuid()`, tenant_id: entityId, user_id: actor.userId ?? null, role: 'SUPER_ADMIN',
      action_type: action, entity_type: 'tenant_offer', entity_id: entityId, metadata_json: JSON.stringify(meta),
    }).execute().catch(() => {});
  }
}
