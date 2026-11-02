import { describe, it, expect } from 'vitest';
import { InMemoryClassificationRepo } from './compensation-classification.repository';
import { ComplianceService, cleanWageConfig } from './compensation-compliance.service';

const ctx = { tenantId: 't1', branchId: null, userId: 'u1' };
const svc = () => new ComplianceService(new InMemoryClassificationRepo(), null); // null db → wage config defaults to 0

describe('ComplianceService', () => {
  it('sets and lists classifications', async () => {
    const s = svc();
    await s.setClassification(ctx, 'tech1', 'contractor');
    const list = await s.listClassifications(ctx);
    expect(list).toEqual([{ technicianId: 'tech1', classification: 'contractor', updatedAt: expect.any(String) }]);
  });

  it('rejects an invalid classification and a missing id', async () => {
    await expect(svc().setClassification(ctx, 'tech1', 'bogus')).rejects.toThrow(/employee, contractor, or booth_renter/);
    await expect(svc().setClassification(ctx, '', 'employee')).rejects.toThrow(/technicianId/);
  });

  it('wage config defaults to zero with no db', async () => {
    expect(await svc().getWageConfig(ctx)).toEqual({ minHourlyWageCents: 0, overtimeThresholdHours: 0 });
  });

  it('preview: an unclassified technician defaults to employee (most protective) and flags none when no minimum is set', async () => {
    const p = await svc().previewCompliance(ctx, { technicianId: 'tech1', periodPayCents: 30000, hoursWorked: 40 });
    expect(p.classification).toBe('employee');
    expect(p.classificationSet).toBe(false);
    expect(p.flags).toHaveLength(0); // min wage 0 (no db) → no wage flag
  });

  it('preview: a stored contractor never gets wage flags', async () => {
    const s = svc();
    await s.setClassification(ctx, 'tech1', 'contractor');
    const p = await s.previewCompliance(ctx, { technicianId: 'tech1', periodPayCents: 10000, hoursWorked: 40 });
    expect(p).toMatchObject({ classification: 'contractor', classificationSet: true });
    expect(p.flags).toHaveLength(0);
  });

  it('preview requires a technicianId', async () => {
    await expect(svc().previewCompliance(ctx, { periodPayCents: 1, hoursWorked: 1 })).rejects.toThrow(/technicianId/);
  });

  it('cleanWageConfig normalizes negatives to zero and rounds', async () => {
    expect(cleanWageConfig({ minHourlyWageCents: -5, overtimeThresholdHours: 40.4 })).toEqual({ minHourlyWageCents: 0, overtimeThresholdHours: 40 });
  });
});
