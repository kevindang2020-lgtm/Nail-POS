// tenant-receptionist-learning.vitest.spec.ts — AI Receptionist Settings 07: the salon-side approval routes over the voice
// learning loop. Approving creates a DRAFT prompt version only (nothing live), every decision is audited, refusals are coded,
// and one salon never sees or decides another salon's recommendation.
import { describe, it, expect, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { TenantReceptionistController } from './tenant-receptionist.controller';
import { VoiceLearningService, InMemoryLearningRepo } from './voice-learning.service';

async function make() {
  const events: any[] = [];
  const audit = { record: vi.fn(async (_ctx: any, input: any) => { events.push(input); return { id: 'ev' }; }) };
  const repo = new InMemoryLearningRepo();
  const learning = new VoiceLearningService(repo);
  const c = new TenantReceptionistController({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, audit as any, learning);
  const req = (tenantId = 'ten_1') => ({ ctx: { tenantId, branchId: 'br_1', userId: 'user_1', role: 'OWNER', permissions: ['ai.manage'] } });
  const prompt = await learning.createSuggestion({ tenantId: 'ten_1', branchId: 'br_1' }, { category: 'bad_wording', targetType: 'prompt', detail: 'Greet callers by salon name' });
  const faq = await learning.createSuggestion({ tenantId: 'ten_1', branchId: 'br_1' }, { category: 'repeated_questions', targetType: 'faq', detail: 'Add parking FAQ' });
  const other = await learning.createSuggestion({ tenantId: 'ten_2', branchId: 'br_9' }, { category: 'bad_wording', targetType: 'prompt', detail: 'other salon' });
  return { c, req, events, repo, learning, prompt, faq, other };
}
const code = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e instanceof HttpException ? { status: e.getStatus(), code: (e.getResponse() as any).code } : 'other'; } };

describe('AI Receptionist Settings 07 — salon-side recommendation approval', () => {
  it('lists only the salon\'s own recommendations, with the open count', async () => {
    const { c, req } = await make();
    const all = await c.listRecommendations(req());
    expect(all.items.map((i) => i.detail).sort()).toEqual(['Add parking FAQ', 'Greet callers by salon name']);
    expect(all.openCount).toBe(2);
    expect((all.items[0] as any).tenantId).toBeUndefined();
  });

  it('approving a prompt recommendation creates a DRAFT version only (never active) and is audited', async () => {
    const { c, req, events, repo, prompt } = await make();
    const out = await c.approveRecommendation(req(), prompt.id, { newPromptBody: 'Hello, thanks for calling Lotus Nails.' });
    expect(out.recommendation.status).toBe('approved');
    expect(out.draftVersionId).toBeTruthy();
    const v = await repo.getPromptVersion('ten_1', out.draftVersionId!);
    expect(v?.status).toBe('draft');
    expect(await repo.getActive('ten_1', 'default')).toBeNull();
    expect(events.find((e) => e.action === 'learning.recommendation_approved')).toMatchObject({ resourceId: prompt.id, metadata: { targetType: 'prompt', draftVersionId: out.draftVersionId } });
  });

  it('refuses with codes: prompt text missing, already decided, another salon\'s id', async () => {
    const { c, req, prompt, faq, other } = await make();
    expect(await code(c.approveRecommendation(req(), prompt.id, {}))).toEqual({ status: 400, code: 'AI_RECOMMENDATION_PROMPT_REQUIRED' });
    const r = await c.rejectRecommendation(req(), faq.id);
    expect(r.recommendation.status).toBe('rejected');
    expect(await code(c.approveRecommendation(req(), faq.id, {}))).toEqual({ status: 409, code: 'AI_RECOMMENDATION_NOT_OPEN' });
    expect(await code(c.rejectRecommendation(req(), other.id))).toEqual({ status: 404, code: 'AI_RECOMMENDATION_NOT_FOUND' });
  });

  it('filters by status', async () => {
    const { c, req, faq } = await make();
    await c.rejectRecommendation(req(), faq.id);
    const rej = await c.listRecommendations(req(), 'rejected');
    expect(rej.items.map((i) => i.id)).toEqual([faq.id]);
    expect(rej.openCount).toBe(1);
  });
});
