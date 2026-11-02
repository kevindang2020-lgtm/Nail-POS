/**
 * Super Admin oversight for the global technician profile: verification decisions and the DM abuse-report queue.
 * Gated by SuperAdminGuard, exactly like the other /super-admin/* controllers. A salon can never reach these — only a
 * Super Admin grants verification or acts on a reported conversation.
 */
import { Body, Controller, Get, Param, Patch, Req, UseGuards, BadRequestException, NotFoundException } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { TechProfileError, TechProfileService, type TechProfileCtx } from './tech-profile.service';
import { TECH_SA_DM_REPORT_BODY, TECH_SA_VERIFICATION_BODY } from '../request-schemas';

function ctxFrom(req: any): TechProfileCtx {
  const u = req?.user ?? req?.principal ?? {};
  return { tenantId: u.tenantId, branchId: u.branchId, userId: u.userId ?? u.id, role: u.role, permissions: u.permissions ?? [] } as TechProfileCtx;
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof TechProfileError) {
      if (e.code === 'not_found') throw new NotFoundException(e.message);
      throw new BadRequestException(e.message);
    }
    throw e;
  }
}

@Controller('super-admin/tech-profiles')
@UseGuards(SuperAdminGuard)
export class TechProfileSuperAdminController {
  constructor(private readonly svc: TechProfileService) {}

  @Get('verifications') verifications() { return run(() => this.svc.saListPendingVerifications()); }
  @Patch('verifications/:profileId') setVerification(@Req() r: any, @Param('profileId') id: string, @Body(ValidatedBody(TECH_SA_VERIFICATION_BODY, { strict: true })) b: any) {
    return run(() => this.svc.saSetVerification(ctxFrom(r), id, b?.status, b?.note));
  }

  @Get('dm-reports') dmReports() { return run(() => this.svc.saListDmReports()); }
  @Patch('dm-reports/:reportId') resolveDmReport(@Req() r: any, @Param('reportId') id: string, @Body(ValidatedBody(TECH_SA_DM_REPORT_BODY, { strict: true })) b: any) {
    return run(() => this.svc.saResolveDmReport(ctxFrom(r), id, b?.action));
  }
}
