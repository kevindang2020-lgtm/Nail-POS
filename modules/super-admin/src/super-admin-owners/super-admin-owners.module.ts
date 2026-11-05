/**
 * super-admin-owners.module.ts — Super Admin → Owner Multi-Salon assignment.
 * CROSS-TENANT (behind SuperAdminGuard). Lets a Super Admin link an OWNER user to a SUBSET of their tenant's branches
 * via user_branch_access, mark a primary salon, set an access level, and remove access. Within-tenant only: a branch
 * can be assigned to an owner solely when branch.tenant_id === owner.tenant_id (cross-tenant assignment is rejected).
 */
import { KyselyOwnerPortfolioRepo, summarize, topSalons } from '@aipowersalon/tenants';
import { Module, Controller, Get, Post, Patch, Delete, Param, Body, Req, Inject, UseGuards, BadRequestException, NotFoundException } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { SuperAdminOwnersService, SuperAdminOwnersError } from './super-admin-owners.service';
import { OWNER_ASSIGN_BRANCH_BODY, OWNER_PIN_BODY, OWNER_SALON_BODY, OWNER_UPDATE_BRANCH_BODY } from '../request-schemas-programs';   // BUILD_PLAN Phase 12 (#17)

function run<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((e) => {
    if (e instanceof SuperAdminOwnersError) {
      if (e.code === 'not_found') throw new NotFoundException(e.message);
      throw new BadRequestException(e.message);
    }
    throw e;
  });
}
const actor = (r: any): string | undefined => r?.ctx?.userId;

@UseGuards(SuperAdminGuard)
@Controller('super-admin')
export class SuperAdminOwnersController {
  constructor(private readonly svc: SuperAdminOwnersService, @Inject(DATABASE) private readonly db: AppDatabase) {}
  @Get('owners') list() { return run(() => this.svc.listOwners()); }
  @Get('owners/:ownerId') detail(@Param('ownerId') ownerId: string) { return run(() => this.svc.getOwner(ownerId)); }
  @Get('owners/:ownerId/activity') activity(@Param('ownerId') ownerId: string) { return run(() => this.svc.getOwnerActivity(ownerId)); }

  /**
   * The owner's FULL PORTFOLIO, as Super Admin sees it — every salon across every tenant, with its Store Code,
   * status, branches, and month-to-date revenue. This is what the "Salons in Portfolio" table needs and what
   * `getOwner()` structurally cannot give: that method resolves branches inside the owner's ONE home tenant,
   * but a salon IS a tenant here, so an owner with salons in three legal entities has three tenants.
   *
   * It deliberately reuses the EXACT repository and pure functions the Owner App runs on
   * (`KyselyOwnerPortfolioRepo` + `summarize`/`topSalons`). A second, Super-Admin-only query over the same
   * tables would eventually drift, and then Super Admin and the owner would disagree about what the owner owns
   * — which is precisely the bug you never want in the screen you use to diagnose the other screens.
   */
  @Get('owners/:ownerId/portfolio') portfolio(@Param('ownerId') ownerId: string) {
    return run(async () => {
      const repo = new KyselyOwnerPortfolioRepo(this.db as any);
      const p = await repo.loadPortfolio(ownerId);
      // Super Admin is not permission-scoped the way an owner is — but the aggregate is still built from the
      // owner's OWN salon set, so what Super Admin sees is what that owner sees, not a platform-wide total.
      const totals = await repo.loadTotals(p.salons.map((s) => s.tenantId));
      return { ok: true, portfolio: p, summary: summarize(p, totals), topSalons: topSalons(p, totals), totals };
    });
  }
  @Post('owners/:ownerId/salons') createSalon(@Req() r: any, @Param('ownerId') ownerId: string, @Body(ValidatedBody(OWNER_SALON_BODY)) body: any) {
    return run(() => this.svc.createSalon(actor(r), ownerId, body ?? {}));
  }
  @Post('owners/:ownerId/branches') assign(@Req() r: any, @Param('ownerId') ownerId: string, @Body(ValidatedBody(OWNER_ASSIGN_BRANCH_BODY)) body: any) {
    return run(() => this.svc.assignBranch(actor(r), ownerId, body ?? {}));
  }
  @Patch('owners/:ownerId/branches/:branchId') update(@Req() r: any, @Param('ownerId') ownerId: string, @Param('branchId') branchId: string, @Body(ValidatedBody(OWNER_UPDATE_BRANCH_BODY)) body: any) {
    return run(() => this.svc.updateBranch(actor(r), ownerId, branchId, body ?? {}));
  }
  @Delete('owners/:ownerId/branches/:branchId') remove(@Req() r: any, @Param('ownerId') ownerId: string, @Param('branchId') branchId: string) {
    return run(() => this.svc.removeBranch(actor(r), ownerId, branchId));
  }
  @Post('owners/:ownerId/branches/:branchId/pin') setPin(@Req() r: any, @Param('ownerId') ownerId: string, @Param('branchId') branchId: string, @Body(ValidatedBody(OWNER_PIN_BODY)) body: any) {
    return run(() => this.svc.setBranchPin(actor(r), ownerId, branchId, body?.pin));
  }
  @Delete('owners/:ownerId/branches/:branchId/pin') clearPin(@Req() r: any, @Param('ownerId') ownerId: string, @Param('branchId') branchId: string) {
    return run(() => this.svc.clearBranchPin(actor(r), ownerId, branchId));
  }
}

@Module({
  controllers: [SuperAdminOwnersController],
  providers: [
    { provide: SuperAdminOwnersService, useFactory: (db: AppDatabase) => new SuperAdminOwnersService(db as Kysely<DB>), inject: [DATABASE] },
  ],
  exports: [SuperAdminOwnersService],
})
export class SuperAdminOwnersModule {}
