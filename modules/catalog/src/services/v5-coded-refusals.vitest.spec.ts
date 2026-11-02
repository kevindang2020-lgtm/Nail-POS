// v5-coded-refusals — Vietnamese POS §58 V-5 (Oct 27 2026): the catalogue's free-text refusals travel with a registry code
// (withCode) beside the unchanged English sentence; the POS words the code in Vietnamese (ns/errors).
import { describe, it, expect } from 'vitest';
import { ServicesService } from './services.service';
const stub = () => new Proxy({}, { get: (_t, p) => (p === "then" ? undefined : async () => null) }) as any;
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error & { apiCode?: string; apiParams?: Record<string, unknown> }; } throw new Error("expected a refusal"); };
const ctx: any = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.services.view', 'pos.services.create', 'pos.services.edit', 'pos.services.archive'] };
describe('V-5: catalogue refusals carry their registry code', () => {
  it('a missing service → SERVICE_NOT_FOUND, English unchanged', async () => {
    expect(await fails(new ServicesService(stub()).detail(ctx, 'nope'))).toMatchObject({ apiCode: 'SERVICE_NOT_FOUND', message: 'Service not found' });
  });
  it('a service with no name → SERVICE_NAME_REQUIRED', async () => {
    expect(await fails(new ServicesService(stub()).create(ctx, { name: '  ' } as any))).toMatchObject({ apiCode: 'SERVICE_NAME_REQUIRED', message: 'Service name is required' });
  });
  it('a category with active services → CATEGORY_HAS_SERVICES with its count as a param (the Vietnamese text fills {count})', async () => {
    const repo = { archiveCategory: async () => ({ ok: false, activeServices: 3 }) } as any;
    expect(await fails(new ServicesService(repo).archiveCategory(ctx, 'c1'))).toMatchObject({ apiCode: 'CATEGORY_HAS_SERVICES', apiParams: { count: 3 }, message: 'Category has 3 active service(s). Confirm to archive.' });
  });
});
