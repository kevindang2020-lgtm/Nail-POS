// ai-price-table.ts — AI Usage Limits 07 (extras round 11): the Super Admin AI PRICE TABLE (migration 971), as a MECHANISM.
// The table starts EMPTY and nothing is seeded: with no published version every salon's AI Usage card says "no price set"
// and today's price source (the salon's stored subscription price, else the code catalog list price) is unchanged — the
// table is shown beside it, never used to bill.
//
// Resolution for one salon × feature (AI package code) × unit (month / year / overage_unit), at a moment:
//   1. a per-salon OVERRIDE in effect (newest effective_from, then newest row) with a price wins; a NULL-price row removes it
//   2. else the CURRENT version = the newest version in effect (effective_from ≤ now). Each version is a whole table: a
//      feature missing from it has no table price
//   3. "existing salons keep their previous price" — walking back from the current version, while that version says keep
//      AND the salon subscribed before it took effect, the salon stays on the version before it
//   4. a version published for a future date is returned as `upcoming` (Price Change Transparency: shown before it applies)
// Super Admin publishing: existing_salons_keep_previous is REQUIRED (no default — Kevin decides per version); prices are
// integer cents within a hard safety ceiling; versions and overrides are append-only and audited.
import { recordPlatformAuditStrict } from '@aipowersalon/audit';
import { sql, type Kysely } from 'kysely';
import { getAiPackage } from '@aipowersalon/ai';
import type { AiTablePrice, AiPriceUnit } from '@aipowersalon/api-contracts/tenant';
import type { AiPriceTableResponse, AiPriceVersionView, AiPriceOverrideView } from '@aipowersalon/api-contracts/platform';

export const AI_PRICE_UNITS = ['month', 'year', 'overage_unit'] as const;
/** hard safety ceiling for one table price (cents) — a typo guard, not a business price ($10,000.00) */
export const AI_PRICE_CEILING_CENTS = 1_000_000;
export const AI_PRICE_MAX_ROWS = 200;

export interface PriceVersionFact { versionNo: number; effectiveFrom: Date; keepPrevious: boolean; rows: Map<string, number> }
export interface PriceOverrideFact { feature: string; unit: string; priceCents: number | null; effectiveFrom: Date; createdAt: Date }
const rowKey = (feature: string, unit: string) => `${feature}|${unit}`;

/** pure: the table price for one salon × feature × unit (see the header) */
export function resolveAiTablePrice(versions: PriceVersionFact[], overrides: PriceOverrideFact[], feature: string, unit: AiPriceUnit, subscribedAt: Date | null, now: Date): AiTablePrice {
  const sorted = [...versions].sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime() || a.versionNo - b.versionNo);
  const inEffect = sorted.filter((v) => v.effectiveFrom.getTime() <= now.getTime());
  const next = sorted.find((v) => v.effectiveFrom.getTime() > now.getTime()) ?? null;
  const upcoming = next ? { versionNo: next.versionNo, effectiveFrom: next.effectiveFrom.toISOString(), priceCents: next.rows.get(rowKey(feature, unit)) ?? null, existingSalonsKeepPrevious: next.keepPrevious } : null;
  const ov = overrides.filter((o) => o.feature === feature && o.unit === unit && o.effectiveFrom.getTime() <= now.getTime())
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime() || b.createdAt.getTime() - a.createdAt.getTime())[0];
  const current = inEffect.length ? inEffect[inEffect.length - 1] : null;
  if (ov && ov.priceCents != null) {
    return { state: 'set', unit, priceCents: ov.priceCents, source: 'salon_override', versionNo: null, effectiveFrom: ov.effectiveFrom.toISOString(), keptPrevious: false, currentVersionNo: current?.versionNo ?? null, upcoming };
  }
  if (!current) return { state: 'no_price_set', unit, reason: 'no_version_published', currentVersionNo: null, upcoming };
  let i = inEffect.length - 1;
  while (i > 0 && inEffect[i].keepPrevious && subscribedAt != null && subscribedAt.getTime() < inEffect[i].effectiveFrom.getTime()) i -= 1;
  const used = inEffect[i];
  const kept = used !== current;
  // a salon that subscribed before even the FIRST version, with that version saying "keep previous": there was no table price before
  if (i === 0 && used.keepPrevious && subscribedAt != null && subscribedAt.getTime() < used.effectiveFrom.getTime()) {
    return { state: 'no_price_set', unit, reason: 'kept_previous_none', currentVersionNo: current.versionNo, upcoming };
  }
  const price = used.rows.get(rowKey(feature, unit));
  if (price == null) return { state: 'no_price_set', unit, reason: 'not_in_version', currentVersionNo: current.versionNo, upcoming };
  return { state: 'set', unit, priceCents: price, source: 'version', versionNo: used.versionNo, effectiveFrom: used.effectiveFrom.toISOString(), keptPrevious: kept, currentVersionNo: current.versionNo, upcoming };
}

