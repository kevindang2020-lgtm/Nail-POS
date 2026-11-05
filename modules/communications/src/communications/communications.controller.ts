// communications.controller.ts — unified inbox HTTP surface.
//  • Tenant   /pos/communications/*        — TenantAuthGuard + RolePermissionGuard, tenant-scoped inbox + conversations.
//  • Platform /super-admin/communications  — SuperAdminGuard, cross-tenant inbox for S12.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, SuperAdminGuard, RequireFeature, ValidatedBody, RequireStepUp } from '@aipowersalon/permissions/guards';
import { ListQuery } from '@aipowersalon/database';
import { Controller, Get, Post, Patch, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus, Inject, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { INBOX_SERVICE, inboxCtxFrom, runInbox } from '../inbox/inbox.controller';
import type { InboxService } from '../inbox/inbox.service';
import { safeInet, ListQueries } from '@aipowersalon/database';
import { CommunicationsService, ForbiddenError, ValidationError, NotFoundError } from './communications.service';
import { CommunicationsOverviewService, type AdminCtx } from './communications-overview.service';
import { CommunicationsAnnouncementsService } from './communications-announcements.service';
import { CommunicationsActivityService } from './communications-activity.service';
import { CommunicationsLimitsService } from './communications-limits.service';
import { CommunicationsTemplatesService } from './communications-templates.service';
import { CommunicationsProvidersService } from './communications-providers.service';
import type { CommContext } from './communications.repository';
import type { ThreadFilters, CommChannel, ThreadStatus } from './communications.dto';
import { CommunicationsControllerListQueries, SuperAdminCommunicationsControllerListQueries } from './communications.list-queries';
import { EMPTY_BODY, SA_ANNOUNCEMENT_BODY, SA_PROVIDER_CREATE_BODY, SA_PROVIDER_ROTATE_BODY, SA_PROVIDER_UPDATE_BODY, SA_TEMPLATE_BODY, SA_TEMPLATE_PREVIEW_BODY, SA_TEMPLATE_VERSION_BODY, SA_TENANT_LIMIT_BODY, THREAD_ASSIGN_BODY, THREAD_CREATE_BODY, THREAD_REPLY_BODY, THREAD_STATUS_BODY } from '../request-schemas';

function ctxFrom(req: any): CommContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [], userName: c.userName || c.name }; }
function filtersFrom(q: any): ThreadFilters { const n = (v: any) => (v === undefined || v === '' ? undefined : Number(v)); const b = (v: any) => v === 'true' || v === true; return { status: q.status as ThreadStatus, channel: q.channel as CommChannel, assignedTo: q.assignedTo, unreadOnly: q.unreadOnly !== undefined ? b(q.unreadOnly) : undefined, search: q.search, page: n(q.page), pageSize: n(q.pageSize) }; }
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof ValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    if (e instanceof NotFoundError) throw new HttpException(e.message, HttpStatus.NOT_FOUND);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@RequireFeature('communications')   // BUILD_PLAN Phase 12 (#13): plan-gated — observe by default (feature-entitlement.ts)
@ListQueries(CommunicationsControllerListQueries)
@Controller('pos/communications')
export class CommunicationsController {
  constructor(private readonly svc: CommunicationsService, private readonly activitySvc: CommunicationsActivityService,
              @Optional() @Inject(INBOX_SERVICE) private readonly inbox?: InboxService | null) {}

