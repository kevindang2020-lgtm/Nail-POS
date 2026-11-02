// onboarding.module.ts — the Super-Admin "Onboarding & Approvals" HTTP surface under /super-admin/onboarding, guarded
// so only platform super-admins reach it. Thin: derive actor ctx, map OnboardingError → HTTP. Literal sub-routes are
// declared before parameterized ones so 'overview'/'approvals' aren't captured as :id.
import { safeInet, DATABASE, type AppDatabase, ListQueries } from '@aipowersalon/database';
import { Body, Controller, Get, Module, NotFoundException, BadRequestException, ForbiddenException, ConflictException, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SuperAdminGuard, AsyncExport, ValidatedBody } from '@aipowersalon/permissions/guards';
import { AuditService } from '@aipowersalon/audit';
import { OnboardingService, OnboardingError, type AdminCtx, type OnboardingQuery, type OnboardingExportFormat } from './onboarding.service';
import type { DocumentStatus } from './onboarding-core';
import { InMemoryOnboardingRepo, type OnboardingRepo, type ApprovalType, type ApprovalStatus } from './onboarding.repository';
import { KyselyOnboardingRepo } from './onboarding.kysely.repository';
import type { OnboardingState, OnboardingStage } from './onboarding-core';
import { OnboardingControllerListQueries } from './onboarding.module.list-queries';
import { ONB_ACTIVATE_BODY, ONB_APPROVAL_BODY, ONB_ASSIGN_BODY, ONB_CREATE_BODY, ONB_DECIDE_BODY, ONB_NOTE_BODY, ONB_REQUEST_INFO_BODY, ONB_RETURN_BODY, ONB_REVIEW_DOCUMENT_BODY, ONB_TRANSITION_BODY } from '../request-schemas-onboarding';   // BUILD_PLAN Phase 12 (#17)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ctxFrom(req: any): AdminCtx {
  const c = req?.ctx ?? {};
  return { userId: c.userId ?? req?.user?.id ?? null, role: c.role ?? null, actorName: c.actorName ?? null, ip: safeInet(req?.ip) ?? null, tenantId: c.tenantId ?? null };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function queryFrom(q: any): OnboardingQuery {
  return {
    search: q?.search, applicationType: q?.applicationType, stage: q?.stage, specialistId: q?.specialistId,
    merchantStatus: q?.merchantStatus, hardwareStatus: q?.hardwareStatus, importStatus: q?.importStatus, trainingStatus: q?.trainingStatus,
    hasMissingDocuments: q?.hasMissingDocuments === undefined ? undefined : q.hasMissingDocuments === 'true' || q.hasMissingDocuments === true,
    sort: q?.sort, direction: q?.direction === 'asc' ? 'asc' : q?.direction === 'desc' ? 'desc' : undefined,
    page: q?.page ? +q.page : 1, pageSize: q?.pageSize ? +q.pageSize : 10,
  };
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof OnboardingError) {
      if (e.code === 'not_found') throw new NotFoundException(e.message);
      if (e.code === 'forbidden') throw new ForbiddenException(e.message);
      if (e.code === 'conflict') throw new ConflictException(e.message);
      throw new BadRequestException(e.message);
    }
    throw e;
  }
}

@ListQueries(OnboardingControllerListQueries)
@Controller('super-admin/onboarding')
@UseGuards(SuperAdminGuard)
export class OnboardingController {
  constructor(private readonly svc: OnboardingService) {}

  @Get('overview') overview(@Req() r: never, @Query() q: unknown) { return run(() => this.svc.overview(ctxFrom(r as never), queryFrom(q))); }
  @Get('applications') list(@Req() r: never, @Query() q: unknown) { return run(() => this.svc.overview(ctxFrom(r as never), queryFrom(q)).then((o) => o.applications)); }
  @Get('approvals') approvals(@Query() q: { status?: ApprovalStatus; approvalType?: ApprovalType }) { return run(() => this.svc.listApprovals({ status: q?.status, approvalType: q?.approvalType })); }

