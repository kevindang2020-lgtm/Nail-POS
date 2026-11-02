// connect-google-400 — Security Deep Scan §163 run 3 (Oct 27 2026): POST /pos/settings/online-google-ai-booking/connect-google
// answered 500 for a link that is not a URL (a plain Error). The refusal is now an exposed client error (status 400,
// code VALIDATION_FAILED) that the controller passes to the platform filter unchanged.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { PosSettingsController } from './settings.controller';
import { BookingIntegrationsService } from './settings.integrations';

const ctx = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: [] } as any;
describe('§163 run 3 — connect-google', () => {
  it('a link that is not a URL is an exposed 400 VALIDATION_FAILED; a real link connects', () => {
    const b = new BookingIntegrationsService();
    for (const bad of ["' OR '1'='1", '<script>alert(1)</script>', 42 as any, undefined as any]) {
      let e: any; try { b.connectGoogle(ctx, bad); } catch (x) { e = x; }
      expect(e, String(bad)).toMatchObject({ status: 400, code: 'VALIDATION_FAILED', expose: true, details: { field: 'link' } });
    }
    expect(b.connectGoogle(ctx, 'https://reserve.example/salon').googleReserveConnected).toBe(true);
  });
  it('the controller passes the async refusal through unchanged (the filter answers it 400, not 500)', async () => {
    const b = new BookingIntegrationsService();
    const ctl = new PosSettingsController({ connectGoogle: async (c: any, link: string) => b.connectGoogle(c, link) } as any);
    await expect(ctl.bkConnect({ ctx }, { link: "' OR '1'='1" })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED', expose: true });
  });
});
