import { RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Idempotent } from '@aipowersalon/database/nest';   // Constitution 5 §61–66
import { Controller, Get, Post, Req, Body, Query } from '@nestjs/common';
import { CashDrawerService } from './cash-drawer.service';
import { drawerCtx, drawerRun } from './cash-drawer.http';
import { ListQueries } from '@aipowersalon/database';
import { CashDrawerPosControllerListQueries } from './cash-drawer.pos.list-queries';

import { DRAWER_MOVEMENT_BODY, DRAWER_OPEN_BODY, DRAWER_RECONCILE_BODY, DRAWER_VOID_MOVEMENT_BODY } from '../request-schemas';   // BUILD_PLAN Phase 12 (#17)
// POS / front desk: register cash drawer — set the opening float, see expected cash, count and reconcile.
// Constitution 5 Step 8 audit (Oct 4 2026): the salon-wide READS here had no check (the writes check
// pos.checkout.take_payment in the service), so a technician could read the register and every technician's cash
// hand-offs. Keyed like the POS checkout reads: owner, manager, front desk, reception. Technicians read their own via /tech/me/*.
@ListQueries(CashDrawerPosControllerListQueries)
@Controller('pos')
export class CashDrawerPosController {
  constructor(private readonly svc: CashDrawerService) {}
  @RequirePermission('pos.checkout.view') @Get('cash-drawer') get(@Req() r: any, @Query('date') date?: string, @Query('registerId') registerId?: string) { return drawerRun(() => this.svc.getDrawer(drawerCtx(r), date, registerId)); }
  @RequirePermission('checkout.process_payment') @Post('cash-drawer/open') open(@Req() r: any, @Body(ValidatedBody(DRAWER_OPEN_BODY, { strict: true })) b: any) { return drawerRun(() => this.svc.openDrawer(drawerCtx(r), b || {})); }
  @RequirePermission('checkout.process_payment') @Post('cash-drawer/reconcile') reconcile(@Req() r: any, @Body(ValidatedBody(DRAWER_RECONCILE_BODY, { strict: true })) b: any) { return drawerRun(() => this.svc.reconcileDrawer(drawerCtx(r), b || {})); }
  @RequirePermission('checkout.process_payment') @Post('cash-drawer/movement') movement(@Req() r: any, @Body(ValidatedBody(DRAWER_MOVEMENT_BODY, { strict: true })) b: any) { return drawerRun(() => this.svc.addMovement(drawerCtx(r), b || {})); }
  @RequirePermission('pos.checkout.view') @Get('cash-drawer/movements') movements(@Req() r: any, @Query('date') date?: string, @Query('registerId') registerId?: string) { return drawerRun(() => this.svc.listMovements(drawerCtx(r), date, registerId)); }
  @Idempotent() @RequirePermission('checkout.process_payment') @Post('cash-drawer/movement/void') voidMovement(@Req() r: any, @Body(ValidatedBody(DRAWER_VOID_MOVEMENT_BODY, { strict: true })) b: any) { return drawerRun(() => this.svc.voidMovement(drawerCtx(r), b || {})); }
}
