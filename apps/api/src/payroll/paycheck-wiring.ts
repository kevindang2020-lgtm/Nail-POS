// paycheck-wiring.ts — the API's composition root binds the weekly paycheck's register-drawer port (Constitution 13:
// cross-module composition lives here; checkout depends on workforce, so workforce never imports checkout).
//
//   PayrollPaycheckService.cashDrawer ← CashDrawerRepository (payroll cash from a POS drawer is a linked
//                                       PAYROLL_CASH_PAYOUT movement in the SAME transaction as the payout; canceling
//                                       the cash voids that movement; the drawer's expected cash is what may be taken)
import { Injectable, Module, Optional, type OnModuleInit } from '@nestjs/common';
import { PayrollModule, PayrollPaycheckService, type PayrollCashDrawerPort } from '@aipowersalon/workforce';
import { CashDrawerModule, CashDrawerRepository } from '@aipowersalon/checkout';

/** the drawer seen through the payroll port (plain function: the harnesses bind it the same way) */
export function payrollCashDrawerFor(repo: CashDrawerRepository): PayrollCashDrawerPort {
  const dctx = (c: { tenantId: string; branchId?: string | null; userId?: string | null; role?: string | null; permissions?: string[] }) => ({ tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId ?? null, role: c.role ?? undefined, permissions: c.permissions ?? [] });
  return {
    availableCents: (ctx, x) => repo.availableNow(dctx(ctx), x.branchId, x.registerId),
    withdraw: (trx, ctx, x) => repo.payrollWithdraw(trx, dctx(ctx), x),
    reverse: (trx, ctx, movementId) => repo.payrollReverse(trx, dctx(ctx), movementId),
  };
}

@Injectable()
export class PaycheckWiring implements OnModuleInit {
  constructor(@Optional() private readonly paychecks: PayrollPaycheckService | null, private readonly drawer: CashDrawerRepository) {}
  onModuleInit(): void { if (this.paychecks) this.paychecks.cashDrawer = payrollCashDrawerFor(this.drawer); }
}

@Module({ imports: [PayrollModule, CashDrawerModule], providers: [PaycheckWiring] })
export class PaycheckWiringModule {}
