// overage.controller.ts — Super Admin overage metering surface (under SuperAdminGuard). Recompute is permission-gated
// in the service and audited. The per-metric summary (tenants/revenue) is served via the plans overview aggregate.
import { Controller, Post, Get, Put, Body, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { OverageService, OverageForbiddenError, type OverageActor } from './overage.service';
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { OVERAGE_RULES_BODY } from '../request-schemas';

@UseGuards(SuperAdminGuard)
@Controller('super-admin/plans/overage')
export class OverageController {
  constructor(private readonly svc: OverageService) {}

  private actor(req: any): OverageActor { return { userId: req?.ctx?.userId, role: req?.ctx?.role, permissions: req?.ctx?.permissions ?? [] }; }
  private wrap(e: any): never {
    if (e instanceof OverageForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    throw new HttpException(e?.message || 'Overage action failed', HttpStatus.BAD_REQUEST);
  }

  @Get('rules')
  async rules() {
    try { return await this.svc.getRules(); } catch (e) { this.wrap(e); }
  }

  @Put('rules')
  async updateRules(@Body(ValidatedBody(OVERAGE_RULES_BODY, { strict: true })) body: any, @Req() req: any) {
    try { return await this.svc.updateRules(this.actor(req), body ?? {}); } catch (e) { this.wrap(e); }
  }

  @Post('recompute')
  async recompute(@Req() req: any) {
    const actor: OverageActor = { userId: req?.ctx?.userId, role: req?.ctx?.role, permissions: req?.ctx?.permissions ?? [] };
    try { return await this.svc.recompute(actor); }
    catch (e: any) {
      if (e instanceof OverageForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
      throw new HttpException(e?.message || 'Recompute failed', HttpStatus.BAD_REQUEST);
    }
  }
}
