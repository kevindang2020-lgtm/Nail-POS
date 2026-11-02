// v5-coded-refusals — Vietnamese POS §58 V-5 (Oct 27 2026): technician refusals carry their registry code (withCode).
import { describe, it, expect } from 'vitest';
import { TechniciansService } from './technicians.service';
const stub = () => new Proxy({}, { get: (_t, p) => (p === "then" ? undefined : async () => null) }) as any;
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error & { apiCode?: string; apiParams?: Record<string, unknown> }; } throw new Error("expected a refusal"); };
const ctx: any = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.technicians.view', 'pos.technicians.create', 'pos.technicians.edit'] };
describe('V-5: technician refusals carry their registry code', () => {
  it('no first name → FIRST_NAME_REQUIRED, English unchanged', async () => {
    expect(await fails(new (TechniciansService as any)(stub()).create(ctx, { firstName: '', lastName: 'Nguyen' }))).toMatchObject({ apiCode: 'FIRST_NAME_REQUIRED', message: 'First name is required' });
  });
});
