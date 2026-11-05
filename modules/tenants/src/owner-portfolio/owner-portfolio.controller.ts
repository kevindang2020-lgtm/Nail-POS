import { RequirePermission } from '@aipowersalon/permissions/guards';
// owner-portfolio.controller.ts — the Owner App's multi-salon surface.
//
//   GET  /owner/portfolio          the salons this owner may enter, with their role at each
//   GET  /owner/portfolio/summary  All-Salons aggregate, across authorized salons only
//   POST /owner/context/switch     switch salon — SERVER-VERIFIED, re-issues the session
//   GET  /owner/context            what the server currently considers the active salon
//
// ── Why switching re-issues the session ──
//
// The active salon lives in the signed session (`tenantId` in the token), which is what all 93 existing
// tenant-scoped owner queries already read. So a switch is not a client-side state change — it is the server
// minting a NEW session for the salon it approved.
//
// That means a tampered request cannot move the owner: the client's `tenantId` is only ever a lookup key into
// their own memberships, and the tenant that ends up in the token is the one the SERVER resolved.
//
// The re-issued token keeps its `sid`, so the session stays revocable — dropping it here would leave an owner
// with a session "sign out other devices" could never kill, which is the exact bug this codebase has been bitten
// by three times.
import type { OwnerPortfolioSalonView } from '@aipowersalon/api-contracts/tenant';
import { signSession, SESSION_COOKIE, sessionFromRequest, shouldReturnToken } from '@aipowersalon/identity';
import { DATABASE, type AppDatabase, safeInet } from '@aipowersalon/database';
import { Body, Controller, Get, HttpException, Inject, Module, Optional, Post, Req, Res, UseGuards } from '@nestjs/common';
import { OwnerPortfolioGuard } from './owner-portfolio.guard';
import { KyselyOwnerPortfolioRepo, InMemoryOwnerPortfolioRepo, type OwnerPortfolioRepo } from './owner-portfolio.repository';
import { decideSwitch, summarize, topSalons, isSalonSelectable, canAtSalon } from './owner-portfolio-core';
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { OWNER_SWITCH_BODY } from '../request-schemas';

const TTL = Number(process.env.AUTH_SESSION_TTL) || 60 * 60 * 12;

@UseGuards(OwnerPortfolioGuard)
@Controller('owner')
export class OwnerPortfolioController {
  constructor(@Inject('OwnerPortfolioRepo') private readonly repo: OwnerPortfolioRepo) {}

  /** Every salon this owner may enter. The user id comes from the VERIFIED session, never the request. */
  @RequirePermission('owner.portfolio.view') @Get('portfolio')
  async portfolio(@Req() r: any) {
    const p = await this.repo.loadPortfolio(String(r?.ctx?.userId || ''));
    return {
      ok: true,
      salons: p.salons.map((s): OwnerPortfolioSalonView => ({
        // No internal ids beyond the tenant/branch ids the client legitimately needs to ASK for a switch — and
        // asking is not getting: the server re-verifies every one.
        salonId: s.tenantId,
        salonName: s.salonName,
        storeCode: s.storeCode,
        status: s.tenantStatus,
        selectable: isSalonSelectable(s),
        accessLevel: s.accessLevel,
        isPrimaryOwner: s.isPrimaryOwner,
        branches: s.branches.map((b) => ({
          branchId: b.branchId, name: b.name, city: b.city, state: b.state, isActive: b.isActive,
        })),
      })),
    };
  }

  /** All Salons. Aggregates ONLY the salons this owner may see figures for. Money in integer cents. */
  @RequirePermission('owner.portfolio.view') @Get('portfolio/summary')
  async summary(@Req() r: any) {
    const p = await this.repo.loadPortfolio(String(r?.ctx?.userId || ''));

    // Only ask the database for salons the owner may actually see reports for. A salon they cannot report on is
    // never even queried — so its numbers cannot leak through an aggregate.
    const reportable = p.salons.filter((s) => isSalonSelectable(s) && canAtSalon(s.accessLevel, 'reports'));
    const totals = await this.repo.loadTotals(reportable.map((s) => s.tenantId));

    // Top Performing Salons rides on the SAME reportable set — a salon the owner cannot see figures for is not
    // ranked and not named. This is the owner's portfolio, never a platform-wide leaderboard.
    return { ok: true, summary: summarize(p, totals), topSalons: topSalons(p, totals) };
  }

