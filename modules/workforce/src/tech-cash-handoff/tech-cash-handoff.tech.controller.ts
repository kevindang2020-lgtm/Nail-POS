import { RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Req, Body, Query } from '@nestjs/common';
import { TechCashHandoffService } from './tech-cash-handoff.service';
import { tchCtx, tchRun } from './tech-cash-handoff.http';
import { ListQueries } from '@aipowersalon/database';
import { TechCashHandoffTechControllerListQueries } from './tech-cash-handoff.tech.list-queries';
import { CASH_HANDOFF_SUBMIT_BODY } from '../request-schemas';

// Technician app: see the cash I collected today and hand it off to the front desk.
@ListQueries(TechCashHandoffTechControllerListQueries)
@Controller('tech')
export class TechCashHandoffTechController {
  constructor(private readonly svc: TechCashHandoffService) {}
  @RequirePermission('tech.cash.manage') @Get('me/cash-handoff') mine(@Req() r: any, @Query('date') date?: string) { return tchRun(() => this.svc.techMyHandoff(tchCtx(r), date)); }
  @RequirePermission('tech.cash.manage') @Post('cash-handoff/submit') submit(@Req() r: any, @Body(ValidatedBody(CASH_HANDOFF_SUBMIT_BODY, { strict: true })) b: any) { return tchRun(() => this.svc.techSubmit(tchCtx(r), b?.date)); }
}
