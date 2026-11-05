import { describe, it, expect } from 'vitest';
import { InMemoryMobilePaymentAttemptRepository, MOBILE_ATTEMPT_METHOD } from './mobile-payment-attempt.repository';
import { canTransition, type PaymentAttemptState } from './payment-attempt-state';
import type { Ctx } from '@aipowersalon/permissions';

const ctx: Ctx = { tenantId: 'T1', branchId: 'B1', userId: 'u_owner', role: 'OWNER', permissions: [] };
const otherTenant: Ctx = { ...ctx, tenantId: 'T2' };

describe('mobile payment-attempt repository (idempotency on payment_attempts)', () => {
  it('createOrGet is idempotent on (tenant, idempotencyKey) — two posts return one attempt', async () => {
    const repo = new InMemoryMobilePaymentAttemptRepository();
    const a = await repo.createOrGet(ctx, { ticketId: 'tk1', amountCents: 10000, idempotencyKey: 'K1' });
    const b = await repo.createOrGet(ctx, { ticketId: 'tk1', amountCents: 10000, idempotencyKey: 'K1' });
    expect(a.id).toBe(b.id);
    expect(a.status).toBe('created');
    expect(a.method).toBe(MOBILE_ATTEMPT_METHOD);
  });

  it('different idempotency keys create distinct attempts; tenants are isolated', async () => {
    const repo = new InMemoryMobilePaymentAttemptRepository();
    const a = await repo.createOrGet(ctx, { ticketId: 'tk1', amountCents: 10000, idempotencyKey: 'K1' });
    const b = await repo.createOrGet(ctx, { ticketId: 'tk1', amountCents: 10000, idempotencyKey: 'K2' });
    expect(a.id).not.toBe(b.id);
    // same key, different tenant → its own attempt, and not visible to the other tenant
    await repo.createOrGet(otherTenant, { ticketId: 'tk1', amountCents: 10000, idempotencyKey: 'K1' });
    expect(await repo.findByKey('T1', 'K1')).toBeTruthy();
    expect(await repo.findByKey('T2', 'K1')).toBeTruthy();
    expect((await repo.listForTicket(ctx, 'tk1')).length).toBe(2); // only T1's two attempts
  });

  it('updateStatus advances the stored status; findByKey reflects it', async () => {
    const repo = new InMemoryMobilePaymentAttemptRepository();
    await repo.createOrGet(ctx, { ticketId: 'tk1', amountCents: 10000, idempotencyKey: 'K1' });
    await repo.updateStatus('T1', 'K1', 'ready');
    expect((await repo.findByKey('T1', 'K1'))!.status).toBe('ready');
  });

  it('listForTicket returns mobile attempts newest-first and excludes other tickets', async () => {
    const repo = new InMemoryMobilePaymentAttemptRepository();
    await repo.createOrGet(ctx, { ticketId: 'tk1', amountCents: 100, idempotencyKey: 'K1' });
    await new Promise((r) => setTimeout(r, 2));
    await repo.createOrGet(ctx, { ticketId: 'tk1', amountCents: 200, idempotencyKey: 'K2' });
    await repo.createOrGet(ctx, { ticketId: 'tk2', amountCents: 300, idempotencyKey: 'K3' });
    const list = await repo.listForTicket(ctx, 'tk1');
    expect(list.map((a) => a.idempotencyKey)).toEqual(['K2', 'K1']);
  });

  it('listRecent spans tickets, is tenant-isolated, newest-first, and honors the limit', async () => {
    const repo = new InMemoryMobilePaymentAttemptRepository();
    await repo.createOrGet(ctx, { ticketId: 'tk1', amountCents: 100, idempotencyKey: 'K1' });
    await new Promise((r) => setTimeout(r, 2));
    await repo.createOrGet(ctx, { ticketId: 'tk2', amountCents: 200, idempotencyKey: 'K2' });
    await new Promise((r) => setTimeout(r, 2));
    await repo.createOrGet(ctx, { ticketId: 'tk3', amountCents: 300, idempotencyKey: 'K3' });
    await repo.createOrGet(otherTenant, { ticketId: 'tk9', amountCents: 900, idempotencyKey: 'K9' });
    const recent = await repo.listRecent(ctx, 2);
    expect(recent.map((a) => a.idempotencyKey)).toEqual(['K3', 'K2']); // newest 2, T2 excluded
  });
});

describe('attempt lifecycle transitions used by the service', () => {
  it('readiness step path is valid: created → readiness_checking → ready | failed', () => {
    expect(canTransition('created', 'readiness_checking')).toBe(true);
    expect(canTransition('readiness_checking', 'ready')).toBe(true);
    expect(canTransition('readiness_checking', 'failed')).toBe(true);
  });
  it('cancel is valid from an open attempt but not from a terminal one', () => {
    expect(canTransition('created', 'canceled')).toBe(true);
    expect(canTransition('ready', 'canceled')).toBe(true);
    for (const t of ['canceled', 'voided', 'refunded'] as PaymentAttemptState[]) {
      expect(canTransition(t, 'canceled')).toBe(false);
    }
  });
});
