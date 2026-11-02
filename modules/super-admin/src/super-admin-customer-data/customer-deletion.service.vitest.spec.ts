import { LegalHoldService, InMemoryLegalHoldRepo } from '@aipowersalon/customers';
import { describe, it, expect } from 'vitest';
import { CustomerDeletionService } from './customer-deletion.service';
import { InMemoryDeletionRepo } from './customer-deletion.repository';

const reqArgs = { tenantId: 't1', customerId: 'CUS-1', reason: 'GDPR erasure' };

describe('CustomerDeletionService', () => {
  it('requests, approves with a distinct user, and executes with the correct typed confirmation', async () => {
    const repo = new InMemoryDeletionRepo();
    const svc = new CustomerDeletionService(repo);
    const r = await svc.requestDeletion(reqArgs, { userId: 'u1' });
    expect(r.ok).toBe(true);
    const ap = await svc.approveDeletion(r.request!.id, { userId: 'u2' });
    expect(ap.ok).toBe(true);
    const ex = await svc.executeDeletion(r.request!.id, 'CUS-1', { userId: 'u2' });
    expect(ex.ok).toBe(true);
    expect(ex.request!.status).toBe('executed');
    expect(repo.wasDeleted('CUS-1')).toBe(true);
    expect(repo.getAudit().map((a) => a.actionType)).toEqual(['customer_deletion_requested', 'customer_deletion_approved', 'customer_deletion_executed']);
  });

  it('blocks self-approval (dual control)', async () => {
    const svc = new CustomerDeletionService(new InMemoryDeletionRepo());
    const r = await svc.requestDeletion(reqArgs, { userId: 'u1' });
    const ap = await svc.approveDeletion(r.request!.id, { userId: 'u1' });
    expect(ap.ok).toBe(false);
    expect(ap.errors!.join(' ')).toMatch(/different person/i);
  });

  it('refuses execution when the typed confirmation does not match', async () => {
    const svc = new CustomerDeletionService(new InMemoryDeletionRepo());
    const r = await svc.requestDeletion(reqArgs, { userId: 'u1' });
    await svc.approveDeletion(r.request!.id, { userId: 'u2' });
    const ex = await svc.executeDeletion(r.request!.id, 'WRONG', { userId: 'u2' });
    expect(ex.ok).toBe(false);
    expect(ex.errors!.join(' ')).toMatch(/typed confirmation/i);
  });

  it('refuses execution before a second approval', async () => {
    const svc = new CustomerDeletionService(new InMemoryDeletionRepo());
    const r = await svc.requestDeletion(reqArgs, { userId: 'u1' });
    const ex = await svc.executeDeletion(r.request!.id, 'CUS-1', { userId: 'u2' });
    expect(ex.ok).toBe(false);
    expect(ex.errors!.join(' ')).toMatch(/approved by a second reviewer/i);
  });

  it('is blocked by an active legal hold and proceeds once released', async () => {
    const repo = new InMemoryDeletionRepo();
    const holds = new LegalHoldService(new InMemoryLegalHoldRepo());
    const svc = new CustomerDeletionService(repo, holds);
    const applied = await holds.applyHold({ tenantId: 't1', customerId: 'CUS-1', matterRef: 'M', reason: 'litigation', scope: 'customer' });
    const r = await svc.requestDeletion(reqArgs, { userId: 'u1' });
    await svc.approveDeletion(r.request!.id, { userId: 'u2' });
    const blocked = await svc.executeDeletion(r.request!.id, 'CUS-1', { userId: 'u2' });
    expect(blocked.ok).toBe(false);
    expect(blocked.errors!.join(' ')).toMatch(/legal hold/i);
    expect(repo.wasDeleted('CUS-1')).toBe(false);
    await holds.releaseHold(applied.hold!.id, 'matter closed', { userId: 'u3' });
    const ok = await svc.executeDeletion(r.request!.id, 'CUS-1', { userId: 'u2' });
    expect(ok.ok).toBe(true);
    expect(repo.wasDeleted('CUS-1')).toBe(true);
  });

  it('is blocked by a failing retention check', async () => {
    const repo = new InMemoryDeletionRepo();
    repo.retentionResult = { ok: false, note: 'Financial retention: 7-year hold' };
    const svc = new CustomerDeletionService(repo);
    const r = await svc.requestDeletion(reqArgs, { userId: 'u1' });
    await svc.approveDeletion(r.request!.id, { userId: 'u2' });
    const ex = await svc.executeDeletion(r.request!.id, 'CUS-1', { userId: 'u2' });
    expect(ex.ok).toBe(false);
    expect(ex.errors!.join(' ')).toMatch(/retention/i);
  });
});
