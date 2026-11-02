import { describe, it, expect, vi } from 'vitest';
import { NailPhotoConsentService } from './nail-photo-consent.service';
import type { NailPhotoConsentPort, MyConsentedPhoto } from './nail-photo-consent.service';

const ctx = (over: any = {}) => ({ tenantId: 't1', branchId: 'b1', userId: 'u_cust', role: 'CUSTOMER', permissions: [], ...over } as any);

function makePort(over: Partial<NailPhotoConsentPort> = {}): NailPhotoConsentPort {
  return {
    resolveCustomerRecordId: async () => 'cust_rec_1',
    listConsentedPhotos: async () => [],
    activeConsentExists: async () => true,
    withdrawConsent: async () => { /* */ },
    writeAudit: async () => { /* */ },
    ...over,
  };
}

describe('Customer photo-consent withdrawal — data-subject authorization', () => {
  it('lists nothing when the signed-in user is not linked to a salon customer record', async () => {
    const svc = new NailPhotoConsentService(makePort({ resolveCustomerRecordId: async () => null }));
    expect((await svc.listMine(ctx())).photos).toEqual([]);
  });

  it('returns the customer’s own consented photos', async () => {
    const photos: MyConsentedPhoto[] = [{ photoId: 'p1', imageUrl: '/p1.jpg', thumbnailUrl: '/p1t.jpg', caption: null, approvedUses: ['portfolio'], publicBlocked: false, consentedAt: '2026-06-01T00:00:00.000Z' }];
    const svc = new NailPhotoConsentService(makePort({ listConsentedPhotos: async () => photos }));
    expect((await svc.listMine(ctx())).photos).toHaveLength(1);
  });

  it('withdraws consent for a photo the customer owns (revoke + audit)', async () => {
    const withdraw = vi.fn(async () => { /* */ });
    const audit = vi.fn(async () => { /* */ });
    const svc = new NailPhotoConsentService(makePort({ withdrawConsent: withdraw, writeAudit: audit }));
    const out = await svc.withdraw(ctx(), 'p1');
    expect(out).toEqual({ ok: true, photoId: 'p1' });
    expect(withdraw).toHaveBeenCalledWith('p1', 'cust_rec_1');   // ownership id passed to the write itself
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it('refuses to withdraw a photo that is not the customer’s consent', async () => {
    const withdraw = vi.fn(async () => { /* */ });
    const svc = new NailPhotoConsentService(makePort({ activeConsentExists: async () => false, withdrawConsent: withdraw }));
    await expect(svc.withdraw(ctx(), 'someone_elses')).rejects.toThrow(/no active consent of yours/i);
    expect(withdraw).not.toHaveBeenCalled();   // never touches the row
  });

  it('refuses withdrawal when the user has no customer record', async () => {
    const svc = new NailPhotoConsentService(makePort({ resolveCustomerRecordId: async () => null }));
    await expect(svc.withdraw(ctx(), 'p1')).rejects.toThrow(/no active consent of yours/i);
  });

  it('rejects an empty photo id', async () => {
    const svc = new NailPhotoConsentService(makePort());
    await expect(svc.withdraw(ctx(), '  ')).rejects.toThrow(/photo id is required/i);
  });
});
