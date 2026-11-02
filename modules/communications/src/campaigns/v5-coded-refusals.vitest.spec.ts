// v5-coded-refusals — Vietnamese POS §58 V-5 (Oct 27 2026): campaign refusals carry their registry code (withCode).
import { describe, it, expect } from 'vitest';
import { CampaignsService } from './campaigns.service';
const stub = () => new Proxy({}, { get: (_t, p) => (p === "then" ? undefined : async () => null) }) as any;
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error & { apiCode?: string; apiParams?: Record<string, unknown> }; } throw new Error("expected a refusal"); };
const ctx: any = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.marketing.view', 'pos.marketing.manage'] };
describe('V-5: campaign refusals carry their registry code', () => {
  it('a nameless campaign → CAMPAIGN_NAME_REQUIRED, English unchanged', async () => {
    expect(await fails(new (CampaignsService as any)(stub()).create(ctx, { name: '' }))).toMatchObject({ apiCode: 'CAMPAIGN_NAME_REQUIRED', message: 'Campaign name is required' });
  });
});
