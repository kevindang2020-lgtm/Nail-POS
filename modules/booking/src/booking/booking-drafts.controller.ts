// booking-drafts.controller.ts — B-22 (Oct 22 2026): POS booking drafts (`/pos/booking/drafts`). A draft is the New
// Booking form saved for later (booking_holds kind 'draft', migration 676) — never an appointment. Writes need
// pos.booking.create (the same right Save Draft used to spend on a real appointment); reads need pos.booking.view.
// Declared before BookingController's bare `:appointmentId` routes by its own path prefix, so 'drafts' is never read as an id.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Delete, Body, Param, Req, UseGuards, HttpException, HttpStatus, NotFoundException, Inject, Optional } from '@nestjs/common';
import { BookingDraftError, KyselyBookingDraftRepo } from './booking-drafts';
import type { BookingContext } from './booking.repository';
import { SAVE_DRAFT_BODY } from '../request-schemas';
import type { BookingDraftView, BookingDraftsListResponse, SaveBookingDraftRequest, BookingDraftActionResponse } from '@aipowersalon/api-contracts';

function ctxFrom(req: any): BookingContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof BookingDraftError) throw new HttpException({ code: e.code === 'not_found' ? 'DRAFT_NOT_FOUND' : 'DRAFT_INVALID', message: e.message }, e.code === 'not_found' ? HttpStatus.NOT_FOUND : HttpStatus.UNPROCESSABLE_ENTITY);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/booking/drafts')
export class BookingDraftsController {
  // explicit token: the union type erases to Object in the emitted metadata, and Nest could not resolve it (the compiled
  // API refused to boot — found by the harness lane, Oct 22 2026). @Optional: no database → null → 503, never a crash.
  constructor(@Optional() @Inject(KyselyBookingDraftRepo) private readonly drafts: KyselyBookingDraftRepo | null) {}
  private need(): KyselyBookingDraftRepo { if (!this.drafts) throw new HttpException({ code: 'DRAFTS_UNAVAILABLE', message: 'Booking drafts need the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.drafts; }

  @Get() @RequirePermission('pos.booking.view') list(@Req() r: any): Promise<BookingDraftsListResponse> { return run(async () => ({ drafts: await this.need().list(ctxFrom(r)) })); }
  @Get(':draftId') @RequirePermission('pos.booking.view') get(@Req() r: any, @Param('draftId') id: string): Promise<BookingDraftView> {
    return run(async () => { const d = await this.need().get(ctxFrom(r), id); if (!d) throw new NotFoundException({ code: 'DRAFT_NOT_FOUND', message: 'Draft not found' }); return d; });
  }
  @Post() @RequirePermission('pos.booking.create') save(@Req() r: any, @Body(ValidatedBody(SAVE_DRAFT_BODY, { strict: true })) b: SaveBookingDraftRequest): Promise<BookingDraftView> { return run(() => this.need().save(ctxFrom(r), b?.payload ?? {})); }
  @Delete(':draftId') @RequirePermission('pos.booking.create') discard(@Req() r: any, @Param('draftId') id: string): Promise<BookingDraftActionResponse> {
    return run(async () => ({ ok: await this.need().discard(ctxFrom(r), id, 'draft_discarded') }));
  }
  /** The POS booked the draft normally and names it here, so it leaves the list as 'converted' (not discarded). */
  @Post(':draftId/converted') @RequirePermission('pos.booking.create') converted(@Req() r: any, @Param('draftId') id: string): Promise<BookingDraftActionResponse> {
    return run(async () => ({ ok: await this.need().discard(ctxFrom(r), id, 'converted') }));
  }
}
