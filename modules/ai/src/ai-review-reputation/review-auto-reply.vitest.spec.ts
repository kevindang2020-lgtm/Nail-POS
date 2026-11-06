// review-auto-reply — G8 (Nov 6 2026): automatic public replies are wired to ingestion, and stay inside the salon's choice
// (OFF by default; never while approval is required) and the clean-5-star envelope.
import { describe, it, expect, beforeEach } from 'vitest';
import { ReviewAutoReplier } from './ai-review-reputation-auto-reply';
import { ReviewDraftingService } from './ai-review-reputation-drafting.service';
import { ReviewIngestionService, type ReviewSourceAdapter } from './ai-review-reputation-ingest';
import { analyzeReview } from './ai-review-reputation-core';
import type { SettingsPort } from './ai-review-reputation.service';

const T = 't-g8';
let stored: Record<string, any> = {};
let published: { reviewId: string; text: string; isAuto: boolean }[] = [];
let approvals: string[] = [];
let publishFails = false;
const drafting = new ReviewDraftingService(
  { async draft() { return 'Thank you so much for the kind words — we look forward to seeing you again!'; } },
  { async get(_c, id) { return stored[id] ?? null; }, async save(_c, id, p) { stored[id] = { ...(stored[id] ?? { version: 0 }), ...p }; }, async addVersion() {} },
  { async record(_c, _id, action) { approvals.push(action); } },
  { async publish(_c, reviewId, text, isAuto) { if (publishFails) throw new Error('INTEGRATION_DISCONNECTED'); published.push({ reviewId, text, isAuto }); return { externalResponseId: 'x' + published.length }; } },
);
let config: any = null; let enabled: boolean | null = true;
const settings: SettingsPort = {
  async load() { return [{ level: 'tenant', branch_id: null, enabled, config }] as any; },
  async tenantContextInput(ctx: any, cfg: any) { return { tenantId: ctx.tenantId, brandName: 'Lux Nails', config: cfg }; },
};
let access = { allowed: true, enforce: false };
const replier = new ReviewAutoReplier(settings, drafting, async () => ({ ...access, reason: 'x' }));
const FIVE = { text: 'Absolutely loved my manicure, the staff were wonderful and friendly!', rating: 5 };
// the deterministic analyzer's confidence tops out at 0.8 and the default floor is 0.9: a salon that wants automatic
// replies must also lower the floor to 0.8 (the lowest the clamp allows) — with the defaults nothing is ever auto-published
const on = { approvalRequired: false, autoResponse: { enabled: true, confidenceThreshold: 0.8 } };

beforeEach(() => { stored = {}; published = []; approvals = []; publishFails = false; config = null; enabled = true; access = { allowed: true, enforce: false }; });
const offer = (rid: string, r = FIVE) => replier.onNewReview({ tenantId: T, branchId: null }, rid, r, analyzeReview(r));

describe('G8 automatic replies', () => {
  it('AR-01 nothing set: OFF by default — no reply', async () => {
    expect(await offer('r1')).toMatchObject({ autoResponded: false, reason: 'auto_response_disabled' });
    expect(published).toHaveLength(0);
  });
  it('AR-02 turned on but approval still required: approval wins — no reply', async () => {
    config = { autoResponse: { enabled: true } };
    expect(await offer('r1')).toMatchObject({ autoResponded: false, reason: 'approval_required' });
    config = { approvalRequired: false, autoResponse: { enabled: true } };   // default 0.9 floor
    expect(await offer('r1')).toMatchObject({ autoResponded: false, reason: 'below_confidence' });
    expect(published).toHaveLength(0);
  });
  it('AR-03 on + approval off + a clean 5-star review: published as an automatic reply, recorded auto_approved', async () => {
    config = on;
    expect(await offer('r1')).toMatchObject({ autoResponded: true });
    expect(published).toEqual([expect.objectContaining({ reviewId: 'r1', isAuto: true })]);
    expect(approvals).toEqual(['auto_approved']);
    expect(stored.r1.status).toBe('published');
  });
  it('AR-04 never below 5 stars, never a complaint, never with the assistant off', async () => {
    config = on;
    expect((await offer('r2', { text: 'Pretty good overall, thanks.', rating: 4 })).autoResponded).toBe(false);
    expect((await offer('r3', { text: 'Five stars but my nail chipped the next day and it was dirty.', rating: 5 })).autoResponded).toBe(false);
    enabled = false;
    expect(await offer('r4')).toMatchObject({ autoResponded: false, reason: 'assistant_disabled' });
    expect(published).toHaveLength(0);
  });
  it('AR-05 not entitled while the platform enforces → no reply; a publish the integration cannot carry stays a draft for a person', async () => {
    config = on; access = { allowed: false, enforce: true };
    expect(await offer('r1')).toMatchObject({ autoResponded: false, reason: 'not_entitled' });
    access = { allowed: true, enforce: false }; publishFails = true;
    const r = await offer('r5');
    expect(r).toMatchObject({ autoResponded: false, reason: 'INTEGRATION_DISCONNECTED' });
    expect(stored.r5.status).toBe('draft_generated');                  // saved before publish — a person can send it
  });
  it('AR-06 ingestion offers only NEW, non-escalated reviews; an edited review never triggers a reply', async () => {
    config = on;
    const rows: Record<string, { id: string; contentHash: string }> = {};
    const store: any = {
      async findByDedupeKey(_c: any, _s: string, ext: string) { return rows[ext] ?? null; },
      async insert(_c: any, n: any) { rows[n.externalReviewId] = { id: 'rv-' + n.externalReviewId, contentHash: n.contentHash }; return { id: 'rv-' + n.externalReviewId }; },
      async update() {},
    };
    let raw: any[] = [{ externalId: 'g1', rating: 5, text: FIVE.text, reviewerName: 'A', reviewDate: '2026-11-05T10:00:00Z' }];
    const adapter: ReviewSourceAdapter = { source: 'google', async fetch() { return raw; } };
    const ing = new ReviewIngestionService(store, { async raise() {} }, replier);
    expect((await ing.sync({ tenantId: T }, adapter)).autoReplied).toBe(1);
    raw = [{ ...raw[0], text: FIVE.text + ' Edited.' }];
    const second = await ing.sync({ tenantId: T }, adapter);
    expect(second.updated).toBe(1); expect(second.autoReplied ?? 0).toBe(0);
    expect(published).toHaveLength(1);
  });
});
