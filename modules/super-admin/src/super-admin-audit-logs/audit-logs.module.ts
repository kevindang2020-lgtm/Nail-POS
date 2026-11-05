import { safeInet, DATABASE, type AppDatabase, ListQueries } from '@aipowersalon/database';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, Module } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { AuditLogsService, type AdminCtx } from './audit-logs.service';
import { AuditLogsRepository } from './audit-logs.kysely.repository';
import { AuditLegalHoldsService } from './audit-legal-holds.service';
import { AuditLegalHoldsRepository } from './audit-legal-holds.kysely.repository';
import { AuditInvestigationsService } from './audit-investigations.service';
import { AuditInvestigationsRepository } from './audit-investigations.kysely.repository';
import { AuditEvidenceService } from './audit-evidence.service';
import { AuditEvidenceRepository } from './audit-evidence.kysely.repository';
import { AuditTamperControlsService, AuditTamperControlsRepository } from './audit-tamper-controls.service';
import { AuditExportFlagsService, AuditExportFlagsRepository } from './audit-export-flags.service';
import { AuditRetentionService, AuditRetentionRepository } from './audit-retention.service';
import { AuditLogsOverviewControllerListQueries } from './audit-logs.module.list-queries';
import { AL_EXPORT_EVIDENCE_BODY, AL_INVESTIGATION_NOTE_BODY, AL_INVESTIGATION_STATUS_BODY, AL_LINK_EVENT_BODY, AL_OPEN_INVESTIGATION_BODY, AL_PLACE_HOLD_BODY, AL_RELEASE_HOLD_BODY, AL_RETENTION_POLICY_BODY, AL_REVIEW_FLAG_BODY, AL_TAMPER_CONTROL_BODY } from '../request-schemas-audit';   // BUILD_PLAN Phase 12 (#17)

@UseGuards(SuperAdminGuard)
@ListQueries(AuditLogsOverviewControllerListQueries)
@Controller('super-admin/audit-logs')
export class AuditLogsOverviewController {
  constructor(private readonly svc: AuditLogsService, private readonly holds: AuditLegalHoldsService, private readonly investigations: AuditInvestigationsService, private readonly evidence: AuditEvidenceService, private readonly tamper: AuditTamperControlsService, private readonly flags: AuditExportFlagsService, private readonly retention: AuditRetentionService) {}