export class AiPriceTableError extends Error {
  constructor(message: string, readonly code: 'AI_PRICE_INVALID' | 'AI_PRICE_KEEP_PREVIOUS_REQUIRED' | 'AI_PRICE_EFFECTIVE_PAST' | 'AI_PACKAGE_NOT_FOUND' | 'TENANT_NOT_FOUND', readonly status: 400 | 404 = 400) { super(message); this.name = 'AiPriceTableError'; }
}
const N = (v: unknown) => Number(v ?? 0) || 0;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cents = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= AI_PRICE_CEILING_CENTS ? v : null);
/** a scheduled change may be dated a little in the past (clock skew) — never back-dated further */
const SKEW_MS = 5 * 60_000;

/** reads (any salon) + Super Admin writes of the price table. Every write is append-only and audited in the same transaction. */
export class AiPriceTable {
  constructor(private readonly db: Kysely<any>, private readonly now: () => Date = () => new Date()) {}

  /** the facts for resolveAiTablePrice: every published version (with rows) and this salon's overrides */
  async facts(tenantId: string | null): Promise<{ versions: PriceVersionFact[]; overrides: PriceOverrideFact[] }> {
    const v = (await sql<{ id: string; version_no: number; effective_from: Date | string; existing_salons_keep_previous: boolean }>`select v.id, v.version_no, v.effective_from, v.existing_salons_keep_previous
      from platform_ai_price_versions v order by v.effective_from, v.version_no`.execute(this.db)).rows;
    const rows = v.length ? (await sql<{ version_id: string; feature: string; unit: string; price_cents: number }>`select r.version_id, r.feature, r.unit, r.price_cents from platform_ai_price_version_rows r`.execute(this.db)).rows : [];
    const byVersion = new Map<string, Map<string, number>>();
    for (const r of rows) { const m = byVersion.get(String(r.version_id)) ?? new Map<string, number>(); m.set(rowKey(r.feature, r.unit), N(r.price_cents)); byVersion.set(String(r.version_id), m); }
    const versions = v.map((x) => ({ versionNo: N(x.version_no), effectiveFrom: new Date(x.effective_from), keepPrevious: !!x.existing_salons_keep_previous, rows: byVersion.get(String(x.id)) ?? new Map<string, number>() }));
    const overrides = tenantId ? (await sql<{ feature: string; unit: string; price_cents: number | null; effective_from: Date | string; created_at: Date | string }>`select o.feature, o.unit, o.price_cents, o.effective_from, o.created_at
      from tenant_ai_price_overrides o where o.tenant_id = ${tenantId}`.execute(this.db)).rows.map((o) => ({ feature: o.feature, unit: o.unit, priceCents: o.price_cents == null ? null : N(o.price_cents), effectiveFrom: new Date(o.effective_from), createdAt: new Date(o.created_at) })) : [];
    return { versions, overrides };
  }

