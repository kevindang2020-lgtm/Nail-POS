// go-check-in.public.controller.ts — the PUBLIC customer-facing surface (`/go-check-in/*`).
// NO auth guards: a kiosk has no logged-in user. Authentication is the per-session token (header `x-checkin-token`
// or `?token=`), and tenant/branch are resolved server-side from the device — never sent by the client.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { ACCEPT_ALTERNATE_BODY, GO_APPOINTMENT_BODY, GO_CREATE_CUSTOMER_BODY, GO_CUSTOMER_BODY, GO_PHONE_BODY, GO_HEARTBEAT_BODY, GO_PIN_BODY, GO_START_BODY, GO_WALK_IN_BODY } from '../request-schemas';
import { Controller, Get, Post, Body, Param, Query, Req, Headers, HttpException } from '@nestjs/common';
import { GoCheckInService, GoCheckInError } from './go-check-in.service';
import { ListQueries } from '@aipowersalon/database';
import { GoCheckInPublicControllerListQueries } from './go-check-in.public.list-queries';
import { recordDisplayEvent } from '@aipowersalon/observability';

function tokenFrom(header?: string, q?: string): string | undefined { return header || q || undefined; }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof GoCheckInError) throw new HttpException({ message: e.message, code: e.code }, e.status);
    throw e;
  }
}

/** Dual-Screen mandate §108: a guest's check-in (appointment or walk-in) counted as done or failed — never throwing. */
async function checkInRun<T>(fn: () => Promise<T>): Promise<T> {
  try { const out = await run(fn); recordDisplayEvent('check_in'); return out; }
  catch (e) { recordDisplayEvent('check_in_failed'); throw e; }
}

@ListQueries(GoCheckInPublicControllerListQueries)
@Controller('go-check-in')
export class GoCheckInPublicController {
  constructor(private readonly svc: GoCheckInService) {}

  // ---- config + session ----
  @Get(':slug/config') config(@Param('slug') slug: string) { return run(() => this.svc.getConfig(slug)); }
  @Post(':slug/start-session') start(@Param('slug') slug: string, @Body(ValidatedBody(GO_START_BODY, { strict: true })) b: any) { return run(() => this.svc.startSession(slug, b?.branchId)); }

  @Post('session/:sessionId/heartbeat') heartbeat(@Param('sessionId') id: string, @Body(ValidatedBody(GO_HEARTBEAT_BODY, { strict: true })) b: any, @Headers('x-checkin-token') h?: string, @Query('token') q?: string) { return run(() => this.svc.heartbeat(id, tokenFrom(h, q), b)); }

  // ---- customer lookup ----
  @Post('session/:sessionId/lookup-phone') lookup(@Param('sessionId') id: string, @Body(ValidatedBody(GO_PHONE_BODY, { strict: true })) b: any, @Headers('x-checkin-token') h?: string, @Query('token') q?: string) { return run(() => this.svc.lookupPhone(id, tokenFrom(h, q), b?.phone)); }
  @Post('session/:sessionId/confirm-customer') confirm(@Param('sessionId') id: string, @Body(ValidatedBody(GO_CUSTOMER_BODY, { strict: true })) b: any, @Headers('x-checkin-token') h?: string, @Query('token') q?: string) { return run(() => this.svc.confirmCustomer(id, tokenFrom(h, q), b?.customerId)); }
  @Post('session/:sessionId/create-customer') create(@Param('sessionId') id: string, @Body(ValidatedBody(GO_CREATE_CUSTOMER_BODY, { strict: true })) b: any, @Headers('x-checkin-token') h?: string, @Query('token') q?: string) { return run(() => this.svc.createCustomer(id, tokenFrom(h, q), b)); }

