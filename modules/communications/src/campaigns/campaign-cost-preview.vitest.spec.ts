// campaign-cost-preview.vitest.spec.ts — Payments/Twilio mandate §81 / §146 (wave 3): before a large SMS campaign goes
// out the salon sees recipients, opted-out numbers, the segment estimate and the cost (or "unpriced", never a guess), and
// the send needs an explicit confirmation. A small campaign, or an email campaign, activates as before.
import { describe, it, expect } from 'vitest';
import { CampaignsService, CampaignConfirmationRequiredError } from './campaigns.service';
import { InMemoryCampaignsRepository } from './campaigns.repository';

const ctx = { tenantId: 't_A', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.marketing.view', 'pos.marketing.manage'] } as any;
const viewer = { ...ctx, permissions: ['pos.marketing.view'] };

async function campaign(repo: InMemoryCampaignsRepository, over: Record<string, unknown> = {}) {
  return new CampaignsService(repo).create(ctx, { name: 'Fall Gel Special', offer: '20% off gel manicures this week - book online!', channel: 'sms', audienceSize: 400, ...over } as any);
}

describe('campaign cost preview (§81)', () => {
  it('estimates segments for the message as it goes out (offer + STOP footer), subtracts opted-out numbers, prices when the platform has a price', async () => {
    const repo = new InMemoryCampaignsRepository(); repo.costFactsValue = { optedOutSms: 25, segmentPriceCents: 2, salonName: 'Luxe Nails' };
    const c = await campaign(repo);
    const p = await new CampaignsService(repo).costPreview(viewer, c.id);
    expect(p).toMatchObject({ recipients: 400, optedOut: 25, deliverable: 375, segmentsPerMessage: 1, encoding: 'GSM-7', estimatedSegments: 375, unitPriceCents: 2, estimatedCostCents: 750, requiresConfirmation: true, includedRemaining: null });
  });
  it('an em dash (not GSM-7) flips the whole text to UCS-2 — 70-character segments, so a modest offer becomes two', async () => {
    const repo = new InMemoryCampaignsRepository(); repo.costFactsValue = { optedOutSms: 0, segmentPriceCents: null, salonName: 'Luxe Nails' };
    const c = await campaign(repo, { offer: '20% off gel manicures this week — book online!' });   // 80 chars with the salon name + STOP footer
    expect(await new CampaignsService(repo).costPreview(viewer, c.id)).toMatchObject({ encoding: 'UCS-2', segmentsPerMessage: 2 });
  });
  it('a long offer costs two segments each; an unpriced platform reports null cost — never a guess', async () => {
    const repo = new InMemoryCampaignsRepository();
    const c = await campaign(repo, { offer: 'x'.repeat(170) });
    const p = await new CampaignsService(repo).costPreview(viewer, c.id);
    expect(p.segmentsPerMessage).toBe(2); expect(p.estimatedSegments).toBe(800);
    expect(p.unitPriceCents).toBeNull(); expect(p.estimatedCostCents).toBeNull(); expect(p.estimatedOverageSegments).toBeNull();
  });
  it('activating a large SMS campaign without confirmEstimate is refused (409 CAMPAIGN_CONFIRMATION_REQUIRED with the preview); with it, it starts', async () => {
    const repo = new InMemoryCampaignsRepository();
    const c = await campaign(repo);
    const svc = new CampaignsService(repo);
    await expect(svc.activate(ctx, c.id)).rejects.toBeInstanceOf(CampaignConfirmationRequiredError);
    await expect(svc.activate(ctx, c.id)).rejects.toMatchObject({ code: 'CAMPAIGN_CONFIRMATION_REQUIRED', preview: { deliverable: 400 } });
    expect((await repo.get(ctx, c.id))!.status).toBe('draft');   // nothing moved
    expect((await svc.activate(ctx, c.id, { confirmEstimate: true })).status).toBe('in_progress');
  });
  it('a small SMS campaign (under the threshold) and an email campaign activate without the confirmation', async () => {
    const repo = new InMemoryCampaignsRepository();
    const small = await campaign(repo, { audienceSize: 20 });
    const email = await campaign(repo, { channel: 'email', audienceSize: 5000 });
    const svc = new CampaignsService(repo);
    expect((await svc.activate(ctx, small.id)).status).toBe('in_progress');
    expect((await svc.activate(ctx, email.id)).status).toBe('in_progress');
  });
  it('the preview needs the marketing view permission; a stranger gets nothing', async () => {
    const repo = new InMemoryCampaignsRepository();
    const c = await campaign(repo);
    await expect(new CampaignsService(repo).costPreview({ ...ctx, permissions: [] }, c.id)).rejects.toThrow();
  });
});
