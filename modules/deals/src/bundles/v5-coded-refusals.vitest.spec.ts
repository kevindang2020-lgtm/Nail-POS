// v5-coded-refusals — Vietnamese POS §58 V-5 (Oct 27 2026): bundle refusals carry their registry code (withCode).
import { describe, it, expect } from 'vitest';
import { BundlesService } from './bundles.service';
const stub = () => new Proxy({}, { get: (_t, p) => (p === "then" ? undefined : async () => null) }) as any;
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error & { apiCode?: string; apiParams?: Record<string, unknown> }; } throw new Error("expected a refusal"); };
const ctx: any = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.bundles.view', 'pos.bundles.create', 'pos.bundles.edit', 'pos.bundles.archive'] };
describe('V-5: bundle refusals carry their registry code', () => {
  it('a missing bundle → BUNDLE_NOT_FOUND', async () => {
    expect(await fails(new BundlesService(stub()).detail(ctx, 'nope'))).toMatchObject({ apiCode: 'BUNDLE_NOT_FOUND', message: 'Bundle not found' });
  });
  it('a bundle with no name → BUNDLE_NAME_REQUIRED', async () => {
    expect(await fails(new BundlesService(stub()).create(ctx, { name: '', kind: 'bundle', items: [] } as any))).toMatchObject({ apiCode: 'BUNDLE_NAME_REQUIRED' });
  });
});
