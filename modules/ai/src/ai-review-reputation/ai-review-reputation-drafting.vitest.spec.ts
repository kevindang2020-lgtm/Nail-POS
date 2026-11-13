// ai-review-reputation-drafting.vitest.spec.ts — drafting/approval safety. The auto-response gate denies on every risk
// signal and allows only a clean, high-confidence 5-star; a generated draft that leaks PII/payment or admits liability is
// blocked; a public response reaches `published` only from `approved` or the audited (re-validated) auto-response path.
import { describe, it, expect } from 'vitest';
import { autoResponseDecision, validateDraftSafety, transitionResponse, canPublish } from './ai-review-reputation-drafting';
import { ReviewDraftingService, DraftingForbiddenError, type DraftLlmPort, type DraftStorePort, type ApprovalStorePort, type PublicationPort } from './ai-review-reputation-drafting.service';
import { PLATFORM_DEFAULTS, resolveSettings } from './ai-review-reputation-settings';
import { buildTenantContext } from './ai-review-reputation-context';
import { analyzeReview } from './ai-review-reputation-core';

const enabledCfg = resolveSettings({ platform: PLATFORM_DEFAULTS, tenant: { config: { approvalRequired: false, autoResponse: { enabled: true, minRating: 5, confidenceThreshold: 0.8, requireNoComplaintText: true } } } }).config;
const clean5 = analyzeReview({ text: 'Amazing, highly recommend!', rating: 5 });

describe('auto-response gate', () => {
  it('allows a clean high-confidence 5-star when enabled; denies every risk case', () => {
    expect(autoResponseDecision(clean5, 5, enabledCfg).allow).toBe(true);
    expect(autoResponseDecision(clean5, 5, PLATFORM_DEFAULTS).reason).toBe('auto_response_disabled');
    // "Require approval before publishing" wins over automatic replies (Nov 2 2026)
    expect(autoResponseDecision(clean5, 5, { ...enabledCfg, approvalRequired: true }).reason).toBe('approval_required');
    expect(autoResponseDecision(analyzeReview({ text: 'terrible', rating: 1 }), 1, enabledCfg).allow).toBe(false);
    expect(autoResponseDecision(analyzeReview({ text: 'chemical burn', rating: 5 }), 5, enabledCfg).allow).toBe(false);
    expect(autoResponseDecision(analyzeReview({ text: 'good', rating: 4 }), 4, enabledCfg).allow).toBe(false);
  });
});

describe('draft safety validator', () => {
  it('flags PII / payment / liability / employee naming and passes a clean draft', () => {
    expect(validateDraftSafety('Contact us at info@salon.com').violations).toContain('contains_email');
    expect(validateDraftSafety('call me at 555-123-4567 please').violations).toContain('contains_phone');
    expect(validateDraftSafety('we will refund your $45').violations).toContain('contains_payment_detail');
    expect(validateDraftSafety('we admit full fault for this').violations).toContain('admits_liability');
    expect(validateDraftSafety('sorry, Maria made a mistake', { employeeNames: ['Maria'] }).violations).toContain('names_employee');
    expect(validateDraftSafety('Thank you for your feedback, we would love to make this right.').safe).toBe(true);
  });
  it('extras Reviews 04 (round 10): never invents a promise or a fact — offers, superiority / credential claims, staff discipline, "we posted this"', () => {
    for (const bad of ['We would like to offer you a full refund.', 'Your next pedicure is complimentary!', 'Enjoy 20% off your next visit.', 'Here is a discount for you.',
      'We will send you a voucher.', 'We are the best salon in town.', 'Our award-winning team', 'Every service is guaranteed.', 'Our licensed technicians care.',
      'We have retrained the staff involved.']) expect(validateDraftSafety(bad).violations).toContain('invented_claim');
    expect(validateDraftSafety('We have posted this reply on Google.').violations).toContain('claims_publication');
    // an apology + an invitation to talk stays clean (it promises nothing it cannot keep)
    for (const ok of ['We are sorry your visit fell short. Please reach out so we can make it right.', 'Thank you for the kind words — we hope to see you again soon!'])
      expect(validateDraftSafety(ok)).toEqual({ safe: true, violations: [] });
  });
});

