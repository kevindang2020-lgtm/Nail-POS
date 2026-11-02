// ai-inventory-recipe.service.ts — service→supply recipe management (§11). The AI may PROPOSE a draft (source
// 'ai_proposed'); an authorized user (ai_inventory.manage_recipes) must review + approve before it drives any estimate.
// Reads require inventory.view; every write requires manage_recipes. Structural validation runs before persistence, and
// approval supersedes the prior approved version (enforced by the repo + a DB partial-unique index). No stock is mutated.
import { validateDraft, type RecipeDraftInput } from './ai-inventory-recipe.core';
import { requireInventoryView } from './ai-inventory-access';
import { AiInventoryError, AiInventoryErrorCode, type AiInventoryContext } from './ai-inventory.dto';
import {
  RecipeConflictError, RecipeNotFoundError,
  type Recipe, type RecipeRepositoryPort, type ListRecipeFilter,
} from './ai-inventory-recipe.repository';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

const MANAGE = 'ai_inventory.manage_recipes';

export class AiInventoryRecipeService {
  constructor(private readonly repo: RecipeRepositoryPort) {}

  private requireManage(ctx: AiInventoryContext) {
    if (!ctx.permissions.includes(MANAGE)) {
      throw withCode(new AiInventoryError(AiInventoryErrorCode.INSUFFICIENT_PERMISSION, `Missing ${MANAGE}`, 403), 'PERMISSION_DENIED');
    }
  }

  /** Create a DRAFT recipe (manual or AI-proposed). Requires manage_recipes; the draft is inert until approved. */
  async createDraft(ctx: AiInventoryContext, input: RecipeDraftInput): Promise<Recipe> {
    this.requireManage(ctx);
    const err = validateDraft(input);
    if (err) throw new AiInventoryError(AiInventoryErrorCode.INTERNAL_ERROR, err, 400);
    // A branch override, when given, must be the caller's own branch context (never a client-chosen foreign branch).
    if (input.branchId != null && input.branchId !== ctx.branchId) {
      throw withCode(new AiInventoryError(AiInventoryErrorCode.BRANCH_NOT_AUTHORIZED, 'Branch override must match the current branch context', 403), 'BRANCH_CONTEXT_MISMATCH');
    }
    return this.repo.createDraft(ctx.tenantId, ctx.userId, input);
  }

  async list(ctx: AiInventoryContext, filter: ListRecipeFilter = {}): Promise<{ recipes: Recipe[] }> {
    requireInventoryView(ctx);
    return { recipes: await this.repo.list(ctx.tenantId, filter) };
  }

  async get(ctx: AiInventoryContext, id: string): Promise<Recipe> {
    requireInventoryView(ctx);
    const r = await this.repo.get(ctx.tenantId, id);
    if (!r) throw withCode(new AiInventoryError(AiInventoryErrorCode.INVENTORY_NOT_FOUND, 'Recipe not found', 404), 'RECIPE_NOT_FOUND');
    return r;
  }

  /** Approve a draft → active version (supersedes the prior approved one for the same service/branch scope). */
  async approve(ctx: AiInventoryContext, id: string): Promise<Recipe> {
    this.requireManage(ctx);
    try {
      return await this.repo.approve(ctx.tenantId, id, ctx.userId);
    } catch (e) {
      if (e instanceof RecipeNotFoundError) throw withCode(new AiInventoryError(AiInventoryErrorCode.INVENTORY_NOT_FOUND, 'Recipe not found', 404), 'RECIPE_NOT_FOUND');
      if (e instanceof RecipeConflictError) throw new AiInventoryError(AiInventoryErrorCode.INTERNAL_ERROR, e.message, 409);
      throw e;
    }
  }

  async archive(ctx: AiInventoryContext, id: string): Promise<Recipe> {
    this.requireManage(ctx);
    try {
      return await this.repo.archive(ctx.tenantId, id);
    } catch (e) {
      if (e instanceof RecipeNotFoundError) throw withCode(new AiInventoryError(AiInventoryErrorCode.INVENTORY_NOT_FOUND, 'Recipe not found', 404), 'RECIPE_NOT_FOUND');
      if (e instanceof RecipeConflictError) throw new AiInventoryError(AiInventoryErrorCode.INTERNAL_ERROR, e.message, 409);
      throw e;
    }
  }
}
