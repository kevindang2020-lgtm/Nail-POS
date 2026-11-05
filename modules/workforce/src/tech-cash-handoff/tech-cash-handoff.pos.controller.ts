import { RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Req, Body, Param, Query } from '@nestjs/common';
import { TechCashHandoffService } from './tech-cash-handoff.service';
import { tchCtx, tchRun } from './tech-cash-handoff.http';
import { ListQueries } from '@aipowersalon/database';
import { TechCashHandoffPosControllerListQueries } from './tech-cash-handoff.pos.list-queries';
import { CASH_HANDOFF_RECONCILE_BODY } from '../request-schemas';

// POS / front desk: end-of-day cash board — every tech's expected cash, count it, reconcile.
// Constitution 5 Step 8 audit (Oct 4 2026): the salon-wide READS here had no check (the writes check
// pos.checkout.take_payment in the service), so a technician could read the register and every technician's cash
// hand-offs. Keyed like the POS checkout reads: owner, manager, front desk, reception. Technicians read their own via /tech/me/*.
@ListQueries(TechCashHandoffPosControllerListQueries)
@Controller('pos')
export class TechCashHandoffPosController {
  constructor(private readonly svc: TechCashHandoffService) {}
  @RequirePermission('pos.checkout.view') @Get('cash-handoffs') list(@Req() r: any, @Query('date') date?: string) { return tchRun(() => this.svc.posList(tchCtx(r), date)); }
  @RequirePermission('pos.checkout.view') @Get('cash-handoffs/:technicianId') detail(@Req() r: any, @Param('technicianId') id: string, @Query('date') date?: string) { return tchRun(() => this.svc.posTechDetail(tchCtx(r), id, date)); }
  @RequirePermission('checkout.process_payment') @Post('cash-handoffs/:technicianId/reconcile') reconcile(@Req() r: any, @Param('technicianId') id: string, @Body(ValidatedBody(CASH_HANDOFF_RECONCILE_BODY)) b: any) { return tchRun(() => this.svc.posReconcile(tchCtx(r), id, b || {})); }
}
