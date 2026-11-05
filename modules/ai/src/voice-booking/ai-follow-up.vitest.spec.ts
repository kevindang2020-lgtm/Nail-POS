// ai-follow-up.vitest.spec.ts — the follow-up task queue. Permission-gated writes, the status machine, idempotent
// creation from a handoff callback (a retried handoff doesn't stack duplicates), and tenant isolation.
import { describe, it, expect } from 'vitest';
import { AiFollowUpService, InMemoryFollowUpRepo, canTransitionFollowUp, FollowUpValidationError, FollowUpForbiddenError } from './ai-follow-up.service';

const owner = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['ai.manage'] };
const viewer = { tenantId: 't1', branchId: 'b1', userId: 'u2', role: 'RECEPTION', permissions: ['ai.use'] };
const svc = () => new AiFollowUpService(new InMemoryFollowUpRepo());

describe('follow-up status machine', () => {
  it('allows sensible transitions and blocks nonsense', () => {
    expect(canTransitionFollowUp('open', 'assigned')).toBe(true);
    expect(canTransitionFollowUp('open', 'resolved')).toBe(true);
    expect(canTransitionFollowUp('closed', 'open')).toBe(false); // terminal
    expect(canTransitionFollowUp('waiting', 'assigned')).toBe(false);
  });
});

describe('AiFollowUpService', () => {
  it('creates a manual follow-up (permission-gated) and validates the reason', async () => {
    await expect(svc().createManual(viewer as any, { reason: 'COMPLAINT' })).rejects.toBeInstanceOf(FollowUpForbiddenError);
    await expect(svc().createManual(owner as any, { reason: 'NONSENSE' })).rejects.toBeInstanceOf(FollowUpValidationError);
    const fu = await svc().createManual(owner as any, { reason: 'COMPLAINT', callerPhone: '8565550000' });
    expect(fu).toMatchObject({ reason: 'COMPLAINT', status: 'open', source: 'manual' });
  });

  it('creates from a handoff idempotently per open call', async () => {
    const s = svc();
    const scope = { tenantId: 't1', branchId: 'b1' };
    const first = await s.createFromHandoff(scope, { reason: 'CALLBACK', providerCallId: 'call_1', priority: 'high' });
    const again = await s.createFromHandoff(scope, { reason: 'CALLBACK', providerCallId: 'call_1' });
    expect(again.id).toBe(first.id);                    // same open follow-up, not a duplicate
    expect(first.source).toBe('ai_receptionist');
    const all = await s.list(owner as any, {});
    expect(all.length).toBe(1);
  });

  it('assign → in_progress → resolve, with notes appended', async () => {
    const s = svc();
    const fu = await s.createManual(owner as any, { reason: 'REFUND_REQUEST' });
    const assigned = await s.assign(owner as any, fu.id, 'emp_9');
    expect(assigned).toMatchObject({ assignedUserId: 'emp_9', status: 'assigned' });
    const noted = await s.addNote(owner as any, fu.id, 'Left a voicemail.');
    expect(noted.notes).toContain('Left a voicemail.');
    const progress = await s.setStatus(owner as any, fu.id, 'in_progress');
    expect(progress.status).toBe('in_progress');
    const resolved = await s.setStatus(owner as any, fu.id, 'resolved', 'Refunded at the salon.');
    expect(resolved).toMatchObject({ status: 'resolved', resolution: 'Refunded at the salon.' });
  });

  it('rejects an illegal status jump', async () => {
    const s = svc();
    const fu = await s.createManual(owner as any, { reason: 'OTHER' });
    await s.setStatus(owner as any, fu.id, 'resolved');
    await expect(s.setStatus(owner as any, fu.id, 'in_progress')).rejects.toBeInstanceOf(FollowUpValidationError);
  });

  it('is tenant-isolated', async () => {
    const s = svc();
    await s.createManual(owner as any, { reason: 'OTHER' });
    const other = await s.list({ ...owner, tenantId: 't2' } as any, {});
    expect(other.length).toBe(0);
  });
});