  /** Super Admin: the whole table — every version (newest first) and the overrides (newest first, at most 500) */
  async list(): Promise<AiPriceTableResponse> {
    const v = (await sql<{ id: string; version_no: number; effective_from: Date | string; existing_salons_keep_previous: boolean; note: string | null; published_at: Date | string }>`select v.id, v.version_no, v.effective_from,
        v.existing_salons_keep_previous, v.note, v.published_at from platform_ai_price_versions v order by v.version_no desc`.execute(this.db)).rows;
    const rows = v.length ? (await sql<{ version_id: string; feature: string; unit: string; price_cents: number }>`select r.version_id, r.feature, r.unit, r.price_cents from platform_ai_price_version_rows r order by r.feature, r.unit`.execute(this.db)).rows : [];
    const now = this.now().getTime();
    const versions: AiPriceVersionView[] = v.map((x) => ({ versionNo: N(x.version_no), effectiveFrom: new Date(x.effective_from).toISOString(), existingSalonsKeepPrevious: !!x.existing_salons_keep_previous,
      note: x.note ?? null, publishedAt: new Date(x.published_at).toISOString(), inEffect: new Date(x.effective_from).getTime() <= now,
      rows: rows.filter((r) => String(r.version_id) === String(x.id)).map((r) => ({ feature: r.feature, unit: r.unit as AiPriceUnit, priceCents: N(r.price_cents) })) }));
    const o = (await sql<{ tenant_id: string; display_name: string | null; feature: string; unit: string; price_cents: number | null; effective_from: Date | string; reason: string; created_at: Date | string }>`select o.tenant_id, t.display_name,
        o.feature, o.unit, o.price_cents, o.effective_from, o.reason, o.created_at from tenant_ai_price_overrides o left join tenants t on t.id = o.tenant_id order by o.created_at desc limit 500`.execute(this.db)).rows;
    const overrides: AiPriceOverrideView[] = o.map((x) => ({ tenantId: String(x.tenant_id), salon: x.display_name ?? null, feature: x.feature, unit: x.unit as AiPriceUnit, priceCents: x.price_cents == null ? null : N(x.price_cents),
      effectiveFrom: new Date(x.effective_from).toISOString(), reason: x.reason, createdAt: new Date(x.created_at).toISOString() }));
    return { versions, overrides, empty: versions.length === 0, ceilingCents: AI_PRICE_CEILING_CENTS };
  }

  /** Super Admin: publish a new version. existingSalonsKeepPrevious MUST be stated (true or false) — there is no default. */
  async publish(actor: { userId?: string | null }, b: { effectiveFrom?: unknown; existingSalonsKeepPrevious?: unknown; note?: unknown; rows?: unknown }): Promise<AiPriceVersionView> {
    if (typeof b.existingSalonsKeepPrevious !== 'boolean') throw new AiPriceTableError('Say whether existing salons keep their previous price for this version.', 'AI_PRICE_KEEP_PREVIOUS_REQUIRED');
    const eff = typeof b.effectiveFrom === 'string' ? new Date(b.effectiveFrom) : null;
    if (!eff || Number.isNaN(eff.getTime())) throw new AiPriceTableError('Choose when this version takes effect.', 'AI_PRICE_INVALID');
    if (eff.getTime() < this.now().getTime() - SKEW_MS) throw new AiPriceTableError('A price version cannot take effect in the past.', 'AI_PRICE_EFFECTIVE_PAST');
    const list = Array.isArray(b.rows) ? b.rows : [];
    if (list.length === 0 || list.length > AI_PRICE_MAX_ROWS) throw new AiPriceTableError(`A version needs 1 to ${AI_PRICE_MAX_ROWS} prices.`, 'AI_PRICE_INVALID');
    const seen = new Set<string>(); const rows: { feature: string; unit: AiPriceUnit; priceCents: number }[] = [];
    for (const r of list as Array<Record<string, unknown>>) {
      const feature = String(r?.feature ?? ''); const unit = String(r?.unit ?? ''); const p = cents(r?.priceCents);
      if (!getAiPackage(feature)) throw new AiPriceTableError(`Unknown AI package: ${feature.slice(0, 60)}.`, 'AI_PACKAGE_NOT_FOUND');
      if (!(AI_PRICE_UNITS as readonly string[]).includes(unit)) throw new AiPriceTableError('Unit must be month, year or overage_unit.', 'AI_PRICE_INVALID');
      if (p == null) throw new AiPriceTableError(`Prices are whole cents from 0 to ${AI_PRICE_CEILING_CENTS}.`, 'AI_PRICE_INVALID');
      if (seen.has(rowKey(feature, unit))) throw new AiPriceTableError('Each package and unit appears once in a version.', 'AI_PRICE_INVALID');
      seen.add(rowKey(feature, unit)); rows.push({ feature, unit: unit as AiPriceUnit, priceCents: p });
    }
    const note = b.note == null || String(b.note).trim() === '' ? null : String(b.note).trim().slice(0, 500);
    const by = actor.userId && UUID.test(actor.userId) ? actor.userId : null;
    return this.db.transaction().execute(async (trx) => {
      await sql`lock table platform_ai_price_versions in share row exclusive mode`.execute(trx);
      const no = N((await sql<{ n: number }>`select coalesce(max(v.version_no), 0)::int + 1 as n from platform_ai_price_versions v`.execute(trx)).rows[0]?.n) || 1;
      const v = (await sql<{ id: string; published_at: Date | string }>`insert into platform_ai_price_versions (version_no, effective_from, existing_salons_keep_previous, note, published_by)
        values (${no}, ${eff.toISOString()}, ${b.existingSalonsKeepPrevious as boolean}, ${note}, ${by}) returning id, published_at`.execute(trx)).rows[0];
      for (const r of rows) await sql`insert into platform_ai_price_version_rows (version_id, feature, unit, price_cents) values (${v.id}, ${r.feature}, ${r.unit}, ${r.priceCents})`.execute(trx);
      await recordPlatformAuditStrict(trx, { userId: by, role: 'SUPER_ADMIN' }, { module: 'super_admin', action: 'ai_price_version_published', resourceType: 'platform_ai_price_version', resourceId: v.id,
        metadata: { versionNo: no, effectiveFrom: eff.toISOString(), existingSalonsKeepPrevious: b.existingSalonsKeepPrevious, rows } });   // fail-closed: no audit row, no version
      return { versionNo: no, effectiveFrom: eff.toISOString(), existingSalonsKeepPrevious: b.existingSalonsKeepPrevious as boolean, note, publishedAt: new Date(v.published_at).toISOString(), inEffect: eff.getTime() <= this.now().getTime(), rows };
    });
  }

