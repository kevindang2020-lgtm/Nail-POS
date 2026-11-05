// hardware-payment.cron.controller.ts — external-scheduler trigger for the monthly run ("point cron at run-monthly").
// Guarded by a shared secret (header 'x-cron-secret' must equal HARDWARE_PAYMENT_CRON_SECRET); 403 unless the env secret
// is set AND matches, so it's disabled by default and unauthenticated callers can't reach it. No session needed, so a
// plain `curl` from system cron / a cloud scheduler works. Orchestrates: pull Fiserv residuals (if configured), then
// reconcile every active plan for the month. Defaults to the month that just closed.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { HW_RUN_MONTHLY_BODY } from '../request-schemas';
import { requireServiceCaller, ServiceAuthError, type ServiceScope } from '@aipowersalon/auth';
import { Controller, Post, Body, Req, HttpException, HttpStatus } from '@nestjs/common';
import { HardwarePaymentReconciliationJob, previousBillingMonth } from './hardware-payment.reconciliation-job';
import { FiservResidualImportService } from './hardware-payment.residual-import';

/** Constitution 3 Step 6: the shared service-caller check, mapped to this route's HTTP errors. */
function serviceCaller(r: any, scope: ServiceScope, legacy: { name: string; secret: string | undefined; header: string }) {
  try { return requireServiceCaller(r, scope, legacy); }
  catch (e) { if (e instanceof ServiceAuthError) throw new HttpException(e.status === 403 ? 'Forbidden' : e.message, e.status); throw e; }
}

@Controller('internal/hardware-payment')
export class HardwarePaymentCronController {
  constructor(private readonly job: HardwarePaymentReconciliationJob, private readonly residual: FiservResidualImportService) {}

  @Post('run-monthly')
  async runMonthly(@Req() r: any, @Body(ValidatedBody(HW_RUN_MONTHLY_BODY)) b: any) {
    serviceCaller(r, 'hardware_payment.sweep', { name: 'HARDWARE_PAYMENT_CRON_SECRET', secret: process.env.HARDWARE_PAYMENT_CRON_SECRET, header: 'x-cron-secret' });
    const month = (b?.billingMonth && /^\d{4}-\d{2}$/.test(String(b.billingMonth))) ? String(b.billingMonth) : previousBillingMonth();
    const residualPull = process.env.FISERV_RESIDUAL_URL ? await this.residual.importFromFiserv(month) : { configured: false };
    const summary = await this.job.runMonthly(month);
    return { month, residualPull, summary };
  }
}
