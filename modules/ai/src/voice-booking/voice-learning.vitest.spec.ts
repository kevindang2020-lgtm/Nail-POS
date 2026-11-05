// voice-learning.vitest.spec.ts — the human-approved improvement loop. These tests encode the spec's hard safety rules:
// the AI never auto-changes production; approval only drafts; activation is a separate explicit step; operational fields
// (prices/hours/policies) are untouchable; only one active version; rollback works.
import { describe, it, expect } from 'vitest';
import { isAllowedSuggestionTarget, isForbiddenTarget, canTransition, evaluateOutcome, FORBIDDEN_AUTO_CHANGE } from './voice-learning-core';
import { VoiceLearningService, InMemoryLearningRepo, LearningError } from './voice-learning.service';

const V = { tenantId: 'ten_1', branchId: 'br_1' };
const svc = () => new VoiceLearningService(new InMemoryLearningRepo());

describe('learning core guards', () => {
  it('allows only prompt/faq/knowledge/pronunciation/tool_description targets', () => {
    expect(isAllowedSuggestionTarget('prompt')).toBe(true);
    expect(isAllowedSuggestionTarget('faq')).toBe(true);
    expect(isAllowedSuggestionTarget('price')).toBe(false);
  });

  it('flags operational fields as forbidden', () => {
    for (const f of ['price', 'hours', 'cancellation_policy', 'permissions', 'booking_validation']) {
      expect(isForbiddenTarget(f)).toBe(true);
    }
    expect(FORBIDDEN_AUTO_CHANGE).toContain('booking_validation');
  });

  it('activation is not reachable except via pending_review or archived (rollback)', () => {
    expect(canTransition('draft', 'active')).toBe(false);       // a draft can NEVER go straight live
    expect(canTransition('pending_review', 'active')).toBe(true);
    expect(canTransition('archived', 'active')).toBe(true);     // rollback
    expect(canTransition('active', 'active')).toBe(false);
  });
});

describe('evaluateOutcome (deterministic, no LLM)', () => {
  it('flags tool failures, repeats, abandonment', () => {
    expect(evaluateOutcome({ toolCalls: [{ name: 'get_availability', ok: false }] }).reviewWorthy).toBe(true);
    expect(evaluateOutcome({ repeatedQuestionCount: 3 }).categories).toContain('repeated_questions');
    expect(evaluateOutcome({ abandoned: true }).categories).toContain('abandoned');
    expect(evaluateOutcome({ bookingOutcome: 'booked' }).reviewWorthy).toBe(false); // a clean call isn't flagged
  });
});

describe('the approval gate never changes production automatically', () => {
  it('a captured suggestion is open and applies nothing', async () => {
    const s = svc();
    const sug = await s.suggestFromOutcome(V, 'call_1', { toolCalls: [{ name: 'get_availability', ok: false }] }, 'Availability tool failed twice.');
    expect(sug?.status).toBe('open');
    expect(await s.activePrompt(V)).toBeNull(); // nothing active — no auto-change
  });

  it('approving a prompt suggestion creates a DRAFT version, never a live one', async () => {
    const s = svc();
    const sug = await s.createSuggestion(V, { category: 'bad_wording', targetType: 'prompt', detail: 'Greeting is too long' });
    const { draftVersion } = await s.approveSuggestion(V, sug.id, 'reviewer_1', 'You are the friendly receptionist...');
    expect(draftVersion?.status).toBe('draft');       // NOT active
    expect(await s.activePrompt(V)).toBeNull();        // still nothing live after approval
  });

  it('refuses to approve/create a suggestion targeting an operational field', async () => {
    const s = svc();
    await expect(s.createSuggestion(V, { category: 'x', targetType: 'price', detail: 'lower prices' })).rejects.toBeInstanceOf(LearningError);
    await expect(s.createSuggestion(V, { category: 'x', targetType: 'business_hours', detail: 'open later' })).rejects.toBeInstanceOf(LearningError);
  });

  it('a prompt version goes live ONLY via explicit activation, and only one is active', async () => {
    const s = svc();
    const sug = await s.createSuggestion(V, { category: 'w', targetType: 'prompt', detail: 'tweak' });
    const { draftVersion } = await s.approveSuggestion(V, sug.id, 'r1', 'v1 body');
    await s.submitForReview(V, draftVersion!.id);
    const active1 = await s.activatePromptVersion(V, draftVersion!.id, 'owner');
    expect(active1.status).toBe('active');
    expect((await s.activePrompt(V))?.id).toBe(active1.id);

    // a second version activates and archives the first — never two active at once
    const sug2 = await s.createSuggestion(V, { category: 'w', targetType: 'prompt', detail: 'tweak2' });
    const { draftVersion: d2 } = await s.approveSuggestion(V, sug2.id, 'r1', 'v2 body');
    await s.submitForReview(V, d2!.id);
    const active2 = await s.activatePromptVersion(V, d2!.id, 'owner');
    expect((await s.activePrompt(V))?.id).toBe(active2.id);
    expect(active2.versionLabel).toBe('v2');
  });

  it('rollback re-activates the prior version', async () => {
    const s = svc();
    const a = await s.approveSuggestion(V, (await s.createSuggestion(V, { category: 'w', targetType: 'prompt', detail: 'x' })).id, 'r', 'v1 body');
    await s.submitForReview(V, a.draftVersion!.id); await s.activatePromptVersion(V, a.draftVersion!.id, 'o');
    const b = await s.approveSuggestion(V, (await s.createSuggestion(V, { category: 'w', targetType: 'prompt', detail: 'y' })).id, 'r', 'v2 body');
    await s.submitForReview(V, b.draftVersion!.id); await s.activatePromptVersion(V, b.draftVersion!.id, 'o');
    expect((await s.activePrompt(V))?.body).toBe('v2 body');
    const rolled = await s.rollback(V);
    expect(rolled.body).toBe('v1 body');
    expect((await s.activePrompt(V))?.body).toBe('v1 body');
  });

  it('cannot approve an already-approved suggestion', async () => {
    const s = svc();
    const sug = await s.createSuggestion(V, { category: 'w', targetType: 'prompt', detail: 'x' });
    await s.approveSuggestion(V, sug.id, 'r', 'body');
    await expect(s.approveSuggestion(V, sug.id, 'r', 'body2')).rejects.toBeInstanceOf(LearningError);
  });
});
