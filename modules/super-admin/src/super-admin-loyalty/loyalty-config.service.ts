// loyalty-config.service.ts — platform Loyalty CAPABILITY configuration for the Super Admin controls: points/reward
// limits, expiration rules, enabled program types, per-plan feature flags, and reusable default templates. Configures
// platform capabilities only — NEVER mutates tenant point balances, tiers, earn/redeem history, or redemptions.
// Every change is validated, clamped, and audit logged. Server-derives the actor; no client-trusted identity.
import { sql, type Kysely } from 'kysely';
import type { AdminCtx } from './loyalty-dashboard.service';

export interface LoyaltyConfig {
  limits: { maxPointsPerTxn: number; maxRedemptionPerTxn: number; minRedemptionThreshold: number; maxPointsPerDayPerMember: number };
  expiration: { enabled: boolean; pointExpiryDays: number; rewardValidityDays: number };
  programTypes: { points: boolean; tiered: boolean; visit_based: boolean; spend_based: boolean };
  planFeatures: Record<string, boolean>;
  valuation: { centsPerPoint: number };
}

export const DEFAULT_CONFIG: LoyaltyConfig = {
  limits: { maxPointsPerTxn: 5000, maxRedemptionPerTxn: 10000, minRedemptionThreshold: 100, maxPointsPerDayPerMember: 20000 },
  expiration: { enabled: false, pointExpiryDays: 365, rewardValidityDays: 90 },
  programTypes: { points: true, tiered: true, visit_based: false, spend_based: false },
  planFeatures: { starter: false, growth: true, pro: true, enterprise: true },
  valuation: { centsPerPoint: 1 },
};

const clampInt = (v: unknown, def: number, min: number, max: number): number => { const x = Math.trunc(Number(v)); return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : def; };
const asBool = (v: unknown, def: boolean): boolean => (typeof v === 'boolean' ? v : def);

/** Merge + validate a partial patch onto the current config. All numbers are clamped to safe ranges; unknown keys are
 *  dropped. Never returns out-of-range or negative values. Pure — used by both update and tests. */
export function mergeConfig(current: LoyaltyConfig, patch: any): LoyaltyConfig {
  const p = patch ?? {};
  const planFeatures: Record<string, boolean> = { ...current.planFeatures };
  if (p.planFeatures && typeof p.planFeatures === 'object') for (const [k, v] of Object.entries(p.planFeatures)) if (/^[a-z_]{1,32}$/.test(k)) planFeatures[k] = !!v;
  return {
    limits: {
      maxPointsPerTxn: clampInt(p.limits?.maxPointsPerTxn, current.limits.maxPointsPerTxn, 0, 1_000_000),
      maxRedemptionPerTxn: clampInt(p.limits?.maxRedemptionPerTxn, current.limits.maxRedemptionPerTxn, 0, 1_000_000),
      minRedemptionThreshold: clampInt(p.limits?.minRedemptionThreshold, current.limits.minRedemptionThreshold, 0, 1_000_000),
      maxPointsPerDayPerMember: clampInt(p.limits?.maxPointsPerDayPerMember, current.limits.maxPointsPerDayPerMember, 0, 10_000_000),
    },
    expiration: {
      enabled: asBool(p.expiration?.enabled, current.expiration.enabled),
      pointExpiryDays: clampInt(p.expiration?.pointExpiryDays, current.expiration.pointExpiryDays, 0, 3650),
      rewardValidityDays: clampInt(p.expiration?.rewardValidityDays, current.expiration.rewardValidityDays, 0, 3650),
    },
    programTypes: {
      points: asBool(p.programTypes?.points, current.programTypes.points),
      tiered: asBool(p.programTypes?.tiered, current.programTypes.tiered),
      visit_based: asBool(p.programTypes?.visit_based, current.programTypes.visit_based),
      spend_based: asBool(p.programTypes?.spend_based, current.programTypes.spend_based),
    },
    planFeatures,
    valuation: { centsPerPoint: clampInt(p.valuation?.centsPerPoint, current.valuation.centsPerPoint, 0, 10_000) },
  };
}

export class LoyaltyConfigService {
  constructor(private readonly db: Kysely<any> | null) {}

  private async audit(ctx: AdminCtx, action: string, meta: Record<string, unknown>): Promise<void> {
    if (!this.db) return;
    try {
      await sql`INSERT INTO audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
                VALUES (${null}, ${null}, ${ctx.userId ?? null}, 'super_admin', ${action}, 'loyalty_config', ${null}, ${JSON.stringify(meta)}::jsonb)`.execute(this.db);
    } catch { /* best-effort */ }
  }

  async getConfig(scope = 'platform'): Promise<LoyaltyConfig> {
    if (!this.db) return DEFAULT_CONFIG;
    const r = await sql<{ config: unknown }>`SELECT config FROM loyalty_platform_config WHERE scope = ${scope} LIMIT 1`.execute(this.db).catch(() => ({ rows: [] as any[] }));
    const stored = r.rows[0]?.config;
    const parsed = typeof stored === 'string' ? JSON.parse(stored) : stored;
    return mergeConfig(DEFAULT_CONFIG, parsed ?? {});   // defaults fill any missing keys
  }

  /** Validate + persist a config patch (upsert). Returns the effective config. Audits the changed sections. */
  async updateConfig(ctx: AdminCtx, patch: any, scope = 'platform'): Promise<{ ok: true; config: LoyaltyConfig }> {
    const current = await this.getConfig(scope);
    const next = mergeConfig(current, patch);
    if (this.db) {
      await sql`INSERT INTO loyalty_platform_config (scope, config, updated_by, updated_at)
                VALUES (${scope}, ${JSON.stringify(next)}::jsonb, ${ctx.userId ?? null}, now())
                ON CONFLICT (scope) DO UPDATE SET config = EXCLUDED.config, updated_by = EXCLUDED.updated_by, updated_at = now()`.execute(this.db);
    }
    await this.audit(ctx, 'loyalty_config.update', { scope, sections: Object.keys(patch ?? {}) });
    return { ok: true, config: next };
  }

  async listTemplates(): Promise<{ id: string; name: string; programType: string; active: boolean; createdAt: string }[]> {
    if (!this.db) return [];
    const r = await sql<any>`SELECT id, name, program_type, active, created_at FROM loyalty_templates WHERE active = true ORDER BY created_at DESC LIMIT 100`.execute(this.db).catch(() => ({ rows: [] as any[] }));
    return r.rows.map((x: any) => ({ id: String(x.id), name: String(x.name), programType: String(x.program_type), active: !!x.active, createdAt: new Date(x.created_at).toISOString() }));
  }

  async createTemplate(ctx: AdminCtx, input: { name?: string; programType?: string; structure?: unknown }): Promise<{ ok: boolean; error?: string; id?: string }> {
    if (!this.db) return { ok: false, error: 'unavailable' };
    const name = String(input.name ?? '').trim().slice(0, 120);
    if (!name) return { ok: false, error: 'name_required' };
    const type = ['points', 'tiered', 'visit_based', 'spend_based'].includes(String(input.programType)) ? String(input.programType) : 'points';
    const structure = input.structure && typeof input.structure === 'object' ? input.structure : {};
    const r = await sql<{ id: string }>`
      INSERT INTO loyalty_templates (name, program_type, structure_json, created_by)
      VALUES (${name}, ${type}, ${JSON.stringify(structure)}::jsonb, ${ctx.userId ?? null}) RETURNING id`.execute(this.db);
    const id = r.rows[0]?.id;
    await this.audit(ctx, 'loyalty_template.create', { name, programType: type, id: id ?? null });
    return { ok: true, id };
  }
}