  /**
   * Revenue Overview — hourly revenue across ONLY the salons this owner may see figures for.
   *
   * Same authorization as /portfolio/summary: the reportable set is computed first, and a salon the owner cannot
   * report on is never even queried, so its money cannot leak through an aggregate line on a chart.
   */
  @RequirePermission('owner.portfolio.view') @Get('portfolio/revenue-series')
  async revenueSeries(@Req() r: any) {
    const p = await this.repo.loadPortfolio(String(r?.ctx?.userId || ''));
    const reportable = p.salons.filter((s) => isSalonSelectable(s) && canAtSalon(s.accessLevel, 'reports'));
    // No reportable salon → an empty series, which the chart renders as an honest "no data", never a flat zero
    // line that looks like a real quiet day.
    if (!reportable.length) return { ok: true, points: [], salonCount: 0 };
    const points = await this.repo.loadRevenueSeries(reportable.map((s) => s.tenantId));
    return { ok: true, points, salonCount: reportable.length };
  }

  /** What the SERVER thinks the active salon is. The client's opinion is not consulted. */
  @RequirePermission('owner.portfolio.view') @Get('context')
  async context(@Req() r: any) {
    const tenantId = String(r?.ctx?.tenantId || '');
    const p = await this.repo.loadPortfolio(String(r?.ctx?.userId || ''));
    const salon = p.salons.find((s) => s.tenantId === tenantId);
    return {
      ok: true,
      activeSalonId: tenantId || null,
      activeBranchId: r?.ctx?.branchId || null,
      salonName: salon?.salonName ?? null,
      accessLevel: salon?.accessLevel ?? null,
    };
  }

  /**
   * Switch salon.
   *
   * The body carries the salon the owner WANTS. The server decides whether they may, and re-issues the session
   * for the salon it approved — so a modified `salonId` cannot put an owner into a salon they do not own.
   */
  @RequirePermission('owner.portfolio.view') @Post('context/switch')
  async switchSalon(@Req() req: any, @Body(ValidatedBody(OWNER_SWITCH_BODY)) b: any, @Res() res: any) {
    const userId = String(req?.ctx?.userId || '');
    const portfolio = await this.repo.loadPortfolio(userId);

    const decision = decideSwitch(portfolio, String(b?.salonId ?? ''), b?.branchId ? String(b.branchId) : null);
    if (!decision.ok) {
      // 403, and the message never distinguishes "not yours" from "does not exist".
      throw new HttpException({ ok: false, code: decision.reason, message: decision.message }, 403);
    }

    const secret = process.env.AUTH_SESSION_SECRET || '';
    if (!secret) throw new HttpException({ ok: false, message: 'Server is not configured for sessions.' }, 500);

    // Re-sign the session for the APPROVED salon. Everything else is carried over from the verified session —
    // including `sid`, so the session stays revocable.
    const current: any = sessionFromRequest(req, secret);
    const claims: any = {
      userId,
      tenantId: decision.tenantId,          // ← the SERVER's answer, not the client's request
      branchId: decision.branchId,
      role: current?.role ?? req?.ctx?.role,
      permissions: current?.permissions ?? req?.ctx?.permissions ?? [],
      subscriptionStatus: current?.subscriptionStatus ?? 'active',
      ...(current?.sid ? { sid: current.sid } : {}),
    };
    const token = signSession(claims, { secret, ttlSeconds: TTL });

    await this.repo.recordSwitch(userId, decision.tenantId, decision.branchId, safeInet(req?.ip));

    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: TTL * 1000, path: '/',
    });

    const salon = portfolio.salons.find((s) => s.tenantId === decision.tenantId)!;
    res.status(200).json({
      ok: true,
      activeSalonId: decision.tenantId,
      activeBranchId: decision.branchId,
      salonName: salon.salonName,
      accessLevel: decision.accessLevel,
      // Native shells cannot use the cookie — see auth/native-client.ts.
      ...(shouldReturnToken(req) ? { accessToken: token, expiresIn: TTL } : {}),
    });
  }
}

@Module({
  controllers: [OwnerPortfolioController],
  providers: [
    {
      provide: 'OwnerPortfolioRepo',
      useFactory: (db: AppDatabase) =>
        db ? new KyselyOwnerPortfolioRepo(db)
           : new InMemoryOwnerPortfolioRepo({ ownerUserId: '', salons: [] }),
      inject: [DATABASE],
    },
  ],
})
export class OwnerPortfolioModule {}
