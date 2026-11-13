// round 10 (Inventory 10): Add Stock is an @Idempotent route — a retry with the same Idempotency-Key is answered from the first
// save by the shared interceptor (packages/database/src/nest/idempotency.ts), never added twice. The key stays optional.
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { InventoryController } from './inventory.controller';

describe('Add Stock idempotency', () => {
  it('the route carries the idempotency metadata (optional key) like PO receive / transfer receive', () => {
    const meta = (h: string) => Reflect.getMetadata('aps:idempotent', (InventoryController.prototype as unknown as Record<string, unknown>)[h] as object);
    expect(meta('addStock')).toEqual({ required: false });
    expect(meta('receivePO')).toEqual({ required: false });
  });
});
