// gift-card-settlement.controller.ts — Super-Admin cross-tenant clearing settlement surface (spec §16/§33). Behind
// SuperAdminGuard (platform operators only). Group pending obligations into batches and advance them through the
// reviewed lifecycle; the receivable/payable rollup is read-only. No money moves here.
import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { GiftCardSettlementService, GiftCardSettlementError } from './gift-card-settlement.service';
import { GC_SETTLEMENT_BATCH_BODY, GC_SETTLEMENT_STATUS_BODY } from '../request-schemas-oversight';   // BUILD_PLAN Phase 12 (#17)

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) { if (e instanceof GiftCardSettlementError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST); throw e; }
}
const userIdOf = (r: any): string | null => r?.ctx?.userId ?? r?.user?.id ?? r?.user?.userId ?? null;

@Controller('super-admin/gift-cards/settlement')
@UseGuards(SuperAdminGuard)
export class GiftCardSettlementController {
  constructor(private readonly svc: GiftCardSettlementService) {}

  @Get() state() { return run(() => this.svc.getState()); }
  @Post('batches') create(@Body(ValidatedBody(GC_SETTLEMENT_BATCH_BODY, { strict: true })) b: any) { return run(() => this.svc.createBatch(b ?? {})); }
  @Get('batches/:id') batch(@Param('id') id: string) { return run(() => this.svc.getBatch(id)); }
  @Patch('batches/:id') setStatus(@Param('id') id: string, @Body(ValidatedBody(GC_SETTLEMENT_STATUS_BODY, { strict: true })) b: any, @Req() r: any) { return run(() => this.svc.setBatchStatus(id, b ?? {}, userIdOf(r))); }
}
