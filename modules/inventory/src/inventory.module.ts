// inventory.module.ts — canonical tenant Inventory module (manager + technician surfaces).
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { InventoryService, PO_APPROVALS_TOKEN, type PurchaseOrderApprovalsPort } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { TechnicianInventoryController } from './technician-inventory.controller';

@Module({
  controllers: [InventoryController, TechnicianInventoryController],
  imports: [EventsCoreModule],   // the outbox writer — inventory.adjusted / inventory.low_stock (Oct 3 2026)
  // BUILD_PLAN Phase 9: purchase-order approvals ride the salon approvals engine when the process has it (@Global token, optional)
  providers: [{ provide: InventoryService, useFactory: (db: AppDatabase, outbox: OutboxWriter, approvals?: PurchaseOrderApprovalsPort | null) => new InventoryService(db, undefined, outbox ?? null).useApprovals(approvals ?? null), inject: [DATABASE, OutboxWriter, { token: PO_APPROVALS_TOKEN, optional: true }] }],
  exports: [InventoryService],
})
export class InventoryModule {}
