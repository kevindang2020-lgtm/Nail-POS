/**
 * compensation-tier-plans.service.ts — authoring + preview for tiered plans (spec §2, §20). Validates the band ladder
 * with the same validator the engine uses, then creates/lists/archives. `preview` runs the REAL calculation for both
 * methods so the owner can compare entire-period vs marginal before saving (§20 requires the backend engine, not a
 * separate frontend formula).
 */
import { validateTiers, computeTieredCommission, type TierBand } from './compensation-tiered';
import type { TierPlansRepo, TierPlanCtx } from './compensation-tier-plans.repository';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export class TierPlansError extends Error {
  constructor(msg: string, public status = 400) { super(msg); this.name = 'TierPlansError'; }
}

function normalizeBands(b: any): TierBand[] {
  return Array.isArray(b) ? b.map((x: any) => ({ uptoCents: x?.uptoCents == null || x?.uptoCents === '' ? null : Math.round(Number(x.uptoCents)), ratePercent: Number(x?.ratePercent) })) : [];
}

export class TierPlansService {
  constructor(private readonly repo: TierPlansRepo) {}

  list(ctx: TierPlanCtx) { return this.repo.list(ctx); }

  async create(ctx: TierPlanCtx, body: any) {
    if (!body?.technicianId) throw new TierPlansError('technicianId is required');
    if (body.mode !== 'entire' && body.mode !== 'marginal') throw new TierPlansError('mode must be "entire" or "marginal"');
    const bands = normalizeBands(body.bands);
    const err = validateTiers(bands);
    if (err) throw new TierPlansError(err);
    return this.repo.create(ctx, { technicianId: body.technicianId, branchId: body.branchId ?? null, mode: body.mode, bands });
  }

  async archive(ctx: TierPlanCtx, id: string) {
    const ok = await this.repo.archive(ctx, id);
    if (!ok) throw withCode(new TierPlansError('Plan not found', 404), 'PLAN_NOT_FOUND');
    return { ok: true };
  }

  /** §20 preview: same engine as production, both methods side-by-side. */
  preview(body: any) {
    const bands = normalizeBands(body?.bands);
    const err = validateTiers(bands);
    if (err) throw new TierPlansError(err);
    const production = Math.max(0, Math.round(Number(body?.productionCents || 0)));
    return {
      productionCents: production,
      entire: computeTieredCommission(production, bands, 'entire'),
      marginal: computeTieredCommission(production, bands, 'marginal'),
    };
  }
}