  @AsyncExport({ kind: 'super-admin.onboarding.export' }) @Get('export')
  export(@Req() r: never, @Query() q: { format?: OnboardingExportFormat } & Record<string, unknown>) {
    return run(() => this.svc.export(ctxFrom(r as never), queryFrom(q), (q?.format ?? 'csv') as OnboardingExportFormat));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  @Post('applications') create(@Req() r: any, @Body(ValidatedBody(ONB_CREATE_BODY, { strict: true })) b: any) { return run(() => this.svc.createApplication(ctxFrom(r), { applicationId: String(b?.applicationId ?? ''), applicationType: b?.applicationType, parentTenantId: b?.parentTenantId ?? null, branchCount: b?.branchCount, specialistUserId: b?.specialistUserId ?? null, priority: b?.priority, targetActivationDate: b?.targetActivationDate ?? null })); }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  @Get(':id') get(@Param('id') id: string) { return run(() => this.svc.getRecord(id)); }
  @Get(':id/history') history(@Param('id') id: string) { return run(() => this.svc.listHistory(id)); }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  @Get(':id/notes') notes(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.listNotes(ctxFrom(r), id)); }
  @Get(':id/documents') documents(@Param('id') id: string) { return run(() => this.svc.listDocuments(id)); }
  @Patch('documents/:documentId') reviewDocument(@Req() r: never, @Param('documentId') documentId: string, @Body(ValidatedBody(ONB_REVIEW_DOCUMENT_BODY, { strict: true })) b: { status: DocumentStatus; rejectionReason?: string | null }) {
    return run(() => this.svc.reviewDocument(ctxFrom(r as never), documentId, { status: b?.status, rejectionReason: b?.rejectionReason }));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  @Patch(':id/transition') transition(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(ONB_TRANSITION_BODY, { strict: true })) b: any) {
    return run(() => this.svc.transitionStage(ctxFrom(r), id, String(b?.toState ?? '') as OnboardingState, { reason: b?.reason ?? null, allowSkip: !!b?.allowSkip, resumeStage: b?.resumeStage as OnboardingStage | undefined }));
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  @Patch(':id/assign') assign(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(ONB_ASSIGN_BODY, { strict: true })) b: any) { return run(() => this.svc.assignSpecialist(ctxFrom(r), id, b?.specialistUserId ?? null)); }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  @Post(':id/notes') note(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(ONB_NOTE_BODY, { strict: true })) b: any) { return run(() => this.svc.addNote(ctxFrom(r), id, { body: String(b?.body ?? ''), noteType: b?.noteType, visibility: b?.visibility, stage: b?.stage ?? null, followUpDate: b?.followUpDate ?? null })); }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  @Post(':id/request-info') requestInfo(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(ONB_REQUEST_INFO_BODY, { strict: true })) b: any) { return run(() => this.svc.requestInfo(ctxFrom(r), id, String(b?.message ?? ''), b?.deadline ?? null)); }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  @Post(':id/return-for-correction') returnForCorrection(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(ONB_RETURN_BODY, { strict: true })) b: any) { return run(() => this.svc.returnForCorrection(ctxFrom(r), id, String(b?.reason ?? ''), String(b?.corrections ?? ''))); }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  @Post(':id/approvals') queueApproval(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(ONB_APPROVAL_BODY, { strict: true })) b: any) { return run(() => this.svc.addApproval(ctxFrom(r), id, String(b?.approvalType ?? 'step') as ApprovalType, b?.stage ?? null, !!b?.requiresSecondApproval)); }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  @Patch('approvals/:approvalId') decide(@Req() r: any, @Param('approvalId') approvalId: string, @Body(ValidatedBody(ONB_DECIDE_BODY, { strict: true })) b: any) { return run(() => this.svc.decideApproval(ctxFrom(r), approvalId, { status: String(b?.status ?? '') as ApprovalStatus, reason: b?.reason ?? null })); }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  @Post(':id/activate') activate(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(ONB_ACTIVATE_BODY, { strict: true })) b: any) {
    // Critical action: the frontend must collect a typed tenant-name confirmation; the backend re-validates prerequisites.
    return run(() => this.svc.activateTenant(ctxFrom(r), id, { note: b?.note ?? null, activationType: b?.activationType }));
  }
}

@Module({
  controllers: [OnboardingController],
  providers: [
    { provide: 'OnboardingRepo', useFactory: (db: AppDatabase): OnboardingRepo => (db ? new KyselyOnboardingRepo(db) : new InMemoryOnboardingRepo()), inject: [DATABASE] },
    { provide: OnboardingService, useFactory: (repo: OnboardingRepo, audit: AuditService, db: AppDatabase) => new OnboardingService(repo, audit, db), inject: ['OnboardingRepo', AuditService, DATABASE] },
  ],
  exports: [OnboardingService],
})
export class OnboardingModule {}
