import { describe, it, expect, beforeEach } from 'vitest';
import { CustomerService } from './customer.service';
import type { CustomerContext, CustomerDataPort, CustomerHomeRaw } from './customer.repository';
import type { LoyaltyTierConfig, UpdateCustomerProfileRequest } from './customer.dto';
import type { ActiveServiceRaw } from './customer-core';

const ctx: CustomerContext = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'CUSTOMER', permissions: [] };
const tiers: LoyaltyTierConfig[] = [{ tier: 'Regular', threshold: 0 }, { tier: 'Silver', threshold: 100 }, { tier: 'Gold', threshold: 300 }];
const t = '2026-06-07T05:00:00.000Z';

class FakePort implements CustomerDataPort {
  serviceProgressFlag = true;
  async serviceProgressEnabled() { return this.serviceProgressFlag; }
  customerId: string | null = 'cust1';
  points = 150;
  active: ActiveServiceRaw | null = { ticketId: 'k1', serviceName: 'Mani', status: 'serving', startedAt: t, durationMinutes: 60 };
  lastPatch: UpdateCustomerProfileRequest | null = null;
  async resolveCustomerId() { return this.customerId; }
  async getLoyaltyConfig() { return tiers; }
  async homeRaw(): Promise<CustomerHomeRaw> { return { customerName: 'Jamie R', points: this.points, recentVisitsCount: 4, activeService: this.active ?? undefined }; }
  async appointments() { return [{ appointmentId: 'a1', serviceName: 'Pedi', startTime: t, status: 'confirmed' }]; }
  async receipts() { return [{ receiptId: 'r1', date: t, totalCents: 5000 }]; }
  async loyaltyPoints() { return this.points; }
  async activeService() { return this.active; }
  async updateProfile(_c: CustomerContext, _id: string, patch: UpdateCustomerProfileRequest) { this.lastPatch = patch; }
}

let port: FakePort; let svc: CustomerService;
beforeEach(() => { port = new FakePort(); svc = new CustomerService(port); });

describe('CustomerService resolution', () => {
  it('throws not_customer when no customer is linked', async () => {
    port.customerId = null;
    await expect(svc.getHome(ctx)).rejects.toMatchObject({ code: 'not_customer' });
  });
});

describe('CustomerService reads', () => {
  it('getHome composes loyalty + active-service progress', async () => {
    const home = await svc.getHome(ctx, Date.parse(t) + 30 * 60 * 1000);
    expect(home.loyalty.tier).toBe('Silver');
    expect(home.activeService?.progressPercent).toBe(50);
    expect(home.recentVisitsCount).toBe(4);
  });
  it('getLoyalty returns the tier summary', async () => {
    expect((await svc.getLoyalty(ctx)).tier).toBe('Silver');
  });
  it('getServiceProgress returns progress, or null when none', async () => {
    expect((await svc.getServiceProgress(ctx, Date.parse(t) + 60 * 60 * 1000))?.progressPercent).toBe(100);
    port.active = null;
    expect(await svc.getServiceProgress(ctx)).toBeNull();
  });
  it('appointments + receipts pass through', async () => {
    expect((await svc.getAppointments(ctx))[0].serviceName).toBe('Pedi');
    expect((await svc.getReceipts(ctx))[0].totalCents).toBe(5000);
  });
});

describe('CustomerService.updateProfile', () => {
  it('accepts a valid patch and forwards only provided fields', async () => {
    await svc.updateProfile(ctx, { email: 'me@x.com', smsOptIn: true });
    expect(port.lastPatch).toEqual({ email: 'me@x.com', smsOptIn: true });
  });
  it('rejects an invalid email / phone (port not called)', async () => {
    await expect(svc.updateProfile(ctx, { email: 'nope' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(svc.updateProfile(ctx, { phone: '12' })).rejects.toMatchObject({ code: 'invalid' });
    expect(port.lastPatch).toBeNull();
  });
});

describe('§26 customer_service_progress kill switch', () => {
  it('returns null progress when the tenant disables customer visibility, even with an active service', async () => {
    const p2 = new FakePort();
    p2.serviceProgressFlag = false;
    const out = await new CustomerService(p2).getServiceProgress({ tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'CUSTOMER', permissions: [] } as any);
    expect(out).toBeNull();
  });
});
