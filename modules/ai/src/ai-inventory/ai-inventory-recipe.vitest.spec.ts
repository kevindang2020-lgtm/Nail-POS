// ai-inventory-recipe.vitest.spec.ts — recipe service: gating, validation, approval supersede, isolation.
import { describe, it, expect, beforeEach } from 'vitest';
import { AiInventoryRecipeService } from './ai-inventory-recipe.service';
import { InMemoryRecipeRepository } from './ai-inventory-recipe.repository';
import { AiInventoryError, type AiInventoryContext } from './ai-inventory.dto';
import type { RecipeDraftInput } from './ai-inventory-recipe.core';

const ctx = (o: Partial<AiInventoryContext> = {}): AiInventoryContext => ({
  tenantId: 'T1', branchId: 'B1', userId: 'U1', role: 'OWNER',
  permissions: ['inventory.view', 'ai_inventory.manage_recipes'], ...o,
});
const draft = (o: Partial<RecipeDraftInput> = {}): RecipeDraftInput => ({
  serviceId: 'gel-manicure',
  lines: [{ productId: 'base', expectedQuantity: 1.5, consumptionUnit: 'mL' }, { productId: 'top', expectedQuantity: 1.5, consumptionUnit: 'mL' }],
  ...o,
});

let svc: AiInventoryRecipeService;
beforeEach(() => { svc = new AiInventoryRecipeService(new InMemoryRecipeRepository()); });

describe('write gating', () => {
  it('requires manage_recipes to create', async () => {
    await expect(svc.createDraft(ctx({ permissions: ['inventory.view'] }), draft())).rejects.toBeInstanceOf(AiInventoryError);
  });
  it('viewer can read but not write', async () => {
    const created = await svc.createDraft(ctx(), draft());
    const list = await svc.list(ctx({ permissions: ['inventory.view'] }));
    expect(list.recipes.map((r) => r.id)).toContain(created.id);
    await expect(svc.approve(ctx({ permissions: ['inventory.view'] }), created.id)).rejects.toBeInstanceOf(AiInventoryError);
  });
});

describe('validation', () => {
  it('rejects an invalid draft (duplicate supply)', async () => {
    await expect(svc.createDraft(ctx(), draft({ lines: [
      { productId: 'x', expectedQuantity: 1, consumptionUnit: 'mL' },
      { productId: 'x', expectedQuantity: 2, consumptionUnit: 'mL' },
    ] }))).rejects.toBeInstanceOf(AiInventoryError);
  });
  it('rejects a foreign branch override', async () => {
    await expect(svc.createDraft(ctx(), draft({ branchId: 'OTHER' }))).rejects.toBeInstanceOf(AiInventoryError);
  });
});

describe('draft is inert until approved', () => {
  it('creates ai_proposed drafts that need approval', async () => {
    const r = await svc.createDraft(ctx(), draft({ source: 'ai_proposed' }));
    expect(r.status).toBe('draft');
    expect(r.source).toBe('ai_proposed');
    expect(r.version).toBe(1);
  });
});

describe('approval supersedes the prior version', () => {
  it('archives the previous approved recipe for the same service/branch scope', async () => {
    const v1 = await svc.createDraft(ctx(), draft());
    await svc.approve(ctx(), v1.id);
    const v2 = await svc.createDraft(ctx(), draft());   // new draft, same service, tenant-wide default
    expect(v2.version).toBe(2);
    const approvedV2 = await svc.approve(ctx(), v2.id);
    expect(approvedV2.status).toBe('approved');
    expect((await svc.get(ctx(), v1.id)).status).toBe('archived'); // prior superseded
  });
  it('cannot approve an already-approved recipe', async () => {
    const r = await svc.createDraft(ctx(), draft());
    await svc.approve(ctx(), r.id);
    await expect(svc.approve(ctx(), r.id)).rejects.toBeInstanceOf(AiInventoryError);
  });
});

describe('tenant isolation', () => {
  it('a recipe created in T1 is invisible to T2', async () => {
    const r = await svc.createDraft(ctx({ tenantId: 'T1' }), draft());
    await expect(svc.get(ctx({ tenantId: 'T2' }), r.id)).rejects.toBeInstanceOf(AiInventoryError);
    const t2list = await svc.list(ctx({ tenantId: 'T2' }));
    expect(t2list.recipes).toHaveLength(0);
  });
});
