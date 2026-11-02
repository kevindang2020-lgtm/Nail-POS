import { describe, it, expect } from 'vitest';
import { SuperAdminReportBuilderService } from './super-admin-report-builder.service';
import { InMemorySuperAdminReportRepo } from './super-admin-report-builder.repository';
import { validateReportSpec } from './report-builder-catalog';

const ctx = { userId: 'u1', email: 'admin@aps.test' };

// Stub analytics payload exposing the modules the run() composes from.
const analyticsStub: any = {
  analytics: async () => ({
    modules: {
      revenueTransactionsTrend: { available: true, series: [{ label: '2026-04', revenueCents: 100, transactions: 10 }, { label: '2026-05', revenueCents: 300, transactions: 20 }] },
      paymentMethods: { available: true, byMethod: [{ method: 'card', cents: 500 }, { method: 'cash', cents: 900 }, { method: 'ach', cents: 100 }] },
      branchComparison: { available: true, rows: [{ branch: 'A', volumeCents: 200 }, { branch: 'B', volumeCents: 700 }] },
      topTenants: { available: true, rows: [{ tenantName: 'Glam', amountCents: 1000 }] },
      regionalPerformance: { available: true, byState: [{ state: 'NJ', tenants: 12 }] },
      peakHours: { available: true, byHour: Array.from({ length: 24 }, (_, h) => ({ hour: h, count: h })) },
      deviceStatus: { available: true, online: 40, offline: 6 },
    },
  }),
};
const newSvc = () => {
  const inserts: any[] = [];
  const db: any = { insertInto: () => ({ values: (v: any) => { inserts.push(v); return { execute: async () => {} }; } }) };
  return { svc: new SuperAdminReportBuilderService(new InMemorySuperAdminReportRepo(), analyticsStub, db), inserts };
};

describe('report-builder catalog validation', () => {
  it('rejects unknown dimension / measure / visualization', () => {
    expect(validateReportSpec({ dimension: 'galaxy', measure: 'revenue_cents' })).toMatchObject({ ok: false });
    expect(validateReportSpec({ dimension: 'branch', measure: 'unicorns' })).toMatchObject({ ok: false });
    expect(validateReportSpec({ dimension: 'branch', measure: 'revenue_cents', visualization: 'hologram' })).toMatchObject({ ok: false });
  });
  it('flags allow-listed-but-unmapped pairs as unsupported with a reason', () => {
    const v = validateReportSpec({ dimension: 'branch', measure: 'tenant_count' });
    expect(v.ok).toBe(true);
    expect((v as any).supported).toBe(false);
    expect((v as any).reason).toMatch(/not available/i);
  });
  it('clamps the row limit to [1,500]', () => {
    expect((validateReportSpec({ dimension: 'branch', measure: 'revenue_cents', limit: 9999 }) as any).spec.limit).toBe(500);
    expect((validateReportSpec({ dimension: 'branch', measure: 'revenue_cents', limit: -3 }) as any).spec.limit).toBe(1);
  });
});

describe('SuperAdminReportBuilderService.run', () => {
  it('composes payment_method × revenue from aggregates, sorted desc and limited', async () => {
    const { svc, inserts } = newSvc();
    const r: any = await svc.run(ctx, { dimension: 'payment_method', measure: 'revenue_cents', visualization: 'donut', limit: 2 });
    expect(r.available).toBe(true);
    expect(r.format).toBe('money');
    expect(r.rows.map((x: any) => x.label)).toEqual(['cash', 'card']); // 900, 500 (ach dropped by limit 2)
    expect(inserts.some((i) => i.action_type === 'report.run')).toBe(true);
  });
  it('keeps month dimension in chronological order', async () => {
    const { svc } = newSvc();
    const r: any = await svc.run(ctx, { dimension: 'month', measure: 'transactions', visualization: 'line' });
    expect(r.rows.map((x: any) => x.label)).toEqual(['2026-04', '2026-05']);
    expect(r.rows.map((x: any) => x.value)).toEqual([10, 20]);
  });
  it('returns available:false (not fabricated rows) for unsupported pairs', async () => {
    const { svc } = newSvc();
    const r: any = await svc.run(ctx, { dimension: 'device_status', measure: 'revenue_cents', visualization: 'table' });
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/not available/i);
  });
  it('throws on an invalid spec (→ 400 at the controller)', async () => {
    const { svc } = newSvc();
    await expect(svc.run(ctx, { dimension: 'nope', measure: 'revenue_cents' })).rejects.toThrow();
  });
});

describe('SuperAdminReportBuilderService saved definitions (CRUD)', () => {
  it('creates (validated + audited), lists, updates (re-validated), and deletes', async () => {
    const { svc, inserts } = newSvc();
    const created: any = await svc.create(ctx, { name: 'Top branches', dimension: 'branch', measure: 'revenue_cents', visualization: 'bar', range: '90d' });
    expect(created.id).toBeTruthy();
    expect(inserts.some((i) => i.action_type === 'report.save')).toBe(true);

    expect((await svc.list()).length).toBe(1);

    const updated: any = await svc.update(ctx, created.id, { name: 'Top branches v2', visualization: 'table' });
    expect(updated.name).toBe('Top branches v2');
    expect(updated.visualization).toBe('table');

    expect(await svc.remove(ctx, created.id)).toBe(true);
    expect((await svc.list()).length).toBe(0);
  });
  it('rejects creating a report with an invalid measure or empty name', async () => {
    const { svc } = newSvc();
    await expect(svc.create(ctx, { name: 'x', dimension: 'branch', measure: 'unicorns' })).rejects.toThrow();
    await expect(svc.create(ctx, { name: '  ', dimension: 'branch', measure: 'revenue_cents' })).rejects.toThrow(/name/i);
  });
});
