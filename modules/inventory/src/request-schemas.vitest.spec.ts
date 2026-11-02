// BUILD_PLAN Phase 12 (#17): the inventory routes' body validation, route by route on the real controllers — the bodies
// pos-web (inventoryApi + TenantInventoryScreen / TenantSuppliersScreen) and tech-web send today pass intact, unknown
// fields are stripped, a bad body is a 400 VALIDATION_FAILED naming the field, an undeclared tenantId is refused.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { InventoryController as V } from './inventory.controller';
import { TechnicianInventoryController as T } from './technician-inventory.controller';

const I = '22222222-2222-4222-8222-222222222222';
const c = (route: string, ctl: any, handler: string, today: Record<string, unknown>[], bad: [unknown, string]): RouteBodyCase => ({ route, ctl, handler, today, bad });
const CASES: RouteBodyCase[] = [
  c('POST /tenant/inventory/categories', V, 'addCat', [{ name: 'Gel polish', code: 'GEL', displayColor: '#ff00aa', sortOrder: 0, trackingMode: 'quantity' }], [{ name: ['Gel'] }, 'name']),
  c('PATCH /tenant/inventory/categories/:id', V, 'updCat', [{ name: 'Gel', sortOrder: 2 }], [{ sortOrder: { n: 2 } }, 'sortOrder']),
  c('POST /tenant/inventory/brands', V, 'addBrand', [{ name: 'DND', website: 'https://dnd.example' }], [{ name: 5 }, 'name']),
  c('PATCH /tenant/inventory/brands/:id', V, 'updBrand', [{ name: 'DND', notes: 'distributor' }], [{ notes: [] }, 'notes']),
  c('POST /tenant/inventory/vendors', V, 'addVendor', [{ name: 'Nail Supply Co', contactName: null, phone: '6095551234', email: null, leadTimeDays: '5' }], [{ name: 'x', email: { e: 1 } }, 'email']),
  c('PATCH /tenant/inventory/vendors/:id', V, 'updVendor', [{ name: 'Nail Supply', leadTimeDays: 7 }], [{ leadTimeDays: [7] }, 'leadTimeDays']),
  c('POST /tenant/inventory/products', V, 'create', [{ name: 'DND #428', colorName: 'Rose', colorNumber: '428', finish: null, sku: null, reorderLevel: 2, reorderQuantity: 6, costCents: 450, trackingMode: 'unit' }], [{ name: 'x', reorderLevel: { n: 1 } }, 'reorderLevel']),
  c('PATCH /tenant/inventory/products/:id', V, 'update', [{ buttonColor: null, imageUrl: null, barcode: '0123', upc: null, reorderLevel: 2, criticalLevel: 1, reorderQuantity: 6, maximumStock: 20, leadTimeDays: 5, preferredVendorId: I }, { retail_price_cents: 1200 }], [{ isRetail: 'yes' }, 'isRetail']),
  c('PATCH /tenant/inventory/products/:id/stock-overrides', V, 'setStockOverrides', [{ reorderLevelOverride: '3', criticalLevelOverride: null, reorderQuantityOverride: '', leadTimeDaysOverride: null, preferredVendorIdOverride: I }], [{ reorderLevelOverride: [3] }, 'reorderLevelOverride']),
  c('POST /tenant/inventory/products/:id/stock/add', V, 'addStock', [{ quantity: 6, lotNumber: null, expirationDate: null }], [{ quantity: 6, status: 'received' }, 'status']),
  c('POST /tenant/inventory/technician-reports/:id/reject', V, 'reject', [{}, { note: 'bottle was fine' }], [{ note: {} }, 'note']),
  c('POST /tenant/inventory/purchase-orders', V, 'createPO', [{ vendorId: I, expectedDate: null, shippingCents: 500, lines: [{ productId: I, quantityOrdered: 12, unitCostCents: 450 }] }], [{ vendorId: I, lines: { productId: I } }, 'lines']),
  c('POST /tenant/inventory/purchase-orders/:id/receive', V, 'receivePO', [{ lines: [{ lineId: I, quantity: 6 }, { lineId: I, quantity: 2, lotNumber: 'L1', expirationDate: '2027-01-01' }] }], [{ lines: [{ lineId: { id: I } }] }, 'lines[0].lineId']),
  c('POST /tenant/inventory/purchase-orders/:id/cancel', V, 'cancelPO', [{}, { note: 'vendor out of stock' }], [{ note: 1 }, 'note']),
  c('POST /tenant/inventory/transfers', V, 'createTransfer', [{ toBranchId: I, notes: null, lines: [{ productId: I, quantity: 4 }] }], [{ toBranchId: I, lines: [{ productId: I, quantity: {} }] }, 'lines[0].quantity']),
  c('POST /tenant/inventory/counts', V, 'createCount', [{ scopeType: 'all', notes: 'monthly' }, { scopeType: 'category', scopeId: I }], [{ scopeType: ['all'] }, 'scopeType']),
  c('POST /tenant/inventory/counts/:id/lines', V, 'enterCount', [{ lineId: I, countedQty: 7 }, { lineId: I, countedQty: null }], [{ lineId: I, countedQty: [7] }, 'countedQty']),
  c('PUT /tenant/inventory/recipes/:serviceId', V, 'setRecipe', [{ lines: [{ productId: I, quantity: 1 }] }], [{ lines: 'all' }, 'lines']),
  c('POST /tenant/inventory/recipes/:serviceId/consume', V, 'consumeRecipe', [{}, { multiplier: 2 }], [{ multiplier: { m: 2 } }, 'multiplier']),
  c('POST /tenant/inventory/receipt-expense', V, 'saveReceiptExpense', [{ vendor: 'Sally', amountCents: 4599, incurredOn: '2026-10-08', category: 'inventory', description: 'acetone' }], [{ amountCents: [1] }, 'amountCents']),
  c('POST /technician/inventory/reports', T, 'report', [{ reportType: 'bottle_low', productId: I, unitId: I, estimatedRemainingPercent: 20, note: 'almost out' }], [{ reportType: 'bottle_low', photoUrl: { u: 1 } }, 'photoUrl']),
];

describe('inventory — validated bodies, route by route', () => {
  for (const x of CASES) it(x.route, () => expect(routeBodyFailures(x, bodyPipeOf as any)).toEqual([]));
});
