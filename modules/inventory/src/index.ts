// modules/inventory — the inventory domain (Constitution 13 Phase 6): the ONE public entry point (§97). The API composes the Nest
// module and imports ONLY from here; every other file in this module is internal (§98–99).

export { InventoryModule } from './inventory.module';
export { reorderSuggestion, stockStatus } from './inventory-core';   // used by the API today
export { InventoryService, type ReceiptExpenseWriter, type InvCtx } from './inventory.service';   // used by the API today
export { PURCHASE_ORDER, INVENTORY_COUNT } from './inventory-lifecycles';   // BUILD_PLAN Phase 12 (#27): this module's lifecycle state machines
export { liveAlertState, openAlertCount, type LiveAlertRow, type LiveSeverity } from './stock-alert-state';   // Stock Alerts mandate (Oct 29 2026): THE alert scope — the tenants sidebar badge reads it too
