// inventory.module.ts — canonical tenant Inventory module (manager + technician surfaces).
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { InventoryService, PO_APPROVALS_TOKEN, type PurchaseOrderApprovalsPort } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { TechnicianInventoryController } from './technician-inventory.controller';
import { StockAlertsController, STOCK_ALERTS_REPOSITORY } from './stock-alerts.controller';
import { StockAlertsRepository } from './stock-alerts.repository';
import { InventoryScreenController, INVENTORY_SCREEN_REPOSITORY } from './inventory-screen.controller';
import { InventoryScreenRepository } from './inventory-screen.repository';
import { SuppliersScreenController, SUPPLIERS_SCREEN_REPOSITORY } from './suppliers-screen.controller';
import { SuppliersScreenRepository } from './suppliers-screen.repository';

@Module({
  controllers: [InventoryController, TechnicianInventoryController, StockAlertsController, InventoryScreenController, SuppliersScreenController],
  imports: [EventsCoreModule],   // the outbox writer — inventory.adjusted / inventory.low_stock (Oct 3 2026)
  // BUILD_PLAN Phase 9: purchase-order approvals ride the salon approvals engine when the process has it (@Global token, optional)
  providers: [{ provide: InventoryService, useFactory: (db: AppDatabase, outbox: OutboxWriter, approvals?: PurchaseOrderApprovalsPort | null, rt?: RealtimeEmitter | null) => new InventoryService(db, undefined, outbox ?? null, rt ?? null).useApprovals(approvals ?? null), inject: [DATABASE, OutboxWriter, { token: PO_APPROVALS_TOKEN, optional: true }, { token: REALTIME, optional: true }] },
    // Stock Alerts mandate (Oct 29 2026): the Stock Alerts / product-usage read model (null without a database → 503)
    { provide: STOCK_ALERTS_REPOSITORY, useFactory: (db: AppDatabase | null) => (db ? new StockAlertsRepository(db as never) : null), inject: [DATABASE] },
    // Inventory / Products / Suppliers mandates (Oct 29 2026): the eight-tab Inventory, Products and Suppliers read models
    { provide: INVENTORY_SCREEN_REPOSITORY, useFactory: (db: AppDatabase | null) => (db ? new InventoryScreenRepository(db as never) : null), inject: [DATABASE] },
    { provide: SUPPLIERS_SCREEN_REPOSITORY, useFactory: (db: AppDatabase | null) => (db ? new SuppliersScreenRepository(db as never) : null), inject: [DATABASE] }],
  exports: [InventoryService],
})
export class InventoryModule {}