  /** Super Admin: set (or with priceCents null, remove) one salon's price for a feature × unit — a new append-only row, audited */
  async setOverride(actor: { userId?: string | null }, b: { tenantId?: unknown; feature?: unknown; unit?: unknown; priceCents?: unknown; effectiveFrom?: unknown; reason?: unknown }): Promise<AiPriceOverrideView> {
    const tenantId = String(b.tenantId ?? ''); const feature = String(b.feature ?? ''); const unit = String(b.unit ?? '');
    if (!UUID.test(tenantId)) throw new AiPriceTableError('Unknown salon.', 'TENANT_NOT_FOUND', 404);
    if (!getAiPackage(feature)) throw new AiPriceTableError('Unknown AI package.', 'AI_PACKAGE_NOT_FOUND', 404);
    if (!(AI_PRICE_UNITS as readonly string[]).includes(unit)) throw new AiPriceTableError('Unit must be month, year or overage_unit.', 'AI_PRICE_INVALID');
    const price = b.priceCents === null ? null : cents(b.priceCents);
    if (b.priceCents !== null && price == null) throw new AiPriceTableError(`Prices are whole cents from 0 to ${AI_PRICE_CEILING_CENTS}.`, 'AI_PRICE_INVALID');
    const reason = String(b.reason ?? '').trim();
    if (reason.length < 3 || reason.length > 500) throw new AiPriceTableError('Give a reason (3 to 500 characters).', 'AI_PRICE_INVALID');
    const eff = b.effectiveFrom == null || b.effectiveFrom === '' ? this.now() : new Date(String(b.effectiveFrom));
    if (Number.isNaN(eff.getTime())) throw new AiPriceTableError('Choose when the salon price takes effect.', 'AI_PRICE_INVALID');
    if (eff.getTime() < this.now().getTime() - SKEW_MS) throw new AiPriceTableError('A salon price cannot take effect in the past.', 'AI_PRICE_EFFECTIVE_PAST');
    const t = (await sql<{ display_name: string | null }>`select t.display_name from tenants t where t.id = ${tenantId}`.execute(this.db)).rows[0];
    if (!t) throw new AiPriceTableError('Unknown salon.', 'TENANT_NOT_FOUND', 404);
    const by = actor.userId && UUID.test(actor.userId) ? actor.userId : null;
    return this.db.transaction().execute(async (trx) => {
      const r = (await sql<{ id: string; created_at: Date | string }>`insert into tenant_ai_price_overrides (tenant_id, feature, unit, price_cents, effective_from, reason, set_by)
        values (${tenantId}, ${feature}, ${unit}, ${price}, ${eff.toISOString()}, ${reason}, ${by}) returning id, created_at`.execute(trx)).rows[0];
      await recordPlatformAuditStrict(trx, { userId: by, role: 'SUPER_ADMIN' }, { module: 'super_admin', action: price == null ? 'ai_price_override_removed' : 'ai_price_override_set', resourceType: 'tenant_ai_price_override', resourceId: r.id,
        metadata: { tenantId, feature, unit, priceCents: price, effectiveFrom: eff.toISOString(), reason } });   // fail-closed
      return { tenantId, salon: t.display_name ?? null, feature, unit: unit as AiPriceUnit, priceCents: price, effectiveFrom: eff.toISOString(), reason, createdAt: new Date(r.created_at).toISOString() };
    });
  }
}
