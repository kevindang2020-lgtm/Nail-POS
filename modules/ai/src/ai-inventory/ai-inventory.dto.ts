// ai-inventory.dto.ts — shared context, error taxonomy, and DTOs for the AI Inventory Assistant.
// Context is server-derived (never client), structurally identical to the authoritative inventory service's InvCtx so
// tools can pass it straight through. Errors use the project-compatible AI_INVENTORY_* taxonomy (§81 subset).
import type { InventoryPosition } from './ai-inventory-core';

export interface AiInventoryContext {
  tenantId: string;
  branchId: string;
  userId: string;
  role: string;
  permissions: string[];
}

export enum AiInventoryErrorCode {
  AI_INVENTORY_DISABLED = 'AI_INVENTORY_DISABLED',
  INSUFFICIENT_PERMISSION = 'INSUFFICIENT_PERMISSION',
  BRANCH_NOT_AUTHORIZED = 'BRANCH_NOT_AUTHORIZED',
  PRODUCT_NOT_FOUND = 'PRODUCT_NOT_FOUND',
  PRODUCT_NOT_AUTHORIZED = 'PRODUCT_NOT_AUTHORIZED',
  INVENTORY_NOT_FOUND = 'INVENTORY_NOT_FOUND',
  DATA_DELAYED = 'DATA_DELAYED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export class AiInventoryError extends Error {
  constructor(public code: AiInventoryErrorCode, message: string, public status = 400) {
    super(message);
    this.name = 'AiInventoryError';
  }
}

/** One product's authoritative stock snapshot at a branch (cost fields present only when the caller may see them). */
export interface ProductStockRow {
  productId: string;
  name: string;
  sku: string | null;
  categoryName: string | null;
  inventoryType: string | null; // retail | consumable | ... (from the product row when present)
  onHand: number;               // usable on-hand (unopened+opened+low)
  reserved: number;
  damaged: number;
  expired: number;
  quarantined: number;
  confirmedInbound: number;     // open PO qty (approved|ordered|partial) not yet received, at this branch
  reorderLevel: number;
  reorderQuantity: number;
  criticalLevel: number | null;
  maximumStock: number | null;
  costCents: number | null;     // stripped for cost-blind roles
  retailPriceCents: number | null;
  preferredVendorId: string | null;
  vendorName: string | null;
  vendorLeadTimeDays: number | null; // from the preferred vendor; null when unknown
  updatedAt: string | null;     // stock freshness
}

/** Combined stock + movement-velocity snapshot for slow-moving analysis (§20). Read-only. */
export interface SlowMovingInputRow {
  productId: string;
  name: string;
  sku: string | null;
  categoryName: string | null;
  inventoryType: string | null;
  onHand: number;
  costCents: number | null;
  maximumStock: number | null;
  productAgeDays: number;
  daysSinceLastSale: number | null;
  daysSinceLastUsage: number | null;
  retailUnitsInWindow: number;
  consumptionUnitsInWindow: number;
  /** extras (AI Inventory 15): units written off in the window (damaged / waste / expired movements); absent = 0 */
  wasteUnitsInWindow?: number;
}

export interface ProductPosition {
  productId: string;
  name: string;
  sku: string | null;
  categoryName: string | null;
  inventoryType: string | null;
  position: InventoryPosition;
  costCents: number | null;
  retailPriceCents: number | null;
  updatedAt: string | null;
}

export interface InventoryContextSummary {
  tenantId: string;
  branchId: string;
  productCount: number;
  inStock: number;
  low: number;
  critical: number;
  outOfStock: number;
  overstock: number;
  costVisible: boolean;
  inboundWired: boolean; // honest: whether PO/transfer inbound is folded into positions yet
  generatedAt: string;
}
