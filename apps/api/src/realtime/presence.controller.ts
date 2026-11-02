// presence.controller.ts — Constitution 9 §48/§51/§112/§153: report your own connection's state; read your
// tenant's presence (staff roles only); Super Admin reads platform AGGREGATES only.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Controller, Post, Get, Body, Req, UseGuards, ForbiddenException, HttpException, Optional } from '@nestjs/common';
import { PresenceService, type PresenceState } from './presence';
import { isCustomerPrincipal } from '@aipowersalon/permissions';
import { PRESENCE_BODY } from './request-schemas';

const STATES: PresenceState[] = ['ONLINE', 'AWAY', 'BACKGROUND'];

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('realtime/presence')
export class PresenceController {
  constructor(@Optional() private readonly presence?: PresenceService) {}

  /** §51/§153: a client reports AWAY (tab hidden) / BACKGROUND (app suspended) / ONLINE for ITS OWN connection. */
  @Post()
  @RequirePermission('pos.login')
  async report(@Req() req: any, @Body(ValidatedBody(PRESENCE_BODY, { strict: true })) body: { connectionId?: string; state?: string }) {
    if (!this.presence) return { ok: false, reason: 'presence_disabled' };
    const state = String(body?.state ?? '').toUpperCase() as PresenceState;
    if (!STATES.includes(state)) throw new HttpException({ statusCode: 400, message: 'state must be ONLINE|AWAY|BACKGROUND' }, 400);
    const r = await this.presence.report(req.ctx.tenantId, req.ctx.userId, String(body?.connectionId ?? ''), state);
    if (r === 'forbidden') throw new ForbiddenException('not your connection');           // §13/§50
    if (r === 'throttled') throw new HttpException({ statusCode: 429, message: 'presence reports are limited to one per 10s' }, 429);  // §153
    return { ok: r === 'ok', reason: r === 'ok' ? undefined : r };
  }

  /** §48/§112: the tenant's own connected devices, grouped by branch. Staff only — a customer sees nothing here. */
  @Get()
  @RequirePermission('pos.login')
  async tenant(@Req() req: any) {
    if (!this.presence) return { total: 0, byBranch: {}, connections: [] };
    if (isCustomerPrincipal(req.ctx)) throw new ForbiddenException('presence is not available to customers');   // §112
    return this.presence.tenantView(req.ctx.tenantId);
  }
}

@UseGuards(SuperAdminGuard)
@Controller('super-admin/realtime/presence')
export class PlatformPresenceController {
  constructor(@Optional() private readonly presence?: PresenceService) {}
  /** §59/§146/§206: aggregate counts. Never a roster of tenants' people. */
  @Get()
  async platform() {
    if (!this.presence) return { connections: 0, tenants: 0, gatewayInstance: null };
    return this.presence.platformView();
  }
}
