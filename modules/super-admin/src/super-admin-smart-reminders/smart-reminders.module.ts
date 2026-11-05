import { safeInet, DATABASE, type AppDatabase, ListQueries } from '@aipowersalon/database';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { SmartRemindersService, type AdminCtx } from './smart-reminders.service';
import { SmartRemindersRepository } from './smart-reminders.kysely.repository';
import { ReminderTemplatesService } from './reminder-templates.service';
import { ReminderTemplatesRepository } from './reminder-templates.kysely.repository';
import { ReminderTimingService } from './reminder-timing.service';
import { ReminderTimingRepository } from './reminder-timing.kysely.repository';
import { ReminderOverridesService } from './reminder-overrides.service';
import { ReminderOverridesRepository } from './reminder-overrides.kysely.repository';
import { ReminderFlowStateService } from './reminder-flow-state.service';
import { ReminderFlowStateRepository } from './reminder-flow-state.kysely.repository';
import { ReminderChannelService } from './reminder-channel.service';
import { ReminderChannelRepository } from './reminder-channel.kysely.repository';
import { ReminderPlanFeaturesService } from './reminder-plan-features.service';
import { ReminderPlanFeaturesRepository } from './reminder-plan-features.kysely.repository';
import { ReminderExportService } from './reminder-export.service';
import { SmartRemindersControllerListQueries } from './smart-reminders.module.list-queries';
import { SR_CHANNELS_BODY, SR_EXPORT_BODY, SR_FLOW_DISABLE_BODY, SR_FLOW_ENABLE_BODY, SR_OVERRIDE_BODY, SR_PLAN_FEATURE_BODY, SR_PREVIEW_BODY, SR_PREVIEW_FALLBACK_BODY, SR_TEMPLATE_BODY, SR_TEMPLATE_VERSION_BODY, SR_TIMING_BODY } from '../request-schemas-workforce';   // BUILD_PLAN Phase 12 (#17)

function run<T>(fn: () => Promise<T>): Promise<T> { return fn(); }

@UseGuards(SuperAdminGuard)
@ListQueries(SmartRemindersControllerListQueries)
@Controller('super-admin/smart-reminders')
export class SmartRemindersController {
  constructor(private readonly svc: SmartRemindersService, private readonly templates: ReminderTemplatesService, private readonly timing: ReminderTimingService, private readonly overrides: ReminderOverridesService, private readonly flows: ReminderFlowStateService, private readonly channels: ReminderChannelService, private readonly planFeatures: ReminderPlanFeaturesService, private readonly exports: ReminderExportService) {}

