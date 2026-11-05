// ai-business-saved-questions.vitest.spec.ts — slice 10: saved questions CRUD + isolation (§35).
import { describe, it, expect } from 'vitest';
import { AiBusinessSavedQuestionsService } from './ai-business-saved-questions.service';
import { InMemorySavedQuestionsRepository } from './ai-business-saved-questions.repository';
import { AiBusinessError, AiBusinessErrorCode, type AiBusinessContext } from './ai-business.dto';

const CTX = (o: Partial<AiBusinessContext> = {}): AiBusinessContext => ({ tenantId: 'tA', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['ai.use'], ...o });
const mk = () => new AiBusinessSavedQuestionsService(new InMemorySavedQuestionsRepository());

describe('create + list', () => {
  it('creates a private question and lists it for the owner', async () => {
    const svc = mk();
    const q = await svc.create(CTX(), { title: 'Daily brief', intent: 'daily_summary', preset: 'today' });
    expect(q.title).toBe('Daily brief');
    expect(q.ownedByMe).toBe(true);
    const list = await svc.list(CTX());
    expect(list.map((x) => x.id)).toContain(q.id);
  });

  it('requires a title', async () => {
    try { await mk().create(CTX(), { title: '  ', intent: 'daily_summary' }); expect.fail('should throw'); }
    catch (e) { expect((e as AiBusinessError).code).toBe(AiBusinessErrorCode.INVALID_DATE_RANGE); }
  });

  it('rejects an unknown intent', async () => {
    try { await mk().create(CTX(), { title: 'x', intent: 'launch_rockets' }); expect.fail('should throw'); }
    catch (e) { expect((e as AiBusinessError).code).toBe(AiBusinessErrorCode.METRIC_NOT_FOUND); }
  });
});

describe('tenant + user isolation', () => {
  it('a different tenant never sees another tenant\u2019s questions', async () => {
    const repo = new InMemorySavedQuestionsRepository();
    const svc = new AiBusinessSavedQuestionsService(repo);
    await svc.create(CTX({ tenantId: 'tA' }), { title: 'A private', intent: 'revenue_summary' });
    const otherTenant = await svc.list(CTX({ tenantId: 'tB', userId: 'u9' }));
    expect(otherTenant).toHaveLength(0);
  });

  it('a private question is invisible to other users in the same tenant; a shared one is visible', async () => {
    const repo = new InMemorySavedQuestionsRepository();
    const svc = new AiBusinessSavedQuestionsService(repo);
    await svc.create(CTX({ userId: 'u1' }), { title: 'mine', intent: 'revenue_summary', sharingScope: 'private' });
    const shared = await svc.create(CTX({ userId: 'u1' }), { title: 'ours', intent: 'daily_summary', sharingScope: 'tenant' });
    const asU2 = await svc.list(CTX({ userId: 'u2' }));
    expect(asU2.map((x) => x.title)).toEqual(['ours']);
    expect(asU2[0].id).toBe(shared.id);
    expect(asU2[0].ownedByMe).toBe(false);
  });
});

describe('delete + use', () => {
  it('only the creator can delete their question', async () => {
    const repo = new InMemorySavedQuestionsRepository();
    const svc = new AiBusinessSavedQuestionsService(repo);
    const q = await svc.create(CTX({ userId: 'u1' }), { title: 'mine', intent: 'revenue_summary', sharingScope: 'tenant' });
    // u2 (a different user) cannot delete it
    try { await svc.remove(CTX({ userId: 'u2' }), q.id); expect.fail('should throw'); }
    catch (e) { expect((e as AiBusinessError).code).toBe(AiBusinessErrorCode.METRIC_NOT_FOUND); }
    // creator can
    expect(await svc.remove(CTX({ userId: 'u1' }), q.id)).toEqual({ deleted: true });
    expect(await svc.list(CTX({ userId: 'u1' }))).toHaveLength(0);
  });

  it('use() stamps last_used_at', async () => {
    const svc = mk();
    const q = await svc.create(CTX(), { title: 'brief', intent: 'daily_summary' });
    expect(q.lastUsedAt).toBeNull();
    const used = await svc.touch(CTX(), q.id);
    expect(used.lastUsedAt).not.toBeNull();
  });

  it('deleting a non-existent question is a stable not-found', async () => {
    try { await mk().remove(CTX(), 'nope'); expect.fail('should throw'); }
    catch (e) { expect((e as AiBusinessError).code).toBe(AiBusinessErrorCode.METRIC_NOT_FOUND); }
  });
});
