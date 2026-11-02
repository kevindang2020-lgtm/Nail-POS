/**
 * customer-tech.controller.ts — P4 customer surfaces for the portable tech-profile system.
 * PUBLIC (no session; per-IP rate-limited exactly like customer-salons; excluded from tenant middleware in app.module):
 *   GET /customer/techs/nearby · GET /customer/techs/:publicSlug · GET /customer/salons/:salonId/technicians
 * AUTHED CUSTOMER (tenant middleware applies; ctx = customer session):
 *   GET /customer/tech-ratings/pending · POST /customer/tickets/:ticketId/technician-ratings
 * Public payloads contain only public-safe fields (the service guarantees it).
 */
import { AnonRateLimit } from '@aipowersalon/security/nest';   // Security Deep Scan §28/§43/§44: per-IP limit on public routes
import { Body, Controller, Delete, Get, Header, HttpException, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { rateLimitDecision } from '@aipowersalon/auth';
import { TechProfileError, TechProfileService, type TechProfileCtx } from './tech-profile.service';
import { ListQueries } from '@aipowersalon/database';
import { CustomerTechControllerListQueries } from './customer-tech.list-queries';
import { CUSTOMER_TECH_EVENT_BODY, CUSTOMER_TECH_FAVORITE_BODY, CUSTOMER_TECH_RATING_BODY, DM_REPORT_BODY, DM_SEND_BODY } from '../request-schemas';
import { ValidatedBody } from '@aipowersalon/permissions/guards';

const hits = new Map<string, number[]>();
function limited(ip: string): boolean {
  const now = Date.now();
  const history = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  const d = rateLimitDecision(history, now, { windowMs: 60_000, maxFailures: 30, lockMs: 5 * 60_000 });
  if (!d.allowed) { hits.set(ip, history); return true; }
  history.push(now); hits.set(ip, history);
  return false;
}
function gate(r: any) {
  if (limited(String(r?.ip || 'unknown'))) throw new HttpException({ ok: false, code: 'rate_limited', message: 'Too many searches — try again in a few minutes.' }, 429);
}
function ctxFrom(req: any): TechProfileCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
function run<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((e) => {
    if (e instanceof TechProfileError) {
      const status = e.code === 'not_found' || e.code === 'not_customer' ? 404 : e.code === 'unavailable' ? 503 : e.code === 'invalid_state' ? 409 : 400;
      throw new HttpException({ ok: false, code: e.code, message: e.message }, status);
    }
    throw e;
  });
}

@ListQueries(CustomerTechControllerListQueries)
@Controller('customer')
export class CustomerTechController {
  constructor(private readonly svc: TechProfileService) {}

  // ── public discovery ──
  @Get('techs/nearby') @AnonRateLimit(30, 60_000, { bucket: 'customer-techs' })   // §28/§44: across replicas (gate() below is per instance)
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=120')
  nearby(@Req() r: any, @Query() q: any) {
    gate(r);
    return run(() => this.svc.customerNearbyTechs(Number(q?.lat), Number(q?.lng), q?.radiusMiles != null ? Number(q.radiusMiles) : undefined, q?.q, q?.minRating != null ? Number(q.minRating) : undefined));
  }

  @Get('techs/:publicSlug') @AnonRateLimit(30, 60_000, { bucket: 'customer-techs' })
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=120')
  profile(@Req() r: any, @Param('publicSlug') slug: string) {
    gate(r);
    return run(() => this.svc.customerPublicProfile(ctxFrom(r), slug));
  }

  @Get('salons/:salonId/technicians') @AnonRateLimit(30, 60_000, { bucket: 'customer-techs' })
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=120')
  salonTechs(@Req() r: any, @Param('salonId') salonId: string) {
    gate(r);
    return run(() => this.svc.customerSalonTechnicians(salonId));
  }

  @Get('salons/:salonId/services/:serviceId/technicians') @AnonRateLimit(30, 60_000, { bucket: 'customer-techs' })
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=120')
  serviceTechs(@Req() r: any, @Param('salonId') salonId: string, @Param('serviceId') serviceId: string) {
    gate(r);
    return run(() => this.svc.customerServiceTechnicians(salonId, serviceId));
  }

