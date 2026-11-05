// customer-display.controller.ts — PUBLIC device-facing surface for the customer display (no user session). A paired
// display authenticates with its DEVICE credential (`x-device-token`; 23-inch spec §12), a one-off session display with
// its per-session token (`x-display-token`); the `?deviceToken=` / `?token=` query forms remain for displays built before
// the header-only stream. An unpaired display may only ask for a pairing code and poll it (§8). It carries NO
// @RequirePermission, so the global RolePermissionGuard lets it through; the credential is verified in the services.
import { Controller, Get, Post, Sse, Param, Query, Body, Req, BadRequestException, ForbiddenException, NotFoundException, HttpException, HttpStatus, MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { createHash } from 'node:crypto';
import { clientIp } from '@aipowersalon/security';
import { recordDisplayEvent } from '@aipowersalon/observability';
import { GoCheckInError } from '@aipowersalon/queue';
import { CustomerDisplayService, DisplayError, type DisplayStandardCode } from './customer-display.service';
import { DisplayDevicesService } from './display-devices.service';
import { runDisplayDevice } from './display-devices.controller';
import { RealtimeStreamFactory } from '../realtime/realtime-stream';
import { WindowLimiter } from '../observability/client-errors.controller';
import { DISPLAY_AD_DISPLAYS_BODY, DISPLAY_HEARTBEAT_BODY, DISPLAY_METHOD_BODY, DISPLAY_PAIRING_POLL_BODY, DISPLAY_PAIRING_START_BODY, DISPLAY_PHONE_CODE_BODY, DISPLAY_RATING_BODY, DISPLAY_RECEIPT_BODY, DISPLAY_RELEASE_BODY, DISPLAY_TIP_BODY } from './request-schemas';
import { ValidatedBody } from '@aipowersalon/permissions/guards';

/** A display refusal as HTTP: its §104 standard code (when it has one) in the body, with that code's registry status. */
const STANDARD_STATUS: Record<DisplayStandardCode, number> = { DISPLAY_SESSION_NOT_FOUND: 404, DISPLAY_SESSION_EXPIRED: 410 };
export function displayHttpError(e: DisplayError): HttpException {
  if (e.standard) return new HttpException({ message: e.message, code: e.standard }, STANDARD_STATUS[e.standard]);
  if (e.code === 'forbidden') return new ForbiddenException(e.message);
  if (e.code === 'not_found') return new NotFoundException(e.message);
  return new BadRequestException(e.message);
}

function run<T>(fn: () => Promise<T>): Promise<T> {
  return runDisplayDevice(fn).catch((e) => {
    if (e instanceof DisplayError) throw displayHttpError(e);
    throw e;
  });
}

/** 23-inch spec §8: pairing codes a network may ask for per minute (a salon's displays restart rarely; a code lasts 10
 *  minutes) and an instance's ceiling — the public start is a write anyone can reach, so it is rate-limited at the door. */
export const PAIRING_STARTS_PER_IP_PER_MINUTE = 6;
export const PAIRING_STARTS_PER_INSTANCE_PER_MINUTE = 300;
/** 23-inch spec §8/§18 (Unit 7): check-in sessions a display may start a minute (one per guest — a busy front door is a
 *  few a minute) and an instance's ceiling. Each session carries its own lookup / new-profile limits. */
export const CHECK_IN_SESSIONS_PER_DISPLAY_PER_MINUTE = 30;
export const CHECK_IN_SESSIONS_PER_INSTANCE_PER_MINUTE = 3000;

@Controller('customer-display')
export class CustomerDisplayController {
  constructor(private readonly svc: CustomerDisplayService, private readonly streams: RealtimeStreamFactory, private readonly devices: DisplayDevicesService) {}
  readonly pairingLimiter = new WindowLimiter(PAIRING_STARTS_PER_IP_PER_MINUTE, PAIRING_STARTS_PER_INSTANCE_PER_MINUTE);
  readonly checkInLimiter = new WindowLimiter(CHECK_IN_SESSIONS_PER_DISPLAY_PER_MINUTE, CHECK_IN_SESSIONS_PER_INSTANCE_PER_MINUTE);

  // ---- 23-inch spec §8–§12: a display with no credential pairs ITSELF (public). The code it is given means nothing until
  //      the owner types it into the POS; the display then collects its device credential with the secret only it holds.
  @Post('pairing')
  startPairing(@Req() req: any, @Body(ValidatedBody(DISPLAY_PAIRING_START_BODY)) body: any) {
    if (!this.pairingLimiter.allow(clientIp(req) ?? 'unknown')) {
      throw new HttpException({ message: 'Too many pairing codes were requested from this network. Wait a minute and try again.', error: 'rate_limited' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    return run(() => this.devices.startPairing(body));
  }

  @Post('pairing/:pairingId/poll')
  pollPairing(@Param('pairingId') pairingId: string, @Body(ValidatedBody(DISPLAY_PAIRING_POLL_BODY)) body: any) {
    return run(() => this.devices.pollPairing(pairingId, body?.pollSecret));
  }
  private tok(req: any, q?: string): string | undefined { return (req?.headers?.['x-display-token'] as string) || q; }

  @Get('checkout/:sessionId')
  state(@Req() req: any, @Param('sessionId') sid: string, @Query('token') token?: string) {
    return run(() => this.svc.getState(sid, this.tok(req, token)));
  }

  @Post('checkout/:sessionId/tip')
  tip(@Req() req: any, @Param('sessionId') sid: string, @Body(ValidatedBody(DISPLAY_TIP_BODY)) body: any, @Query('token') token?: string) {
    return run(() => this.svc.submitTip(sid, this.tok(req, token), body || {}));
  }

  @Post('checkout/:sessionId/method')
  methodSel(@Req() req: any, @Param('sessionId') sid: string, @Body(ValidatedBody(DISPLAY_METHOD_BODY)) body: any, @Query('token') token?: string) {
    return run(() => this.svc.submitMethod(sid, this.tok(req, token), body?.method));
  }

  @Post('checkout/:sessionId/pay')
  pay(@Req() req: any, @Param('sessionId') sid: string, @Query('token') token?: string) {
    return run(() => this.svc.requestPayment(sid, this.tok(req, token)));
  }

  @Post('checkout/:sessionId/rating')
  rating(@Req() req: any, @Param('sessionId') sid: string, @Body(ValidatedBody(DISPLAY_RATING_BODY)) body: any, @Query('token') token?: string) {
    return run(() => this.svc.submitRating(sid, this.tok(req, token), Number(body?.rating)));
  }

  // 23-inch spec §97–§98: the customer's receipt choice (body: { choice: 'sms' | 'email' | 'none' | 'auto' })
  @Post('checkout/:sessionId/receipt')
  receipt(@Req() req: any, @Param('sessionId') sid: string, @Body(ValidatedBody(DISPLAY_RECEIPT_BODY)) body: any, @Query('token') token?: string) {
    return run(() => this.svc.submitReceipt(sid, this.tok(req, token), body));
  }

  @Sse('checkout/:sessionId/stream')
  stream(@Req() req: any, @Param('sessionId') sid: string, @Query('token') token?: string): Observable<MessageEvent> {
    // Constitution 9 §7: opened by the shared factory (sequence numbers, resync on reconnect, slow-client gate, origin
    // check, connect limiter). The display holds a session TOKEN, not a user context, so presence/authz revalidation do
    // not apply; access is decided per session and a refusal closes the stream with `forbidden`.
    const t = this.tok(req, token);
    return this.streams.open(req, async () => {
      if (!(await this.svc.canAccess(sid, t))) throw new ForbiddenException('display session cannot access this checkout');
      return [this.svc.room(sid)];
    }, { frame: 'event-only' });
  }

  // ---- device mode: a mounted iPad authenticated by its per-device token (x-device-token / ?deviceToken=) ----
  private devTok(req: any, q?: string): string | undefined { return (req?.headers?.['x-device-token'] as string) || q; }

  @Get('device/current')
  deviceCurrent(@Req() req: any, @Query('deviceToken') token?: string) {
    return run(() => this.svc.getDeviceState(this.devTok(req, token)));
  }

  @Post('device/tip')
  deviceTip(@Req() req: any, @Body(ValidatedBody(DISPLAY_TIP_BODY)) body: any, @Query('deviceToken') token?: string) {
    return run(() => this.svc.submitTipForDevice(this.devTok(req, token), body || {}));
  }

  @Post('device/method')
  deviceMethod(@Req() req: any, @Body(ValidatedBody(DISPLAY_METHOD_BODY)) body: any, @Query('deviceToken') token?: string) {
    return run(() => this.svc.submitMethodForDevice(this.devTok(req, token), body?.method));
  }

  @Post('device/pay')
  devicePay(@Req() req: any, @Query('deviceToken') token?: string) {
    return run(() => this.svc.requestPaymentForDevice(this.devTok(req, token)));
  }

  @Post('device/rating')
  deviceRating(@Req() req: any, @Body(ValidatedBody(DISPLAY_RATING_BODY)) body: any, @Query('deviceToken') token?: string) {
    return run(() => this.svc.submitRatingForDevice(this.devTok(req, token), Number(body?.rating)));
  }

  // 23-inch spec §97–§98: the customer's receipt choice on the display (body: { choice: 'sms' | 'email' | 'none' | 'auto' })
  @Post('device/receipt')
  deviceReceipt(@Req() req: any, @Body(ValidatedBody(DISPLAY_RECEIPT_BODY)) body: any, @Query('deviceToken') token?: string) {
    return run(() => this.svc.submitReceiptForDevice(this.devTok(req, token), body));
  }

  // Phase 3 (customer phone management): the customer types their phone-change code on the display (body: { code }).
  @Post('device/phone-code')
  devicePhoneCode(@Req() req: any, @Body(ValidatedBody(DISPLAY_PHONE_CODE_BODY)) body: any, @Query('deviceToken') token?: string) {
    return run(() => this.svc.submitPhoneCodeForDevice(this.devTok(req, token), String(body?.code ?? '')));
  }

  // 23-inch spec §85–§86: every 30 s (and on every mode change) the display reports its mode, app version, screen and
  // profile; the answer tells it whether the owner put it in maintenance
  @Post('device/heartbeat')
  deviceHeartbeat(@Req() req: any, @Body(ValidatedBody(DISPLAY_HEARTBEAT_BODY)) body: any, @Query('deviceToken') token?: string) {
    return run(() => this.svc.heartbeatForDevice(this.devTok(req, token), body));
  }

  // 23-inch spec §8, §12, §18 (Unit 7): a guest's check-in session, started with THIS display's credential (salon and
  // branch are the display's). The display then drives the shared /go-check-in/session/* routes with the session token,
  // and starts a fresh session after every guest.
  @Post('device/check-in/session')
  deviceCheckInSession(@Req() req: any, @Query('deviceToken') token?: string) {
    const credential = this.devTok(req, token);
    const key = credential ? createHash('sha256').update(credential).digest('hex').slice(0, 24) : 'none';
    if (!this.checkInLimiter.allow(key)) {
      throw new HttpException({ message: 'Too many check-ins started on this display. Wait a moment and try again.', error: 'rate_limited' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    return run(() => this.svc.startCheckInSession(credential)).catch((e) => {
      if (e instanceof GoCheckInError) throw new HttpException({ message: e.message, code: e.code }, e.status);
      throw e;
    });
  }

  // 23-inch spec §43–§46: after its 3 seconds on the completed checkout the display releases it; the server ends the
  // session so the customer can never reappear (body: { sessionId } — the checkout the display was showing).
  @Post('device/release')
  deviceRelease(@Req() req: any, @Body(ValidatedBody(DISPLAY_RELEASE_BODY)) body: any, @Query('deviceToken') token?: string) {
    return run(() => this.svc.releaseForDevice(this.devTok(req, token), body?.sessionId));
  }

  // 23-inch spec §47–§74: the salon's advertising playlist for THIS display (tenant/branch/device from its credential)
  @Get('device/ads')
  deviceAds(@Req() req: any, @Query('deviceToken') token?: string) {
    return run(() => this.svc.deviceAdsPlaylist(this.devTok(req, token)));
  }

  // 23-inch spec §108: the display reports which ads it showed and for how long (body: { batchId, displays[] })
  @Post('device/ads/displays')
  deviceAdDisplays(@Req() req: any, @Body(ValidatedBody(DISPLAY_AD_DISPLAYS_BODY)) body: any, @Query('deviceToken') token?: string) {
    return run(() => this.svc.recordDeviceAdDisplays(this.devTok(req, token), body));
  }

  @Sse('device/stream')
  deviceStream(@Req() req: any, @Query('deviceToken') token?: string): Observable<MessageEvent> {
    const t = this.devTok(req, token);
    return this.streams.open(req, async () => {
      if (!(await this.svc.deviceValid(t))) throw new ForbiddenException('invalid device token');
      recordDisplayEvent('reconnect');   // Dual-Screen §108: a display (re)opened its stream — a restart, a network blip, a new checkout
      return this.svc.deviceRooms(t);   // the device's own channel, plus its checkout's session + ticket rooms
    }, { frame: 'event-only' });
  }
}
