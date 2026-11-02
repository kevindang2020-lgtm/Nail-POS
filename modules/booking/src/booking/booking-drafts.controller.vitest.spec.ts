// booking-drafts.controller.vitest.spec — B-22 regression (Oct 22 2026, sixth full run): the controller declared its
// repository as `KyselyBookingDraftRepo | null`; tsc erases that union to Object in the emitted constructor metadata,
// Nest could not resolve it, and the COMPILED API refused to boot (the harness lane caught it — no unit test did, because
// vitest emits no design-type metadata). The dependency is now injected by its CLASS token, @Optional; the token is
// written by @Inject itself, so it is visible here — remove @Inject and the first test fails.
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { BookingDraftsController } from './booking-drafts.controller';
import { KyselyBookingDraftRepo } from './booking-drafts';

describe('BookingDraftsController is resolvable by Nest (the compiled API boots)', () => {
  it('the constructor injects the repository by its CLASS token (never the erased Object), and it is optional', () => {
    const self: any[] = Reflect.getMetadata('self:paramtypes', BookingDraftsController) ?? [];
    expect(self.find((p) => p.index === 0)?.param).toBe(KyselyBookingDraftRepo);
    const optional: number[] = Reflect.getMetadata('optional:paramtypes', BookingDraftsController) ?? [];
    expect(optional).toContain(0);
  });
  it('with NO repository (no database) every route answers 503 DRAFTS_UNAVAILABLE — the app still boots', async () => {
    const c = new BookingDraftsController(null);
    const r = { ctx: { tenantId: 't', branchId: 'b', userId: 'u', role: 'FRONT_DESK', permissions: [] } };
    await expect(c.list(r)).rejects.toMatchObject({ status: 503 });
    await expect(c.save(r, { payload: {} })).rejects.toMatchObject({ status: 503 });
  });
});