describe('approval state machine', () => {
  it('enforces legal transitions and publish-from-approved-only', () => {
    expect(transitionResponse(transitionResponse(transitionResponse(transitionResponse('draft_generated', 'awaiting_approval'), 'approved'), 'publishing'), 'published')).toBe('published');
    expect(() => transitionResponse('published', 'approved')).toThrow('INVALID_RESPONSE_TRANSITION');
    expect(canPublish('approved')).toBe(true);
    expect(canPublish('draft_generated')).toBe(false);
    expect(canPublish('draft_generated', { autoApproved: true })).toBe(true);
  });
});

describe('drafting service', () => {
  const tctx = buildTenantContext({ tenantId: 'A', brandName: 'Glow', config: enabledCfg });
  function makeSvc(llmText: string, pubFail = false) {
    const store: Record<string, any> = {};
    const drafts: DraftStorePort = { async get(_c, id) { return store[id] || null; }, async save(_c, id, patch) { store[id] = { ...(store[id] || { version: 0, text: null, status: 'analyzed' }), ...patch }; }, async addVersion() {} };
    const llm: DraftLlmPort = { async draft() { return llmText; } };
    const approvals: ApprovalStorePort = { async record() {} };
    const publication: PublicationPort = { async publish() { if (pubFail) throw new Error('api down'); return { externalResponseId: 'ext1' }; } };
    return { svc: new ReviewDraftingService(llm, drafts, approvals, publication), store };
  }
  const ctx: any = { tenantId: 'A', branchId: 'b1', userId: 'u', role: 'MANAGER', permissions: ['marketing.manage'] };
  const input = () => ({ analysis: clean5, config: enabledCfg, tenantContext: tctx, reviewText: 'nice place', employeeNames: ['Maria'] });

  it('generates+validates, requires approval to publish, and blocks unsafe drafts', async () => {
    const { svc } = makeSvc('Thank you so much for the kind words!');
    const g = await svc.generateDraft(ctx, 'r1', input() as any);
    expect(g.status).toBe('draft_generated');
    await svc.requestApproval(ctx, 'r1'); await svc.approve(ctx, 'r1');
    expect((await svc.publish(ctx, 'r1')).status).toBe('published');

    const { svc: s2 } = makeSvc('email info@salon.com, we admit full fault');
    await expect(s2.generateDraft(ctx, 'r2', input() as any)).rejects.toThrow('DRAFT_UNSAFE');

    const { svc: s3 } = makeSvc('Thanks!');
    await s3.generateDraft(ctx, 'r3', input() as any);
    await expect(s3.publish(ctx, 'r3')).rejects.toThrow('NOT_APPROVED');
    await expect(s3.generateDraft({ ...ctx, permissions: [] }, 'r3', input() as any)).rejects.toBeInstanceOf(DraftingForbiddenError);
  });

  it('auto-response falls back to human on risk and on unsafe drafts; publishes only clean 5-star', async () => {
    const { svc: s4 } = makeSvc('Thanks!');
    expect((await s4.autoRespond(ctx, 'r4', { ...input(), analysis: analyzeReview({ text: 'awful', rating: 1 }), rating: 1 } as any)).autoResponded).toBe(false);
    const { svc: s5, store: st5 } = makeSvc('Thank you for the lovely review!');
    expect((await s5.autoRespond(ctx, 'r5', { ...input(), analysis: clean5, rating: 5 } as any)).autoResponded).toBe(true);
    expect(st5['r5'].status).toBe('published');
    const { svc: s6, store: st6 } = makeSvc('call 555-999-8888 for your refund of $30');
    const r = await s6.autoRespond(ctx, 'r6', { ...input(), analysis: clean5, rating: 5 } as any);
    expect(r.autoResponded).toBe(false);
    expect(st6['r6']?.status).not.toBe('published');
  });
});