  // ---- appointment ----
  @Get('session/:sessionId/today-appointments') today(@Param('sessionId') id: string, @Query('customerId') customerId: string, @Headers('x-checkin-token') h?: string, @Query('token') q?: string) { return run(() => this.svc.todayAppointments(id, tokenFrom(h, q), customerId)); }
  @Post('session/:sessionId/check-in-appointment') apptCheckIn(@Param('sessionId') id: string, @Body(ValidatedBody(GO_APPOINTMENT_BODY, { strict: true })) b: any, @Headers('x-checkin-token') h?: string, @Query('token') q?: string) { return checkInRun(() => this.svc.checkInAppointment(id, tokenFrom(h, q), b?.appointmentId)); }

  // ---- walk-in ----
  @Get('session/:sessionId/services') services(@Param('sessionId') id: string, @Headers('x-checkin-token') h?: string, @Query('token') q?: string) { return run(() => this.svc.services(id, tokenFrom(h, q))); }
  // §25: `serviceIds` (comma-separated) — only technicians qualified for those services; none → everyone working today
  @Get('session/:sessionId/technicians') technicians(@Param('sessionId') id: string, @Query('serviceIds') serviceIds?: string, @Headers('x-checkin-token') h?: string, @Query('token') q?: string) { return run(() => this.svc.technicians(id, tokenFrom(h, q), typeof serviceIds === 'string' && serviceIds ? serviceIds.split(',') : [])); }
  // BUILD_PLAN Phase 6 round 2: the guest accepts another technician when theirs is busy (this session's guest only)
  @Post('session/:sessionId/accept-alternate') acceptAlternate(@Param('sessionId') id: string, @Body(ValidatedBody(ACCEPT_ALTERNATE_BODY, { strict: true })) b: any, @Headers('x-checkin-token') h?: string, @Query('token') q?: string) { return run(() => this.svc.acceptAlternate(id, tokenFrom(h, q), b)); }
  @Post('session/:sessionId/check-in-walk-in') walkIn(@Param('sessionId') id: string, @Body(ValidatedBody(GO_WALK_IN_BODY, { strict: true })) b: any, @Headers('x-checkin-token') h?: string, @Query('token') q?: string) { return checkInRun(() => this.svc.checkInWalkIn(id, tokenFrom(h, q), b)); }

  // ---- status ----
  @Get('session/:sessionId/check-in-status') status(@Param('sessionId') id: string, @Headers('x-checkin-token') h?: string, @Query('token') q?: string) { return run(() => this.svc.status(id, tokenFrom(h, q))); }
  @Get('session/:sessionId/place-in-line') place(@Param('sessionId') id: string, @Query('checkInId') checkInId: string, @Headers('x-checkin-token') h?: string, @Query('token') q?: string) { return run(() => this.svc.placeInLine(id, tokenFrom(h, q), checkInId)); }
  @Post('session/:sessionId/complete') complete(@Param('sessionId') id: string, @Headers('x-checkin-token') h?: string, @Query('token') q?: string) { return run(() => this.svc.complete(id, tokenFrom(h, q))); }

  // ---- technician time clock (PIN entered on the kiosk; tenant/branch server-derived from the device session) ----
  @Post('session/:sessionId/technician/identify') techIdentify(@Param('sessionId') id: string, @Body(ValidatedBody(GO_PIN_BODY, { strict: true })) b: any, @Headers('x-checkin-token') h?: string, @Query('token') q?: string) { return run(() => this.svc.technicianIdentify(id, tokenFrom(h, q), b?.pin)); }
  @Post('session/:sessionId/technician/clock-in') techClockIn(@Param('sessionId') id: string, @Body(ValidatedBody(GO_PIN_BODY, { strict: true })) b: any, @Headers('x-checkin-token') h?: string, @Query('token') q?: string) { return run(() => this.svc.technicianClockIn(id, tokenFrom(h, q), b?.pin, b?.idempotencyKey)); }
  @Post('session/:sessionId/technician/clock-out') techClockOut(@Param('sessionId') id: string, @Body(ValidatedBody(GO_PIN_BODY, { strict: true })) b: any, @Headers('x-checkin-token') h?: string, @Query('token') q?: string) { return run(() => this.svc.technicianClockOut(id, tokenFrom(h, q), b?.pin, b?.idempotencyKey)); }
}
