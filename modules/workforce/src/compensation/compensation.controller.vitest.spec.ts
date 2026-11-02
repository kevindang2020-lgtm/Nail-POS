// compensation.controller.vitest.spec.ts — owner preview/validate endpoints (§27/§28): gating, engine preview,
// guarantee preview, validation. Pure-compute (no DB).
import { describe, it, expect } from 'vitest';
import { CompensationController } from './compensation.controller';
import { CompensationPreviewService } from './compensation-preview.service';
import { CompensationReportsService, type ReportsPort } from './compensation-reports.service';
import { ForbiddenException } from '@nestjs/common';

// Phase 9: an owner's session carries the compensation keys (OWNER holds every tenant key); the role alone opens nothing.
const owner = { ctx: { tenantId: 't1', userId: 'u1', role: 'OWNER', permissions: ['compensation.view_all', 'compensation.manage'] } };
const tech = { ctx: { tenantId: 't1', userId: 'u2', role: 'TECHNICIAN', permissions: [] } };
const reportRows = [{ technicianId: 'a', branchId: 'b1', serviceId: 'gel', day: '2026-06-25', grossPriceCents: 10000, discountCents: 0, supplyCents: 1000, commissionableCents: 9000, techServiceEarningsCents: 5400, salonServiceShareCents: 3600, retailCommissionCents: 0 }];
const reportsPort: ReportsPort = { reportRows: async () => reportRows as any, tipReport: async () => [] };
const ctrl = () => new CompensationController(new CompensationPreviewService(), new CompensationReportsService(reportsPort));

describe('owner compensation preview/validate API (§27/§28)', () => {
  it('gates non-owner without permission (§30)', () => {
    expect(() => ctrl().preview(tech, {})).toThrow(ForbiddenException);
  });

  it('Phase 9: the OWNER role shortcut is gone — the keys decide; view_all reads but never writes', () => {
    const bareOwner = { ctx: { tenantId: 't1', userId: 'u1', role: 'OWNER', permissions: [] } };
    expect(() => ctrl().preview(bareOwner, {})).toThrow(ForbiddenException);
    const reader = { ctx: { tenantId: 't1', userId: 'u3', role: 'MANAGER', permissions: ['compensation.view_all'] } };
    expect(ctrl().validate(reader, { rule: { technicianPercent: 60, salonPercent: 40, commission: { type: 'percent', value: 60 } } }).ok).toBe(true);
    expect(() => ctrl().retailPolicySet(reader, {})).toThrow(ForbiddenException);
    expect(() => ctrl().tipPolicySet(reader, {})).toThrow(ForbiddenException);
  });

  // w4 sweep SW-03: POST /owner/compensation/preview with no serviceLines crashed the engine (TypeError → 500)
  it('a preview without serviceLines is a 400, not a crash', () => {
    let status = 0;
    try { ctrl().preview(owner, {}); } catch (e: any) { status = typeof e?.getStatus === 'function' ? e.getStatus() : -1; }
    expect(status).toBe(400);
  });

  it('§28 preview returns the full engine breakdown', () => {
    const r = ctrl().preview(owner, { tenantId: 't1', branchId: 'b1', ticketId: 'preview',
      serviceLines: [{ lineId: 'L1', priceCents: 10000, taxCents: 600, supply: { method: 'fixed', value: 1000 }, commission: { type: 'percent', value: 60 }, technicians: [{ technicianId: 'a', method: 'equal' }] }],
      tip: { method: 'equal', cardTipCents: 2000 } });
    expect(r.totals.commissionableCents).toBe(9000);
    expect(r.totals.techServiceEarningsCents).toBe(5400);
    expect(r.salonTipCents).toBe(0);
    expect(r.reconciliation.splitsReconcile).toBe(true);
  });

  it('supply preview resolves tiered config', () => {
    const r = ctrl().supplyPreview(owner, { config: { method: 'tiered', tiers: [{ uptoCents: 5000, chargeCents: 500 }, { uptoCents: null, chargeCents: 1500 }] }, priceCents: 8000 });
    expect(r.supplyCents).toBe(1500);
    expect(r.validation.errors).toHaveLength(0);
  });

  it('§28 guarantee preview returns the top-up', () => {
    const r = ctrl().guaranteePreview(owner, { policy: { period: 'day', guaranteedCents: 18000, proration: 'none', type: 'nonrecoverable' }, facts: { clockedIn: true }, earnings: { serviceCommissionCents: 14000, cardTipCents: 6000 } });
    expect(r.salonCoverTopUpCents).toBe(4000);
    expect(r.totalBeforeOtherPayrollItemsCents).toBe(24000);
  });

  it('§27 validate flags a bad split + over-supply', () => {
    const r = ctrl().validate(owner, { rule: { technicianPercent: 70, salonPercent: 40 }, supply: { method: 'percent', percent: 130 } });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e: string) => /total 100/.test(e))).toBe(true);
    expect(r.errors.some((e: string) => /0–100/.test(e))).toBe(true);
  });

  it('§27 validate passes a clean policy', () => {
    expect(ctrl().validate(owner, { rule: { technicianPercent: 60, salonPercent: 40, commission: { type: 'percent', value: 60 } } }).ok).toBe(true);
  });

  it('§34 commission report is owner-gated and reconciles', async () => {
    const rep = await ctrl().reportCommission(owner, {});
    expect(rep!.totals.commissionableCents).toBe(9000);
    expect(rep!.reconciles).toBe(true);
  });

  it('SW-04 (wave 4 sweep): the platform oversight route under /owner is gone — no role could reach it (an owner is not a Super Admin, a Super Admin cannot enter /owner) and nothing called it', () => {
    expect((CompensationController.prototype as any).reportPlatform).toBeUndefined();
    expect((CompensationReportsService.prototype as any).platform).toBeUndefined();
  });
});
