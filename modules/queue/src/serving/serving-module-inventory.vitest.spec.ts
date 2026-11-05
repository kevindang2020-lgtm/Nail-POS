// serving-module-inventory.vitest.spec.ts — a retail sale moves stock (wave 4 PILOT, Oct 13 2026).
//
// Found by live-pilot-day.mjs: a Cuticle Oil sold to a guest (Pay app → ServingService.addRetail) wrote the ticket line and
// took the money, but the shelf still said 10. ServingModule injected InventoryService as OPTIONAL without importing
// InventoryModule (not @Global), so inside ServingModule the token never resolved: `stock` was undefined in every
// process and no retail sale — POS or phone — ever recorded `inventory_retail_sold`. The module must import it.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { InventoryModule } from '@aipowersalon/inventory';
import { ServingModule } from './serving.module';

describe('ServingModule wiring', () => {
  it('imports InventoryModule, so the optional InventoryService the retail sale moves stock with can resolve', () => {
    const imports: unknown[] = Reflect.getMetadata('imports', ServingModule) ?? [];
    expect(imports).toContain(InventoryModule);
  });
});