  @Get('overview') overview(@Req() r: any, @Query() q: any) {
    const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined };
    return this.svc.getOverview(ctx, q || {});
  }

  // Place Logs Under Legal Hold — holds protect a slice of events from purge; they never edit or delete log rows.
  @Get('legal-holds') listHolds(@Query() q: any) { return this.holds.list(typeof q?.status === 'string' ? q.status : undefined); }
  @Post('legal-holds') placeHold(@Req() r: any, @Body(ValidatedBody(AL_PLACE_HOLD_BODY)) b: any) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined }; return this.holds.place(ctx, b || {}); }
  @Post('legal-holds/:id/release') releaseHold(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(AL_RELEASE_HOLD_BODY)) b: any) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined }; return this.holds.release(ctx, id, b || {}); }

  // Open Investigation / case management — linking events + notes are append-only; the timeline is immutable.
  @Get('investigations') listInvestigations(@Query() q: any) { return this.investigations.list(typeof q?.status === 'string' ? q.status : undefined); }
  @Get('investigations/:id') getInvestigation(@Param('id') id: string) { return this.investigations.get(id); }
  @Post('investigations') openInvestigation(@Req() r: any, @Body(ValidatedBody(AL_OPEN_INVESTIGATION_BODY)) b: any) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined }; return this.investigations.open(ctx, b || {}); }
  @Post('investigations/:id/events') linkEvent(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(AL_LINK_EVENT_BODY)) b: any) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined }; return this.investigations.addEvent(ctx, id, b || {}); }
  @Post('investigations/:id/notes') addNote(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(AL_INVESTIGATION_NOTE_BODY)) b: any) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined }; return this.investigations.addNote(ctx, id, b || {}); }
  @Post('investigations/:id/status') setStatus(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(AL_INVESTIGATION_STATUS_BODY)) b: any) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined }; return this.investigations.setStatus(ctx, id, b || {}); }

  // Export Audit Evidence + Chain of Custody — redacted, checksummed, manifest-backed; never exports secrets.
  @Get('evidence-packs') listPacks() { return this.evidence.list(); }
  @Get('evidence-packs/:id') getPack(@Param('id') id: string) { return this.evidence.get(id); }
  @Post('exports') exportEvidence(@Req() r: any, @Body(ValidatedBody(AL_EXPORT_EVIDENCE_BODY)) b: any) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined }; return this.evidence.exportEvidence(ctx, b || {}); }
  @Post('evidence-packs/:id/download') download(@Req() r: any, @Param('id') id: string) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined }; return this.evidence.recordDownload(ctx, id); }
  @Post('evidence-packs/:id/verify') verifyPack(@Req() r: any, @Param('id') id: string) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined }; return this.evidence.verify(ctx, id); }

  // Tamper-Resistance & Retention Status — recorded configuration + verification (never a hardcoded "Compliant").
  @Get('tamper-controls') tamperControls() { return this.tamper.status(); }
  @Post('tamper-controls') setControl(@Req() r: any, @Body(ValidatedBody(AL_TAMPER_CONTROL_BODY)) b: any) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined }; return this.tamper.setControl(ctx, b || {}); }
  @Post('tamper-controls/:key/verify') verifyControl(@Req() r: any, @Param('key') key: string) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined }; return this.tamper.verify(ctx, key); }

  // Export-risk flagging — documented rules; reviewer confirms or dismisses (false positive with reason).
  @Get('export-flags') listFlags(@Query() q: any) { return this.flags.list(typeof q?.status === 'string' ? q.status : undefined); }
  @Post('export-flags/scan') scanFlags(@Req() r: any) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined }; return this.flags.scan(ctx); }
  @Post('export-flags/:id/review') reviewFlag(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(AL_REVIEW_FLAG_BODY)) b: any) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined }; return this.flags.review(ctx, id, b || {}); }

  // Per-category retention policies — append-only versioning; eligibility is previewed only, never a delete.
  @Get('retention-policies') listPolicies() { return this.retention.list(); }
  @Get('retention-policies/:category/history') policyHistory(@Param('category') c: string) { return this.retention.history(c); }
  @Post('retention-policies') setPolicy(@Req() r: any, @Body(ValidatedBody(AL_RETENTION_POLICY_BODY)) b: any) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined }; return this.retention.setPolicy(ctx, b || {}); }
}

@Module({
  controllers: [AuditLogsOverviewController],
  providers: [
    { provide: AuditTamperControlsService, useFactory: (db: AppDatabase) => new AuditTamperControlsService(new AuditTamperControlsRepository(db as any)), inject: [DATABASE] },
    { provide: AuditExportFlagsService, useFactory: (db: AppDatabase) => new AuditExportFlagsService(new AuditExportFlagsRepository(db as any)), inject: [DATABASE] },
    { provide: AuditRetentionService, useFactory: (db: AppDatabase) => new AuditRetentionService(new AuditRetentionRepository(db as any)), inject: [DATABASE] },
    { provide: AuditLogsService, useFactory: (db: AppDatabase, tamper: AuditTamperControlsService, retention: AuditRetentionService) => new AuditLogsService(new AuditLogsRepository(db as any), tamper, retention), inject: [DATABASE, AuditTamperControlsService, AuditRetentionService] },
    { provide: AuditLegalHoldsService, useFactory: (db: AppDatabase) => new AuditLegalHoldsService(new AuditLegalHoldsRepository(db as any), db), inject: [DATABASE] },
    { provide: AuditInvestigationsService, useFactory: (db: AppDatabase) => new AuditInvestigationsService(new AuditInvestigationsRepository(db as any)), inject: [DATABASE] },
    { provide: AuditEvidenceService, useFactory: (db: AppDatabase) => new AuditEvidenceService(new AuditEvidenceRepository(db as any), new AuditLogsRepository(db as any)), inject: [DATABASE] },
  ],
})
export class AuditLogsOverviewModule {}
