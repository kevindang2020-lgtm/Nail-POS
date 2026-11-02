// finance-wiring.ts — the API's composition root binds the finance module's ports (Constitution 13: cross-module
// composition lives here, not inside a module; finance depends on packages only, so no module cycle forms).
//
//   ExpenseService.scopes   ← OwnerService.resolveBranchScope   (ONE branch rule for the Owner App and finance)
//   ExpenseService.audit    ← AuditService.record + the Owner App's own audit trail
//   ExpenseService.vendors  ← InventoryService.createVendor     (ONE vendor directory)
//   OwnerService.expenses   ← ExpenseService                    (the older /owner/expenses* routes delegate)
//   InventoryService.receiptExpenses ← ExpenseService.create    (the older scan-receipt "save as expense" delegates)
//
// The AI category port stays unbound: the deterministic engine (owner rule → vendor rule → system rule → Other) is the
// production path, and nothing here fabricates a suggestion when no AI provider is configured (mandate §61, no mock).
import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { ExpenseService, FinanceModule } from '@aipowersalon/finance';
import { OwnerModule, OwnerService } from '@aipowersalon/analytics';
import { InventoryModule, InventoryService } from '@aipowersalon/inventory';
import { AuditService } from '@aipowersalon/audit';
import { bindFinancePorts } from './finance-bindings';
export { bindFinancePorts, ownerExpensesFor, receiptWriterFor, ownerToExpenseError } from './finance-bindings';

@Injectable()
export class FinanceWiring implements OnModuleInit {
  constructor(private readonly expenses: ExpenseService, private readonly owner: OwnerService, private readonly inventory: InventoryService, private readonly audit: AuditService) {}
  onModuleInit(): void { bindFinancePorts(this.expenses, this.owner, this.inventory, this.audit); }
}

@Module({ imports: [FinanceModule, OwnerModule, InventoryModule], providers: [FinanceWiring] })
export class FinanceWiringModule {}
