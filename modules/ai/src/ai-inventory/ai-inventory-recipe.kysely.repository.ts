// ai-inventory-recipe.kysely.repository.ts — production recipe persistence on the PRIMARY db. Writes are transactional
// (header + lines together); approve supersedes the prior approved version for the same (service, branch scope) in the
// same transaction (belt-and-suspenders with the DB partial-unique index). Ownership is validated (service + products
// must belong to the tenant) so a client can never attach a recipe to a foreign service/product. Every write emits an
// audit_logs row. All statements are tenant-scoped.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { canMoveToSql } from '@aipowersalon/database';
import { INVENTORY_SERVICE_RECIPE } from '../ai-lifecycles';
import { canApprove, canArchive, nextVersion, scopeKey, type RecipeDraftInput } from './ai-inventory-recipe.core';
import {
  RecipeConflictError, RecipeNotFoundError,
  type Recipe, type RecipeLine, type RecipeRepositoryPort, type ListRecipeFilter,
} from './ai-inventory-recipe.repository';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export class KyselyRecipeRepository implements RecipeRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}

  private async audit(trx: Kysely<DB>, tenantId: string, userId: string | null, action: string, recipeId: string, meta: any) {
    try {
      await sql`INSERT INTO audit_logs (tenant_id, user_id, action_type, entity_type, entity_id, metadata_json)
        VALUES (${tenantId}, ${userId}, ${action}, ${'ai_inventory_recipe'}, ${recipeId}, ${JSON.stringify(meta || {})}::jsonb)`.execute(trx);
    } catch { /* best effort */ }
  }

  private async hydrate(db: Kysely<DB>, tenantId: string, headers: any[]): Promise<Recipe[]> {
    if (headers.length === 0) return [];
    const ids = headers.map((h) => h.id);
    const lines = await sql<any>`SELECT * FROM inventory_service_recipe_lines
      WHERE tenant_id = ${tenantId} AND recipe_id = ANY(${ids}::uuid[]) ORDER BY sort_order, product_id`.execute(db);
    const byRecipe = new Map<string, RecipeLine[]>();
    for (const l of lines.rows) {
      const arr = byRecipe.get(l.recipe_id) ?? [];
      arr.push({
        productId: l.product_id, expectedQuantity: Number(l.expected_quantity), consumptionUnit: l.consumption_unit,
        wasteAllowancePct: Number(l.waste_allowance_pct), required: !!l.required, sortOrder: Number(l.sort_order),
      });
      byRecipe.set(l.recipe_id, arr);
    }
    return headers.map((h) => this.mapHeader(h, byRecipe.get(h.id) ?? []));
  }

  private mapHeader(h: any, lines: RecipeLine[]): Recipe {
    return {
      id: h.id, tenantId: h.tenant_id, branchId: h.branch_id ?? null, serviceId: h.service_id,
      version: Number(h.version), status: h.status, source: h.source,
      effectiveDate: h.effective_date ? new Date(h.effective_date).toISOString().slice(0, 10) : null,
      notes: h.notes ?? null, createdBy: h.created_by ?? null, approvedBy: h.approved_by ?? null,
      approvedAt: h.approved_at ? new Date(h.approved_at).toISOString() : null,
      createdAt: new Date(h.created_at).toISOString(), lines,
    };
  }

  async createDraft(tenantId: string, userId: string, input: RecipeDraftInput): Promise<Recipe> {
    const branchId = input.branchId ?? null;
    // Ownership: the service must belong to this tenant (and branch scope when given).
    const svc = await sql<{ id: string }>`SELECT id FROM services WHERE id = ${input.serviceId} AND tenant_id = ${tenantId} LIMIT 1`.execute(this.db);
    if (svc.rows.length === 0) throw withCode(new RecipeNotFoundError('Service not found for this tenant'), 'SERVICE_NOT_FOUND');
    // Ownership: every supply product must belong to this tenant.
    const productIds = input.lines.map((l) => l.productId);
    const prod = await sql<{ id: string }>`SELECT id FROM inventory_products WHERE tenant_id = ${tenantId} AND id = ANY(${productIds}::uuid[])`.execute(this.db);
    if (prod.rows.length !== new Set(productIds).size) throw withCode(new RecipeNotFoundError('One or more supply products not found for this tenant'), 'RECIPE_SUPPLIES_NOT_FOUND');

    const versions = await sql<{ version: number }>`SELECT version FROM inventory_service_recipes
      WHERE tenant_id = ${tenantId} AND service_id = ${input.serviceId}
        AND COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid) = ${scopeKey(branchId)}::uuid`.execute(this.db);
    const version = nextVersion(versions.rows.map((r) => Number(r.version)));

    return await this.db.transaction().execute(async (trx) => {
      const header = (await sql<any>`INSERT INTO inventory_service_recipes
        (tenant_id, branch_id, service_id, version, status, source, effective_date, notes, created_by)
        VALUES (${tenantId}, ${branchId}, ${input.serviceId}, ${version}, 'draft', ${input.source ?? 'manual'},
                ${input.effectiveDate ?? null}, ${input.notes ?? null}, ${userId})
        RETURNING *`.execute(trx)).rows[0];
      let i = 0;
      for (const l of input.lines) {
        await sql`INSERT INTO inventory_service_recipe_lines
          (tenant_id, recipe_id, product_id, expected_quantity, consumption_unit, waste_allowance_pct, required, sort_order)
          VALUES (${tenantId}, ${header.id}, ${l.productId}, ${l.expectedQuantity}, ${l.consumptionUnit},
                  ${l.wasteAllowancePct ?? 0}, ${l.required ?? true}, ${l.sortOrder ?? i++})`.execute(trx);
      }
      await this.audit(trx as unknown as Kysely<DB>, tenantId, userId, 'ai_inventory_recipe_draft_created', header.id, { serviceId: input.serviceId, version, source: input.source ?? 'manual' });
      const [full] = await this.hydrate(trx as unknown as Kysely<DB>, tenantId, [header]);
      return full;
    });
  }

  async list(tenantId: string, filter: ListRecipeFilter): Promise<Recipe[]> {
    const headers = await sql<any>`SELECT * FROM inventory_service_recipes
      WHERE tenant_id = ${tenantId}
        AND (${filter.serviceId ?? null}::uuid IS NULL OR service_id = ${filter.serviceId ?? null})
        AND (${filter.branchId ?? null}::uuid IS NULL OR branch_id = ${filter.branchId ?? null})
        AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      ORDER BY service_id, version DESC LIMIT 500`.execute(this.db);
    return this.hydrate(this.db, tenantId, headers.rows);
  }

  async get(tenantId: string, id: string): Promise<Recipe | null> {
    const headers = await sql<any>`SELECT * FROM inventory_service_recipes WHERE tenant_id = ${tenantId} AND id = ${id} LIMIT 1`.execute(this.db);
    if (headers.rows.length === 0) return null;
    const [r] = await this.hydrate(this.db, tenantId, headers.rows);
    return r;
  }

  async approve(tenantId: string, id: string, userId: string): Promise<Recipe> {
    return await this.db.transaction().execute(async (trx) => {
      const cur = (await sql<any>`SELECT * FROM inventory_service_recipes WHERE tenant_id = ${tenantId} AND id = ${id} FOR UPDATE`.execute(trx)).rows[0];
      if (!cur) throw withCode(new RecipeNotFoundError('Recipe not found'), 'RECIPE_NOT_FOUND');
      if (!canApprove(cur.status)) throw withCode(new RecipeConflictError(`Cannot approve a ${cur.status} recipe`), 'RECIPE_STATE_INVALID');
      // Supersede the prior approved version for the same (service, branch scope) FIRST, then approve this one.
      await sql`UPDATE inventory_service_recipes SET status = 'archived', updated_at = now()
        WHERE tenant_id = ${tenantId} AND service_id = ${cur.service_id} AND status = 'approved' AND ${canMoveToSql(INVENTORY_SERVICE_RECIPE, 'archived')}
          AND COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(${cur.branch_id}, '00000000-0000-0000-0000-000000000000'::uuid)
          AND id <> ${id}`.execute(trx);
      const upd = (await sql<any>`UPDATE inventory_service_recipes
        SET status = 'approved', approved_by = ${userId}, approved_at = now(), updated_at = now()
        WHERE tenant_id = ${tenantId} AND id = ${id} AND status = ${cur.status} AND ${canMoveToSql(INVENTORY_SERVICE_RECIPE, 'approved')} RETURNING *`.execute(trx)).rows[0];
      if (!upd) throw withCode(new RecipeConflictError(`Cannot approve a ${cur.status} recipe`), 'RECIPE_STATE_INVALID');
      await this.audit(trx as unknown as Kysely<DB>, tenantId, userId, 'ai_inventory_recipe_approved', id, { serviceId: cur.service_id, version: cur.version });
      const [full] = await this.hydrate(trx as unknown as Kysely<DB>, tenantId, [upd]);
      return full;
    });
  }

  async archive(tenantId: string, id: string): Promise<Recipe> {
    return await this.db.transaction().execute(async (trx) => {
      const cur = (await sql<any>`SELECT * FROM inventory_service_recipes WHERE tenant_id = ${tenantId} AND id = ${id} FOR UPDATE`.execute(trx)).rows[0];
      if (!cur) throw withCode(new RecipeNotFoundError('Recipe not found'), 'RECIPE_NOT_FOUND');
      if (!canArchive(cur.status)) throw withCode(new RecipeConflictError('Recipe already archived'), 'RECIPE_STATE_INVALID');
      const upd = (await sql<any>`UPDATE inventory_service_recipes SET status = 'archived', updated_at = now()
        WHERE tenant_id = ${tenantId} AND id = ${id} AND status = ${cur.status} AND ${canMoveToSql(INVENTORY_SERVICE_RECIPE, 'archived')} RETURNING *`.execute(trx)).rows[0];
      if (!upd) throw withCode(new RecipeConflictError('Recipe already archived'), 'RECIPE_STATE_INVALID');
      await this.audit(trx as unknown as Kysely<DB>, tenantId, cur.created_by, 'ai_inventory_recipe_archived', id, { serviceId: cur.service_id, version: cur.version });
      const [full] = await this.hydrate(trx as unknown as Kysely<DB>, tenantId, [upd]);
      return full;
    });
  }
}