  // ── authed customer (tenant middleware supplies req.ctx) ──
  @Get('booking/service-technicians')
  bookingTechs(@Req() r: any, @Query('serviceId') serviceId: string, @Query('salonId') salonId?: string) { return run(() => this.svc.customerBookingServiceTechnicians(ctxFrom(r), String(serviceId ?? ''), salonId)); }

  @Get('tech-ratings/pending')
  pending(@Req() r: any) { return run(() => this.svc.customerPendingTechRatings(ctxFrom(r))); }

  @Get('tech-favorites')
  favorites(@Req() r: any) { return run(() => this.svc.customerListFavoriteTechs(ctxFrom(r))); }

  @Post('tech-favorites')
  addFavorite(@Req() r: any, @Body(ValidatedBody(CUSTOMER_TECH_FAVORITE_BODY, { strict: true })) b: any) { return run(() => this.svc.customerAddFavoriteTech(ctxFrom(r), { publicSlug: b?.publicSlug, technicianId: b?.technicianId })); }

  @Delete('tech-favorites/:publicSlug')
  removeFavorite(@Req() r: any, @Param('publicSlug') slug: string) { return run(() => this.svc.customerRemoveFavoriteTech(ctxFrom(r), slug)); }

  @Post('techs/:publicSlug/message') dmOpen(@Req() r: any, @Param('publicSlug') slug: string) { gate(r); return run(() => this.svc.customerOpenThread(ctxFrom(r), slug)); }
  @Post('techs/:publicSlug/event') trackEvent(@Req() r: any, @Param('publicSlug') slug: string, @Body(ValidatedBody(CUSTOMER_TECH_EVENT_BODY, { strict: true })) b: any) { gate(r); return run(() => this.svc.customerRecordEvent(ctxFrom(r), slug, String(b?.type ?? ''), b?.ref)); }
  @Get('messages') dmThreads(@Req() r: any) { gate(r); return run(() => this.svc.customerListThreads(ctxFrom(r))); }
  @Get('messages/:threadId') dmMessages(@Req() r: any, @Param('threadId') id: string) { gate(r); return run(() => this.svc.customerListMessages(ctxFrom(r), id)); }
  @Post('messages/:threadId') dmSend(@Req() r: any, @Param('threadId') id: string, @Body(ValidatedBody(DM_SEND_BODY, { strict: true })) b: any) { gate(r); return run(() => this.svc.customerSendMessage(ctxFrom(r), id, String(b?.body ?? ''))); }
  @Post('messages/:threadId/block') dmBlock(@Req() r: any, @Param('threadId') id: string) { gate(r); return run(() => this.svc.blockThread(ctxFrom(r), id, 'customer')); }
  @Post('messages/:threadId/report') dmReport(@Req() r: any, @Param('threadId') id: string, @Body(ValidatedBody(DM_REPORT_BODY, { strict: true })) b: any) { gate(r); return run(() => this.svc.reportThread(ctxFrom(r), id, 'customer', b?.reason)); }

  @Get('tickets/:ticketId/technician-ratings/mine')
  myRating(@Req() r: any, @Param('ticketId') ticketId: string, @Query('technicianId') technicianId: string) {
    return run(() => this.svc.customerMyTechRating(ctxFrom(r), ticketId, String(technicianId ?? '')));
  }

  @Patch('tickets/:ticketId/technician-ratings/:ratingId')
  updateRating(@Req() r: any, @Param('ticketId') ticketId: string, @Param('ratingId') ratingId: string, @Body(ValidatedBody(CUSTOMER_TECH_RATING_BODY, { strict: true })) b: any) {
    return run(() => this.svc.customerUpdateTechRating(ctxFrom(r), ticketId, ratingId, b ?? {}));
  }

  @Post('tickets/:ticketId/technician-ratings')
  rate(@Req() r: any, @Param('ticketId') ticketId: string, @Body(ValidatedBody(CUSTOMER_TECH_RATING_BODY, { strict: true })) b: any) {
    return run(() => this.svc.customerSubmitTechRating(ctxFrom(r), ticketId, b ?? {}));
  }
}
