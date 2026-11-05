import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { BizCategoriesRepo, BizCategory } from './business-categories.repository';
import { slugify, validateCategoryName, nextSortOrder, applyReorder } from './business-category-core';

export class BizCatError extends Error { constructor(public code: 'invalid' | 'not_found' | 'conflict', message: string) { super(message); this.name = 'BizCatError'; } }
export interface AdminCtx { userId?: string; email?: string; role?: string; ip?: string }

export class BusinessCategoriesService {
  constructor(private readonly repo: BizCategoriesRepo, private readonly db?: Kysely<DB>) {}

  private async audit(ctx: AdminCtx, action: string, entityId: string, meta?: Record<string, unknown>) {
    if (!this.db) return;
    await this.db.insertInto('audit_logs' as any).values({ id: sql`gen_random_uuid()` as any, tenant_id: null as any, user_id: (ctx.userId || null) as any, role: 'SUPER_ADMIN', action_type: action, entity_type: 'business_category', entity_id: entityId, metadata_json: JSON.stringify(meta || {}) as any } as any).execute().catch(() => {});
  }

  list(includeInactive = false): Promise<BizCategory[]> { return this.repo.list(includeInactive); }
  async summary(): Promise<{ active: number; total: number }> { return this.repo.counts(); }

  async create(ctx: AdminCtx, input: { name: string; description?: string; icon?: string }): Promise<BizCategory> {
    const err = validateCategoryName(input.name); if (err) throw new BizCatError('invalid', err);
    const slug = slugify(input.name);
    if (!slug) throw new BizCatError('invalid', 'Name must contain letters or numbers.');
    if (await this.repo.findBySlug(slug)) throw new BizCatError('conflict', `A category "${input.name}" already exists.`);
    const existing = await this.repo.list(true);
    const c = await this.repo.insert({ name: input.name.trim(), slug, description: input.description ?? null, icon: input.icon ?? null, sortOrder: nextSortOrder(existing), createdBy: ctx.userId ?? ctx.email ?? null });
    await this.audit(ctx, 'business_category_created', c.id, { name: c.name });
    return c;
  }

  async rename(ctx: AdminCtx, id: string, name: string): Promise<BizCategory> {
    const err = validateCategoryName(name); if (err) throw new BizCatError('invalid', err);
    const cur = await this.repo.get(id); if (!cur) throw new BizCatError('not_found', 'Category not found.');
    const c = await this.repo.update(id, { name: name.trim() }); // slug stays stable to avoid breaking references
    await this.audit(ctx, 'business_category_renamed', id, { from: cur.name, to: name.trim() });
    return c!;
  }

  async setActive(ctx: AdminCtx, id: string, active: boolean): Promise<BizCategory> {
    const cur = await this.repo.get(id); if (!cur) throw new BizCatError('not_found', 'Category not found.');
    const c = await this.repo.update(id, { active });
    await this.audit(ctx, active ? 'business_category_activated' : 'business_category_deactivated', id, {});
    return c!;
  }

  async reorder(ctx: AdminCtx, orderedIds: string[]): Promise<{ reordered: number }> {
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) throw new BizCatError('invalid', 'Provide an ordered list of category ids.');
    const known = new Set((await this.repo.list(true)).map((c) => c.id));
    for (const id of orderedIds) if (!known.has(id)) throw new BizCatError('invalid', `Unknown category: ${id}`);
    await this.repo.reorder(applyReorder(orderedIds));
    await this.audit(ctx, 'business_categories_reordered', '-', { count: orderedIds.length });
    return { reordered: orderedIds.length };
  }
}
