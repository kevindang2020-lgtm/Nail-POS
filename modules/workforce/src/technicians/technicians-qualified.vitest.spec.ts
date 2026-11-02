// technicians-qualified.vitest.spec.ts — the "who is qualified for this service" lookup + enforcement helper that the
// Request-Help helper picker and skill search depend on. Eligibility is the canonical technician_services mapping.
import { describe, it, expect } from 'vitest';
import { TechniciansService } from './technicians.service';
import { InMemoryTechniciansRepository } from './technicians.repository';

const ctx = { tenantId: 'luxe001', branchId: '', userId: 'mgr', role: 'MANAGER', permissions: ['pos.technicians.view'] };
const svc = () => new TechniciansService(new InMemoryTechniciansRepository());

describe('technicians — qualified-for-service lookup + enforcement', () => {
  it('returns only technicians eligible for the requested service', async () => {
    expect((await svc().listQualified(ctx, 'svc_full_set')).map((t) => t.technicianId)).toEqual(['t_leo']);
  });
  it('a different service returns its own qualified set', async () => {
    expect((await svc().listQualified(ctx, 'svc_sig_mani')).map((t) => t.technicianId)).toEqual(['t_mia']);
  });
  it('a service nobody is mapped to returns empty', async () => {
    expect(await svc().listQualified(ctx, 'svc_nobody')).toEqual([]);
  });
  it('an empty serviceId returns empty (never the whole roster by accident)', async () => {
    expect(await svc().listQualified(ctx, '')).toEqual([]);
  });
  it('isQualified enforces per-service eligibility (backend-authoritative)', async () => {
    const s = svc();
    expect(await s.isQualified(ctx, 't_leo', 'svc_full_set')).toBe(true);
    expect(await s.isQualified(ctx, 't_mia', 'svc_full_set')).toBe(false);   // Mia isn't mapped to full sets
  });
  it('is tenant-isolated: another tenant sees no qualified technicians', async () => {
    expect(await svc().listQualified({ ...ctx, tenantId: 'other_tenant' }, 'svc_full_set')).toEqual([]);
  });
  it('requires the technicians.view permission', async () => {
    await expect(svc().listQualified({ ...ctx, permissions: [] }, 'svc_full_set')).rejects.toThrow();
  });
});
