// finance.module.ts — mounts THE expense authority. The ports that reach other domains (the Owner App's branch scope, the
// vendor directory, the owner audit trail, the AI category suggestion) are bound by apps/api (finance-wiring.ts) so this
// module depends on packages only and no module-to-module cycle forms (§105). Until bound, the branch scope REFUSES —
// it never silently widens to the whole salon.
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { ExpenseService, type BranchScopePort } from './expense.service';
import { ExpenseController } from './expense.controller';
import { ExpenseError } from './expense-errors';
import { BillReminderScheduler } from './bill-reminder.scheduler';

export class UnboundBranchScope implements BranchScopePort {
  async resolve(): Promise<never> { throw new ExpenseError('EXPENSE_ACCESS_DENIED', 'Expense access is not configured on this server.'); }
}

@Module({
  imports: [EventsCoreModule],
  controllers: [ExpenseController],
  providers: [{ provide: ExpenseService, useFactory: (db: AppDatabase, outbox: OutboxWriter) => new ExpenseService(db as never, new UnboundBranchScope(), outbox ?? null), inject: [DATABASE, OutboxWriter] }, BillReminderScheduler],
  exports: [ExpenseService, BillReminderScheduler],
})
export class FinanceModule {}
