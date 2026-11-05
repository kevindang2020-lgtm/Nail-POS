// tech-workplaces.controller.ts — /tech/workplaces and /tech/context/switch.
//
// The technician's own salons, and the switch between them. Mirrors owner-portfolio.controller's switch exactly
// — the server resolves what the technician may do, decides, and RE-SIGNS the session for the salon it approved,
// so a tampered tenantId in the body can never put a technician into a salon they do not work at.
import { signSession, SESSION_COOKIE, sessionFromRequest, shouldReturnToken } from '@aipowersalon/identity';
import {
  BadRequestException, Body, Controller, ForbiddenException, Get, HttpException, NotFoundException, Param, Post,
  Req, Res, ServiceUnavailableException, UseGuards,
} from '@nestjs/common';
import { RequirePermission, TenantAuthGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { TechProfileError, type TechProfileCtx } from './tech-profile.service';
import { TechWorkplacesService } from './tech-workplaces.service';
import { TECH_SWITCH_SALON_BODY } from '../request-schemas';

const TTL = Number(process.env.AUTH_SESSION_TTL) || 60 * 60 * 12;

function ctxFrom(req: any): TechProfileCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof TechProfileError) {
      if (e.code === 'forbidden' || e.code === 'not_technician') throw new ForbiddenException(e.message);
      if (e.code === 'not_found') throw new NotFoundException(e.message);
      if (e.code === 'unavailable') throw new ServiceUnavailableException(e.message);
      throw new BadRequestException(e.message);
    }
    throw e;
  }
}

@Controller('tech')
@UseGuards(TenantAuthGuard)
export class TechWorkplacesController {
  constructor(private readonly wp: TechWorkplacesService) {}

  @RequirePermission('tech.dashboard.view') @Get('workplaces')
  workplaces(@Req() r: any) { return run(() => this.wp.list(ctxFrom(r))); }

  @RequirePermission('tech.profile.edit') @Post('workplaces/:membershipId/accept')
  accept(@Req() r: any, @Param('membershipId') id: string) { return run(() => this.wp.accept(ctxFrom(r), id)); }

  @RequirePermission('tech.profile.edit') @Post('workplaces/:membershipId/decline')
  decline(@Req() r: any, @Param('membershipId') id: string) { return run(() => this.wp.decline(ctxFrom(r), id)); }

  /**
   * POST /tech/context/switch — become active at another of MY salons.
   *
   * The body carries the salon the technician WANTS. The server decides whether they may, and re-issues the
   * session for the salon it approved. Three things change in the new session and each one matters:
   *
   *   tenantId    → the SERVER's answer, never the client's request
   *   userId      → the technician's `users` row IN THAT SALON (option b: one login row per salon)
   *   role/perms  → derived from the TARGET salon's users row, NEVER carried over from the source
   *
   * That last line is the one doing security work. Salon A granting a technician `pos.tech.process_payment`
   * must not follow them into Salon B, which granted nothing. Carrying `current.permissions` across — which is
   * correct for an owner, who has ONE users row — would be a cross-tenant privilege escalation here.
   *
   * `sid` is carried over, so the session stays revocable: revoking the login revokes every salon it reached.
   */
  @RequirePermission('tech.dashboard.view') @Post('context/switch')
  async switchSalon(@Req() req: any, @Body(ValidatedBody(TECH_SWITCH_SALON_BODY)) b: any, @Res() res: any) {
    const ctx = ctxFrom(req);
    const decision = await run(() => this.wp.switchTarget(ctx, String(b?.salonId ?? b?.tenantId ?? '')));

    if (!decision.ok) {
      // 403, and "not one of your salons" reads identically to "no such salon".
      throw new HttpException({ ok: false, code: decision.reason, message: decision.message }, 403);
    }

    const secret = process.env.AUTH_SESSION_SECRET || '';
    if (!secret) throw new HttpException({ ok: false, message: 'Server is not configured for sessions.' }, 500);

    const current: any = sessionFromRequest(req, secret);
    const token = signSession({
      userId: decision.userId,
      tenantId: decision.tenantId,
      branchId: decision.branchId,
      role: decision.role,
      // the TARGET salon's role defaults + the TARGET salon's own overrides. Never the source's.
      permissions: await this.wp.permissionsAtTarget(decision.tenantId, decision.userId, decision.role),
      subscriptionStatus: current?.subscriptionStatus ?? 'active',
      ...(current?.sid ? { sid: current.sid } : {}),
    } as any, { secret, ttlSeconds: TTL });

    await this.wp.recordSwitch(ctx, { tenantId: decision.tenantId, branchId: decision.branchId, userId: decision.userId });

    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: TTL * 1000, path: '/',
    });

    res.status(200).json({
      ok: true,
      activeSalonId: decision.tenantId,
      activeBranchId: decision.branchId,
      salonName: decision.salonName,
      // The Tech App is a native shell and cannot use the cookie — see auth/native-client.ts.
      ...(shouldReturnToken(req) ? { accessToken: token, expiresIn: TTL } : {}),
    });
  }
}