  @Get('state') @RequirePermission('pos.communications.view') state(@Req() r: any, @Query() q: any) { return run(() => this.svc.getInbox(ctxFrom(r), filtersFrom(q))); }
  // Activity/volume metrics (mockup 19's KPI strip) — each from a real source, each carrying an availability flag.
  @Get('activity') @RequirePermission('pos.communications.view') @ListQuery({ filters: { branch: { type: 'text', maxLength: 40 } }, search: false, dateRange: { maxDays: 365 }, params: ['days'] }) activity(@Req() r: any, @Query('days') days?: string, @Query('branch') branch?: string) {
    const ctx = ctxFrom(r);
    // C2 audit (Nov 4 2026): a location filter; a location-confined user sees only their locations (another one is refused)
    const own: string[] | null = Array.isArray(r?.ctx?.authz?.branchIds) ? r.ctx.authz.branchIds.filter((b: unknown) => typeof b === 'string') : null;
    const want = typeof branch === 'string' && branch.trim() && branch !== 'all' ? branch.trim() : null;
    if (want && !/^[0-9a-f-]{36}$/i.test(want)) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'Choose a location from the list.' }, 400);
    if (want && own && !own.includes(want)) throw new HttpException({ code: 'BRANCH_NOT_AUTHORIZED', message: 'You do not have access to that location.' }, 403);
    return run(() => this.activitySvc.activity(ctx.tenantId, days ? Number(days) : 30, want ? [want] : own));
  }
  // GET threads/:id and POST threads/:id/read were retired with the SMS Inbox (Oct 30 2026): the POS reads and marks a
  // conversation through pos/communications/inbox/threads/:id(/read), which are branch-scoped, versioned and audited.

  @Post('threads') @RequirePermission('pos.communications.send') create(@Req() r: any, @Body(ValidatedBody(THREAD_CREATE_BODY, { strict: true })) b: any) { return run(() => this.svc.createThread(ctxFrom(r), b)); }
  // Communications guide (Oct 30 2026): the legacy reply route recorded "sent" WITHOUT sending anything. It now goes through the
  // inbox's real send path (tenant Twilio, readiness gate, opt-outs, one reserved message per request id) and answers with the
  // conversation as before; a client without an Idempotency-Key gets a one-off key (no retry protection — the POS sends one).
  @Post('threads/:id/reply') @RequirePermission('pos.communications.send') async reply(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(THREAD_REPLY_BODY, { strict: true })) b: any) {
    if (!this.inbox) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Replies need the database and a configured sender.' }, HttpStatus.SERVICE_UNAVAILABLE);
    const key = typeof r?.headers?.['idempotency-key'] === 'string' && r.headers['idempotency-key'].length >= 8 ? r.headers['idempotency-key'] : `legacy-reply:${randomUUID()}`;
    await runInbox(() => this.inbox!.reply(inboxCtxFrom(r), id, b?.body, key));
    return run(() => this.svc.getThread(ctxFrom(r), id));
  }
  @Post('threads/:id/assign') @RequirePermission('pos.communications.manage') assign(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(THREAD_ASSIGN_BODY, { strict: true })) b: any) { return run(() => this.svc.assign(ctxFrom(r), id, b?.userId ?? null, b?.userName ?? null)); }
  @Post('threads/:id/status') @RequirePermission('pos.communications.manage') status(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(THREAD_STATUS_BODY, { strict: true })) b: any) { return run(() => this.svc.setStatus(ctxFrom(r), id, b?.status)); }
}

@UseGuards(SuperAdminGuard)
@ListQueries(SuperAdminCommunicationsControllerListQueries)
@Controller('super-admin/communications')
export class SuperAdminCommunicationsController {
  constructor(private readonly svc: CommunicationsService, private readonly overview: CommunicationsOverviewService, private readonly announcements: CommunicationsAnnouncementsService, private readonly limits: CommunicationsLimitsService, private readonly templates: CommunicationsTemplatesService, private readonly providers: CommunicationsProvidersService) {}

  @Get('state') state(@Query() q: any) { return run(() => this.svc.getPlatformInbox({ ...filtersFrom(q), tenantId: q.tenantId || undefined })); }

