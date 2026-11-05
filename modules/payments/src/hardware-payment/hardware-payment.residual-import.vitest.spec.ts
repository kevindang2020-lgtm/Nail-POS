import { describe, it, expect, afterEach } from 'vitest';
import { FiservResidualImportService } from './hardware-payment.residual-import';
import { InMemoryHardwarePaymentRepository } from './hardware-payment.repository';

const URL = 'https://fiserv.example/residuals';
describe('Fiserv residual import (live pull)', () => {
  afterEach(() => { delete process.env.FISERV_RESIDUAL_URL; delete process.env.FISERV_RESIDUAL_AUTH; });

  it('no-ops cleanly when FISERV_RESIDUAL_URL is unset', async () => {
    const r = new FiservResidualImportService(new InMemoryHardwarePaymentRepository());
    expect(await r.importFromFiserv('2026-06')).toEqual({ imported: 0, configured: false, skipped: 0 });
  });

  it('fetches and lands rows with tolerant field mapping (cents and dollars)', async () => {
    process.env.FISERV_RESIDUAL_URL = URL;
    const svc = new FiservResidualImportService(new InMemoryHardwarePaymentRepository());
    const fetchMock = (async (u: string, init: any) => {
      expect(u).toContain('month=2026-06');
      return { ok: true, json: async () => ([{ tenantId: 'tA', cardVolumeCents: 5_000_000 }, { tenant_id: 'tB', cardVolume: 80_000 }, { tenantId: 'tC' }]) };
    }) as any;
    const out = await svc.importFromFiserv('2026-06', fetchMock);
    expect(out).toEqual({ imported: 2, configured: true, skipped: 1 }); // tC has no volume → skipped
    expect(await svc.getVolume('tA', '2026-06')).toBe(5_000_000);
    expect(await svc.getVolume('tB', '2026-06')).toBe(8_000_000); // dollars → cents
  });

  it('sends the Authorization header when FISERV_RESIDUAL_AUTH is set', async () => {
    process.env.FISERV_RESIDUAL_URL = URL; process.env.FISERV_RESIDUAL_AUTH = 'Bearer tok123';
    const svc = new FiservResidualImportService(new InMemoryHardwarePaymentRepository());
    let seen: any = null;
    const fetchMock = (async (_u: string, init: any) => { seen = init?.headers?.authorization; return { ok: true, json: async () => [] }; }) as any;
    await svc.importFromFiserv('2026-06', fetchMock);
    expect(seen).toBe('Bearer tok123');
  });

  it('throws on a non-ok response', async () => {
    process.env.FISERV_RESIDUAL_URL = URL;
    const svc = new FiservResidualImportService(new InMemoryHardwarePaymentRepository());
    const fetchMock = (async () => ({ ok: false, status: 503, json: async () => ({}) })) as any;
    await expect(svc.importFromFiserv('2026-06', fetchMock)).rejects.toThrow(/HTTP 503/);
  });
});
