// ai-inventory-access.ts — shared authorization helpers so every ai_inventory analysis service applies the SAME gate and
// the SAME cost-visibility rule (no drift). Feature access (pos.ai_inventory.view) is enforced at the controller; these
// enforce the authoritative DATA permission (inventory.view) and cost-blindness (technicians never see cost/margin).
import { AiInventoryError, AiInventoryErrorCode, type AiInventoryContext } from './ai-inventory.dto';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export function requireInventoryView(ctx: AiInventoryContext): void {
  if (!ctx.permissions.includes('inventory.view')) {
    throw withCode(new AiInventoryError(AiInventoryErrorCode.INSUFFICIENT_PERMISSION, 'Missing inventory.view', 403), 'PERMISSION_DENIED');
  }
}

/** Whether the caller may see cost / margin. Techs without an explicit grant never do.
 *  BUILD_PLAN Phase 9: no role name — the technician's LIMITED inventory view (inventory.view_limited) is what keeps
 *  cost hidden; an explicit cost grant (inventory.cost.view, or the AI-specific ai_inventory.view_cost) shows it. */
export function costVisible(ctx: AiInventoryContext): boolean {
  if (ctx.permissions.includes('ai_inventory.view_cost') || ctx.permissions.includes('inventory.cost.view')) return true;
  return !ctx.permissions.includes('inventory.view_limited') && ctx.permissions.includes('inventory.view');
}