  @Get('overview') overview(@Req() r: any, @Query() q: any) {
    const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined };
    return this.svc.getOverview(ctx, q || {});
  }

  // Create Global Reminder Templates — append-only versioning; publishing never overwrites a prior published version.
  @Get('templates') listTemplates() { return run(() => this.templates.list()); }
  @Get('templates/:id') getTemplate(@Param('id') id: string) { return run(() => this.templates.get(id)); }
  @Post('templates') createTemplate(@Req() r: any, @Body(ValidatedBody(SR_TEMPLATE_BODY)) b: any) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined }; return run(() => this.templates.createTemplate(ctx, b || {})); }
  @Post('templates/:id/versions') addVersion(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(SR_TEMPLATE_VERSION_BODY)) b: any) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined }; return run(() => this.templates.addVersion(ctx, id, b || {})); }
  @Post('templates/:id/versions/:version/publish') publishVersion(@Req() r: any, @Param('id') id: string, @Param('version') version: string) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined }; return run(() => this.templates.publishVersion(ctx, id, Number(version))); }
  @Post('templates/preview') previewTemplate(@Body(ValidatedBody(SR_PREVIEW_BODY)) b: any) { return run(() => this.templates.preview(b || {})); }

  // Configure Default Timing — per reminder type, with allowed [min,max] band + quiet hours enforced server-side.
  @Get('timing') listTiming(@Query() q: any) { const tenantId = typeof q?.tenantId === 'string' ? q.tenantId : null; return run(() => this.timing.list(tenantId)); }
  @Get('timing/:reminderType') getTiming(@Param('reminderType') rt: string, @Query() q: any) { const tenantId = typeof q?.tenantId === 'string' ? q.tenantId : null; return run(() => this.timing.get(tenantId, rt)); }
  @Post('timing') setTiming(@Req() r: any, @Body(ValidatedBody(SR_TIMING_BODY)) b: any) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined }; return run(() => this.timing.setTiming(ctx, b || {})); }

  // Allow Tenant Customization — overrides stored separately, bounded by the platform band + channel allow-list.
  @Get('tenant-customizations/:tenantId') listOverrides(@Param('tenantId') tenantId: string) { return run(() => this.overrides.list(tenantId)); }
  @Get('tenant-customizations/:tenantId/:reminderType/effective') effective(@Param('tenantId') tenantId: string, @Param('reminderType') rt: string) { return run(() => this.overrides.getEffective(tenantId, rt)); }
  @Post('tenant-customizations/:tenantId') setOverride(@Req() r: any, @Param('tenantId') tenantId: string, @Body(ValidatedBody(SR_OVERRIDE_BODY)) b: any) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined }; return run(() => this.overrides.setOverride(ctx, tenantId, b || {})); }
  @Post('tenant-customizations/:tenantId/:reminderType/revert') revertOverride(@Req() r: any, @Param('tenantId') tenantId: string, @Param('reminderType') rt: string) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined }; return run(() => this.overrides.revert(ctx, tenantId, rt)); }

  // Disable Problematic Reminders — sensitive; requires a reason, stops new jobs, preserves history; plus re-enable.
  @Get('flows') listFlows(@Query() q: any) { const tenantId = typeof q?.tenantId === 'string' ? q.tenantId : null; return run(() => this.flows.list(tenantId)); }
  @Get('flows/:reminderType') getFlow(@Param('reminderType') rt: string, @Query() q: any) { const tenantId = typeof q?.tenantId === 'string' ? q.tenantId : null; return run(() => this.flows.get(tenantId, rt)); }
  @Post('flows/disable') disableFlow(@Req() r: any, @Body(ValidatedBody(SR_FLOW_DISABLE_BODY)) b: any) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined }; return run(() => this.flows.disable(ctx, b || {})); }
  @Post('flows/enable') enableFlow(@Req() r: any, @Body(ValidatedBody(SR_FLOW_ENABLE_BODY)) b: any) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined }; return run(() => this.flows.enable(ctx, b || {})); }

  // Set Channels + Configure Fallback — backend owns the channel sequence; preview demonstrates the fallback resolver.
  @Get('channels') listChannels(@Query() q: any) { const tenantId = typeof q?.tenantId === 'string' ? q.tenantId : null; return run(() => this.channels.list(tenantId)); }
  @Get('channels/:reminderType') getChannels(@Param('reminderType') rt: string, @Query() q: any) { const tenantId = typeof q?.tenantId === 'string' ? q.tenantId : null; return run(() => this.channels.get(tenantId, rt)); }
  @Post('channels') setChannels(@Req() r: any, @Body(ValidatedBody(SR_CHANNELS_BODY)) b: any) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined }; return run(() => this.channels.setConfig(ctx, b || {})); }
  @Post('channels/preview-fallback') previewFallback(@Body(ValidatedBody(SR_PREVIEW_FALLBACK_BODY)) b: any) { return run(async () => this.channels.previewFallback(b || {})); }

  // Enable Reminders by Subscription Plan — per-plan capability matrix; evaluate() is the backend enforcement gate.
  @Get('plan-features') listPlanFeatures(@Query() q: any) { return run(() => this.planFeatures.list(typeof q?.planCode === 'string' ? q.planCode : undefined)); }
  @Post('plan-features') setPlanFeature(@Req() r: any, @Body(ValidatedBody(SR_PLAN_FEATURE_BODY)) b: any) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined }; return run(() => this.planFeatures.setFeature(ctx, b || {})); }
  @Get('plan-features/evaluate') evaluatePlanFeature(@Query() q: any) { return run(() => this.planFeatures.evaluate(String(q?.tenantId ?? ''), String(q?.featureKey ?? ''))); }

  // Audited CSV export — scoped, injection-guarded, no customer contact details.
  @Post('exports') exportCsv(@Req() r: any, @Body(ValidatedBody(SR_EXPORT_BODY)) b: any) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined }; return run(() => this.exports.exportCsv(ctx, b || {})); }
}

@Module({
  controllers: [SmartRemindersController],
  providers: [
    { provide: SmartRemindersService, useFactory: (db: AppDatabase) => new SmartRemindersService(new SmartRemindersRepository(db as any)), inject: [DATABASE] },
    { provide: ReminderTemplatesService, useFactory: (db: AppDatabase) => new ReminderTemplatesService(new ReminderTemplatesRepository(db as any)), inject: [DATABASE] },
    { provide: ReminderTimingService, useFactory: (db: AppDatabase) => new ReminderTimingService(new ReminderTimingRepository(db as any)), inject: [DATABASE] },
    { provide: ReminderOverridesService, useFactory: (db: AppDatabase) => new ReminderOverridesService(new ReminderOverridesRepository(db as any), new ReminderTimingRepository(db as any)), inject: [DATABASE] },
    { provide: ReminderFlowStateService, useFactory: (db: AppDatabase) => new ReminderFlowStateService(new ReminderFlowStateRepository(db as any)), inject: [DATABASE] },
    { provide: ReminderChannelService, useFactory: (db: AppDatabase) => new ReminderChannelService(new ReminderChannelRepository(db as any)), inject: [DATABASE] },
    { provide: ReminderPlanFeaturesService, useFactory: (db: AppDatabase) => new ReminderPlanFeaturesService(new ReminderPlanFeaturesRepository(db as any)), inject: [DATABASE] },
    { provide: ReminderExportService, useFactory: (db: AppDatabase) => new ReminderExportService(new SmartRemindersService(new SmartRemindersRepository(db as any)), new SmartRemindersRepository(db as any)), inject: [DATABASE] },
  ],
})
export class SmartRemindersModule {}
