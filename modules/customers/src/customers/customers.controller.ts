// customers.controller.ts — tenant POS Customers HTTP surface (`/pos/customers/*`).
// Guards: TenantAuthGuard + RolePermissionGuard. tenant/branch/role from req.ctx (session).
// Literal + /duplicates + :id/sub routes are declared BEFORE the bare ':customerId' so it never shadows them.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, AsyncExport, ValidatedBody } from '@aipowersalon/permissions/guards';
import { recordConflict } from '@aipowersalon/observability';
import { Controller, Get, Post, Patch, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { CustomersService, ForbiddenError, ValidationError } from './customers.service';
import { LimitExceededError } from '@aipowersalon/platform';
import type { CustomersContext } from './customers.repository';
import type { CustomerFilters, CreateCustomerRequest, EditCustomerRequest } from './customers.dto';
import { CustomerVersionConflict } from './customers.dto';
import type { CustomerQuickActivity } from '@aipowersalon/api-contracts/tenant';
import { ListQueries } from '@aipowersalon/database';
import { Idempotent } from '@aipowersalon/database/nest';
import { CustomersControllerListQueries } from './customers.list-queries';

import type { CustomerNotesReviewResponse } from '@aipowersalon/api-contracts/tenant';
import { CREATE_CUSTOMER_BODY, CUSTOMER_IMPORT_BODY, CUSTOMER_LOYALTY_BODY, CUSTOMER_MEMBERSHIP_BODY, CUSTOMER_NOTES_BODY, CUSTOMER_TAGS_BODY, DUPLICATE_MERGE_BODY, EDIT_CUSTOMER_BODY, LOYALTY_ADJUST_BODY } from '../request-schemas';   // BUILD_PLAN Phase 12 (#17)
function ctxFrom(req: any): CustomersContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
function filtersFrom(q: any): CustomerFilters {
  const n = (v: any) => (v === undefined || v === '' ? undefined : Number(v));
  return { search: q.search, status: q.status, segment: q.segment, loyaltyTier: q.loyaltyTier, source: q.source, tag: q.tag, birthdayMonth: q.birthdayMonth, inactiveDays: n(q.inactiveDays), duplicateRisk: q.duplicateRisk, marketingOptIn: q.marketingOptIn, spendBand: q.spendBand, page: n(q.page), pageSize: n(q.pageSize) };
}
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    // Smooth Refresh spec §14: an edit based on an older copy → 409 with the stable code + the current version.
    if (e instanceof CustomerVersionConflict) { recordConflict('customers', e.code); throw new HttpException({ message: e.message, code: e.code, currentVersion: e.currentVersion, serverTime: new Date().toISOString() }, HttpStatus.CONFLICT); }
    // §58: a coded validation (field / rule / params, or its own code) travels as code + details beside the English message
    if (e instanceof ValidationError) throw new HttpException(e.detail ? { code: e.detail.code ?? 'VALIDATION_FAILED', message: e.message, details: { ...(e.detail.field ? { field: e.detail.field } : {}), ...(e.detail.rule ? { rule: e.detail.rule } : {}), ...(e.detail.params ?? {}), ...(e.detail.params ? { params: e.detail.params } : {}) } } : e.message, HttpStatus.BAD_REQUEST);
    if (e instanceof LimitExceededError) throw new HttpException(e.message, HttpStatus.CONFLICT);
    if ((e as { name?: string })?.name === 'MembershipNotSettableError') throw new HttpException({ code: 'CONFLICT', message: (e as Error).message }, HttpStatus.CONFLICT);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(CustomersControllerListQueries)
@Controller('pos/customers')
export class CustomersController {
  constructor(private readonly svc: CustomersService) {}

  // literal GETs
  @Get('state') @RequirePermission('pos.customers.view') state(@Req() r: any, @Query() q: any) { return run(() => this.svc.getState(ctxFrom(r), filtersFrom(q))); }
  @Get('kpis') @RequirePermission('pos.customers.view') kpis(@Req() r: any) { return run(() => this.svc.getKpis(ctxFrom(r))); }
  @Get('search') @RequirePermission('pos.customers.view') search(@Req() r: any, @Query() q: any) { return run(() => this.svc.search(ctxFrom(r), filtersFrom(q))); }
  @AsyncExport({ kind: 'pos.customers.export', maxSyncRows: 20_000, estimate: { table: 'customers' } }) @Get('export') @RequirePermission('pos.customers.export') export(@Req() r: any, @Query() q: any) { return run(() => this.svc.export(ctxFrom(r), filtersFrom(q))); }

  // duplicates (before :customerId)
  @Get('duplicates') @RequirePermission('pos.customers.view') duplicates(@Req() r: any) { return run(() => this.svc.duplicates(ctxFrom(r))); }
  // POST duplicates/:id/decision retired Nov 2 2026 → POST /pos/duplicate-review/groups/:id/decision (same customer_duplicate_decisions pairs + the review timeline)
  @Post('duplicates/:duplicateGroupId/merge') @RequirePermission('pos.customers.merge') merge(@Req() r: any, @Param('duplicateGroupId') gid: string, @Body(ValidatedBody(DUPLICATE_MERGE_BODY, { strict: true })) b: any) { return run(() => this.svc.merge(ctxFrom(r), gid, b?.primaryCustomerId)); }

  // list + create + import
  @Get('') @RequirePermission('pos.customers.view') list(@Req() r: any, @Query() q: any) { return run(() => this.svc.list(ctxFrom(r), filtersFrom(q))); }
  // F1 §53: a repeated tap or a retry after a lost answer replays the first result (Idempotency-Key), never a second profile
  @Post('') @RequirePermission('pos.customers.create') @Idempotent() create(@Req() r: any, @Body(ValidatedBody(CREATE_CUSTOMER_BODY, { strict: true })) b: CreateCustomerRequest) { return run(() => this.svc.create(ctxFrom(r), b)); }
  @Post('import') @RequirePermission('pos.customers.import') import(@Req() r: any, @Body(ValidatedBody(CUSTOMER_IMPORT_BODY, { strict: true })) b: any) { return run(() => this.svc.import(ctxFrom(r), b?.csv)); }
  @Post('import/preview') @RequirePermission('pos.customers.import') importPreview(@Req() r: any, @Body(ValidatedBody(CUSTOMER_IMPORT_BODY, { strict: true })) b: any) { return run(() => this.svc.importPreview(ctxFrom(r), b?.csv, { updateExisting: !!b?.updateExisting })); }
  @Post('import/commit') @RequirePermission('pos.customers.import') importCommit(@Req() r: any, @Body(ValidatedBody(CUSTOMER_IMPORT_BODY, { strict: true })) b: any) { return run(() => this.svc.importCommit(ctxFrom(r), b?.csv, { updateExisting: !!b?.updateExisting })); }

  // :customerId/sub-resources (before bare :customerId)
  @Post(':customerId/archive') @RequirePermission('pos.customers.archive') archive(@Req() r: any, @Param('customerId') id: string) { return run(() => this.svc.archive(ctxFrom(r), id)); }
  @Post(':customerId/reactivate') @RequirePermission('pos.customers.archive') reactivate(@Req() r: any, @Param('customerId') id: string) { return run(() => this.svc.reactivate(ctxFrom(r), id)); }
  @Get(':customerId/visits') @RequirePermission('pos.customers.view') visits(@Req() r: any, @Param('customerId') id: string) { return run(() => this.svc.visits(ctxFrom(r), id)); }
  @Get(':customerId/appointments') @RequirePermission('pos.customers.view') appts(@Req() r: any, @Param('customerId') id: string) { return run(() => this.svc.appointments(ctxFrom(r), id)); }
  @Get(':customerId/tickets') @RequirePermission('pos.customers.view') tickets(@Req() r: any, @Param('customerId') id: string) { return run(() => this.svc.tickets(ctxFrom(r), id)); }
  @Get(':customerId/receipts') @RequirePermission('pos.customers.view') receipts(@Req() r: any, @Param('customerId') id: string) { return run(() => this.svc.receipts(ctxFrom(r), id)); }
  // extras Customer 03 (Nov 13 2026): the Quick View's receipts + activity — one read-only staff read, no printing / resend controls
  @Get(':customerId/quick-activity') @RequirePermission('pos.customers.view') quickActivity(@Req() r: any, @Param('customerId') id: string): Promise<CustomerQuickActivity> { return run(() => this.svc.quickActivity(ctxFrom(r), id)); }
  @Get(':customerId/notes') @RequirePermission('pos.customers.notes.view') gNotes(@Req() r: any, @Param('customerId') id: string) { return run(() => this.svc.getNotes(ctxFrom(r), id)); }
  // extras Customer Notes 6 · 02 (round 10): stale / conflicting preferences with their evidence — read only
  @Get(':customerId/notes/review') @RequirePermission('pos.customers.notes.view') notesReview(@Req() r: any, @Param('customerId') id: string): Promise<CustomerNotesReviewResponse> { return run(() => this.svc.notesReview(ctxFrom(r), id)); }
  @Patch(':customerId/notes') @RequirePermission('pos.customers.notes.edit') sNotes(@Req() r: any, @Param('customerId') id: string, @Body(ValidatedBody(CUSTOMER_NOTES_BODY, { strict: true })) b: any) { return run(() => this.svc.setNotes(ctxFrom(r), id, b)); }
  @Get(':customerId/tags') @RequirePermission('pos.customers.view') gTags(@Req() r: any, @Param('customerId') id: string) { return run(() => this.svc.getTags(ctxFrom(r), id)); }
  @Patch(':customerId/tags') @RequirePermission('pos.customers.edit') sTags(@Req() r: any, @Param('customerId') id: string, @Body(ValidatedBody(CUSTOMER_TAGS_BODY, { strict: true })) b: any) { return run(() => this.svc.setTags(ctxFrom(r), id, b?.tags || [])); }
  @Get(':customerId/loyalty') @RequirePermission('pos.customers.view') gLoyalty(@Req() r: any, @Param('customerId') id: string) { return run(() => this.svc.getLoyalty(ctxFrom(r), id)); }
  @Patch(':customerId/loyalty') @RequirePermission('pos.customers.loyalty.edit') sLoyalty(@Req() r: any, @Param('customerId') id: string, @Body(ValidatedBody(CUSTOMER_LOYALTY_BODY, { strict: true })) b: any) { return run(() => this.svc.setLoyalty(ctxFrom(r), id, b)); }
  @Get(':customerId/membership') @RequirePermission('pos.customers.view') gMember(@Req() r: any, @Param('customerId') id: string) { return run(() => this.svc.getMembership(ctxFrom(r), id)); }
  @Patch(':customerId/membership') @RequirePermission('pos.customers.membership.edit') sMember(@Req() r: any, @Param('customerId') id: string, @Body(ValidatedBody(CUSTOMER_MEMBERSHIP_BODY, { strict: true })) b: any) { return run(() => this.svc.setMembership(ctxFrom(r), id, b)); }
  @Get(':customerId/gift-cards') @RequirePermission('pos.customers.view') giftCards(@Req() r: any, @Param('customerId') id: string) { return run(() => this.svc.giftCards(ctxFrom(r), id)); }
  @Get(':customerId/loyalty-ledger') @RequirePermission('pos.customers.view') gLoyaltyLedger(@Req() r: any, @Param('customerId') id: string) { return run(() => this.svc.getLoyaltyLedger(ctxFrom(r), id)); }
  @Post(':customerId/loyalty-adjust') @RequirePermission('pos.customers.loyalty.edit') sLoyaltyAdjust(@Req() r: any, @Param('customerId') id: string, @Body(ValidatedBody(LOYALTY_ADJUST_BODY, { strict: true })) b: any) { return run(() => this.svc.adjustLoyaltyPoints(ctxFrom(r), id, b)); }

  // bare :customerId LAST
  @Get(':customerId') @RequirePermission('pos.customers.view') detail(@Req() r: any, @Param('customerId') id: string) { return run(() => this.svc.detail(ctxFrom(r), id)); }
  @Patch(':customerId') @RequirePermission('pos.customers.edit') update(@Req() r: any, @Param('customerId') id: string, @Body(ValidatedBody(EDIT_CUSTOMER_BODY, { strict: true })) b: EditCustomerRequest) { return run(() => this.svc.update(ctxFrom(r), id, b)); }
}
