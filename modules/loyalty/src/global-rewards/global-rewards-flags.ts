// global-rewards-flags.ts — the network's feature flags (LoyaltyTokens.pdf §9.2, LoyaltyRules.pdf §7.1), evaluated on the
// SERVER with the tenant: the platform_settings boolean AND its platform_flag_rollouts decision for that salon (the
// same rolloutDecision the platform's PlatformFlagService uses). Every flag defaults OFF, and unlike the general
// platform flag reader this one FAILS CLOSED: an unreadable setting means "off" — a money path never turns itself on.
// Every feature also needs the engine flag: global_loyalty_engine_enabled is the master switch.
import { sql, type Kysely } from 'kysely';
import { rolloutDecision, type FlagRollout } from '@aipowersalon/config';
import { logException } from '@aipowersalon/observability';

export const GR_FLAGS = {
  engine: 'global_loyalty_engine_enabled',
  purchases: 'tenant_token_purchases_enabled',
  earn: 'global_loyalty_earn_enabled',
  redemption: 'global_loyalty_redemption_enabled',
  reimbursement: 'merchant_reimbursement_enabled',
  legacyMigration: 'legacy_loyalty_migration_enabled',
  customEarning: 'tenant_custom_earning_enabled',
} as const;
export type GrFlag = keyof typeof GR_FLAGS;
export type GrFlagState = Record<GrFlag, boolean>;

const truthy = (raw: unknown): boolean => raw === true || raw === 'true' || raw === 1 || raw === '1';
const ids = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? v.replace(/^\{|\}$/g, '').split(',').filter(Boolean) : []).map((x) => String(x).toLowerCase());

/** Every flag for one salon (tenantId null = platform-wide view). One round trip; any error → all OFF. */
export async function flagState(db: Kysely<any>, tenantId: string | null): Promise<GrFlagState> {
  const keys = Object.values(GR_FLAGS);
  const off: GrFlagState = { engine: false, purchases: false, earn: false, redemption: false, reimbursement: false, legacyMigration: false, customEarning: false };
  try {
    const s = await sql<{ setting_key: string; value: unknown }>`SELECT ps.setting_key, ps.value FROM platform_settings ps WHERE ps.setting_key = ANY(${keys}::text[])`.execute(db);
    const r = await sql<{ flag_key: string; rollout_percent: number; allow_tenant_ids: unknown; deny_tenant_ids: unknown; killed: boolean }>`
      SELECT fr.flag_key, fr.rollout_percent, fr.allow_tenant_ids, fr.deny_tenant_ids, fr.killed FROM platform_flag_rollouts fr WHERE fr.flag_key = ANY(${keys}::text[])`.execute(db);
    const val = new Map(s.rows.map((x) => [x.setting_key, truthy(x.value)]));
    const pol = new Map<string, FlagRollout>(r.rows.map((x) => [x.flag_key, { rolloutPercent: Number(x.rollout_percent), allowTenantIds: ids(x.allow_tenant_ids), denyTenantIds: ids(x.deny_tenant_ids), killed: x.killed === true }]));
    const on = (k: string) => val.get(k) === true && rolloutDecision(pol.get(k) ?? null, k, tenantId).on;
    const engine = on(GR_FLAGS.engine);
    const out = { ...off, engine };
    for (const [name, key] of Object.entries(GR_FLAGS) as [GrFlag, string][]) if (name !== 'engine') out[name] = engine && on(key);
    return out;
  } catch (e) {
    logException(e, { where: 'global-rewards.flags', tenantId });
    return off;
  }
}