  // Platform messaging oversight dashboard — KPIs, channel mix, provider health, trends, tenant usage, failures.
  @Get('overview') overviewState(@Req() r: any, @Query() q: any) {
    const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined, tenantId: r?.ctx?.tenantId ?? null };
    return run(() => this.overview.getOverview(ctx, q || {}));
  }

  // Send Platform Announcement — targets tenant users (never customers); idempotent; recipient estimate; audited.
  @Get('announcements') listAnnouncements() { return run(() => this.announcements.listRecent()); }
  @Get('announcements/eligible-roles') eligibleRoles() { return { roles: this.announcements.eligibleRoles() }; }
  @Post('announcements') createAnnouncement(@Req() r: any, @Body(ValidatedBody(SA_ANNOUNCEMENT_BODY, { strict: true })) b: any) {
    const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined, tenantId: r?.ctx?.tenantId ?? null };
    return run(() => this.announcements.create(ctx, b || {}));
  }

  // Set Tenant Usage Limits — backend-enforced; get current limit + real usage, or upsert with a before/after audit.
  @Get('tenants/:tenantId/limits') getLimit(@Param('tenantId') tenantId: string) { return run(() => this.limits.getTenantLimit(tenantId)); }
  @Post('tenants/:tenantId/limits') setLimit(@Req() r: any, @Param('tenantId') tenantId: string, @Body(ValidatedBody(SA_TENANT_LIMIT_BODY, { strict: true })) b: any) {
    const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined, tenantId: r?.ctx?.tenantId ?? null };
    return run(() => this.limits.setTenantLimit(ctx, tenantId, b || {}));
  }

  // Message templates — append-only versioning; publishing never overwrites a prior published version.
  @Get('templates') listTemplates() { return run(() => this.templates.list()); }
  @Get('templates/:id') getTemplate(@Req() r: any, @Param('id') id: string) { return run(() => this.templates.get({ userId: r?.ctx?.userId, tenantId: r?.ctx?.tenantId ?? null }, id)); }
  @Post('templates') createTemplate(@Req() r: any, @Body(ValidatedBody(SA_TEMPLATE_BODY, { strict: true })) b: any) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined, tenantId: r?.ctx?.tenantId ?? null }; return run(() => this.templates.createTemplate(ctx, b || {})); }
  @Post('templates/:id/versions') addVersion(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(SA_TEMPLATE_VERSION_BODY, { strict: true })) b: any) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined, tenantId: r?.ctx?.tenantId ?? null }; return run(() => this.templates.addVersion(ctx, id, b || {})); }
  @Post('templates/:id/versions/:version/publish') publishVersion(@Req() r: any, @Param('id') id: string, @Param('version') version: string, @Body(ValidatedBody(EMPTY_BODY, { strict: true })) _b: any) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined, tenantId: r?.ctx?.tenantId ?? null }; return run(() => this.templates.publishVersion(ctx, id, Number(version))); }
  @Post('templates/preview') previewTemplate(@Body(ValidatedBody(SA_TEMPLATE_PREVIEW_BODY, { strict: true })) b: any) { return run(() => this.templates.preview(b || {})); }

  // Configure Communication Providers — secrets are vaulted and never returned; test validates without revealing them.
  @Get('providers') listProviders() { return run(() => this.providers.list()); }
  @Get('providers/:id') getProvider(@Param('id') id: string) { return run(() => this.providers.get(id)); }
  @Post('providers') createProvider(@Req() r: any, @Body(ValidatedBody(SA_PROVIDER_CREATE_BODY, { strict: true })) b: any) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined, tenantId: r?.ctx?.tenantId ?? null }; return run(() => this.providers.create(ctx, b || {})); }
  @Patch('providers/:id') updateProvider(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(SA_PROVIDER_UPDATE_BODY, { strict: true })) b: any) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined, tenantId: r?.ctx?.tenantId ?? null }; return run(() => this.providers.updateConfig(ctx, id, b || {})); }
  @RequireStepUp() @Post('providers/:id/rotate-credential') rotateProviderCredential(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(SA_PROVIDER_ROTATE_BODY, { strict: true })) b: any) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined, tenantId: r?.ctx?.tenantId ?? null }; return run(() => this.providers.rotateCredential(ctx, id, b || {})); }
  @Post('providers/:id/test') testProvider(@Req() r: any, @Param('id') id: string) { const ctx: AdminCtx = { userId: r?.ctx?.userId, email: r?.ctx?.email, ip: safeInet(r?.ip) ?? undefined, tenantId: r?.ctx?.tenantId ?? null }; return run(() => this.providers.testConnection(ctx, id)); }
}
