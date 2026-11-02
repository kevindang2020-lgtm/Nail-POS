// customer-timeline-center.controller.ts — Customer Timeline guide (Nov 1 2026): `/pos/customer-timeline/*`.
// Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch / role come from the session (req.ctx), never the client.
//   pos.customers.view          customers/:id/events · customers/:id/events/:eventId (audited fail-closed) · check (read-only)
//   + pos.checkout.view         payment / refund / receipt / visit amounts, card brand + last 4, tips
//   + pos.communications.view   message text
//   + pos.memberships.view      membership amounts
// Customer lookup and the 360° summary are Customer Search's routes (/pos/customer-search/customers[/:id]) — reused.
// The timeline is factual history, so it follows the core customer permission, not the AI package.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { hasPermission, S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { recordAuditStrict } from '@aipowersalon/audit';
import { isUuid, type RetentionContext } from '../retention/retention.repository';
import { CustomerTimelineCenter, CustomerTimelineError, TL_FAMILIES, TL_DATE_FIELDS, TL_PRESETS, type TlView } from './customer-timeline-center';

export const CUSTOMER_TIMELINE_CENTER = 'CustomerTimelineCenter';
export const TL_CHECK_BODY: BodySchema = S.object({});

function ctxFrom(req: any): RetentionContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [], salonName: c.salonName,
    authz: c.authz ? { scope: c.authz.scope ?? null, branchIds: Array.isArray(c.authz.branchIds) ? c.authz.branchIds : null } : null };
}
function need(ctx: RetentionContext, ...perms: string[]) {
  if (!ctx?.tenantId || !ctx?.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED');
  for (const perm of perms) if (!hasPermission(ctx as Parameters<typeof hasPermission>[0], perm)) throw new HttpException({ code: 'PERMISSION_DENIED', message: 'Your role cannot do this.' }, HttpStatus.FORBIDDEN);
}
const can = (ctx: RetentionContext, perm: string) => hasPermission(ctx as Parameters<typeof hasPermission>[0], perm);
const viewOf = (c: RetentionContext): TlView => ({ money: can(c, 'pos.checkout.view'), messages: can(c, 'pos.communications.view'), memberships: can(c, 'pos.memberships.view') });
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof CustomerTimelineError) throw new HttpException({ code: e.code, message: e.message, details: e.details }, e.status);
    throw e;
  }
}
const actor = (c: RetentionContext) => ({ tenantId: c.tenantId, branchId: isUuid(c.branchId) ? c.branchId : null, userId: c.userId, role: c.role });
const LIST = {
  filters: {
    family: { type: 'enum', values: TL_FAMILIES }, dateField: { type: 'enum', values: TL_DATE_FIELDS }, preset: { type: 'enum', values: TL_PRESETS },
    technician: { type: 'uuid' }, branch: { type: 'text', maxLength: 40 },
  },
  sorts: { newest: null, oldest: null, recently_added: null }, search: { maxLength: 100 }, dateRange: { maxDays: 7320 },
  maxLimit: 100, defaultLimit: 25, params: ['page'],
} as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/customer-timeline')
export class CustomerTimelineCenterController {
  constructor(@Inject(CUSTOMER_TIMELINE_CENTER) private readonly tl: CustomerTimelineCenter | null) {}
  private r(): CustomerTimelineCenter { if (!this.tl) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Customer Timeline needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.tl; }

  /** one customer's source-linked events: family · technician · branch · date field + range · q (appointment / ticket id or
   *  number, technician, service) · sort (newest occurred first by default) · pages 10/25/50/100 */
  @Get('customers/:id/events') @RequirePermission('pos.customers.view')
  @ListQuery(LIST)
  events(@Req() q: any, @Param('id') id: string, @Query() f: any) { const c = ctxFrom(q); need(c, 'pos.customers.view'); return run(() => this.r().events(c, id, f ?? {}, viewOf(c))); }

  /** one event re-read from its source + its visit's services and technicians — audited, fail-closed */
  @Get('customers/:id/events/:eventId') @RequirePermission('pos.customers.view')
  event(@Req() q: any, @Param('id') id: string, @Param('eventId') eventId: string) {
    const c = ctxFrom(q); need(c, 'pos.customers.view');
    return run(() => this.r().event(c, id, eventId, viewOf(c), (trx, meta) => recordAuditStrict(trx, actor(c), { module: 'customers', action: 'customer_timeline.event_viewed', resourceType: 'customer', resourceId: id, summary: 'Customer timeline event opened', metadata: meta })));
  }

  /** Check Customer Timeline System — read-only; records what it observed; never books, merges, charges or sends */
  @Post('check') @RequirePermission('pos.customers.view')
  check(@Req() q: any, @Body(ValidatedBody(TL_CHECK_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); need(c, 'pos.customers.view'); return run(() => this.r().check(c)); }
}
