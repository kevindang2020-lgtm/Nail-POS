// realtime.controller.ts — the POS stream. Server-Sent Events (see REALTIME_ARCHITECTURE_AUDIT.md Phase 3: SSE is
// preserved — push here is server→client only, it rides the existing HTTP/Vite proxy, and the browser's
// EventSource reconnects natively). Everything about HOW a stream behaves lives in RealtimeStreamFactory (§7 one
// gateway); this controller only says WHICH rooms a POS principal gets — derived from the server context (§13).
//
// Secure Tap to Pay M6-6 (§16 / §38): a stream whose AUTHENTICATED SESSION was opened on a registered payment phone also
// joins that phone's own room (rooms.paymentDevice) — "send checkout to this phone" and its revocation reach it there.
// The device comes from the server-held session row (MobileCheckoutService.deviceRoomFor), never from the client; a lookup
// that fails leaves the stream on the branch room only (fewer rooms, never more).
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Sse, Req, UseGuards, MessageEvent, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Observable } from 'rxjs';
import { RealtimeStreamFactory } from './realtime-stream';
import { rooms } from '@aipowersalon/realtime-contracts';
import { MobileCheckoutService } from '@aipowersalon/checkout';

/** What the stream needs of the payment module: the phone a session was opened on (null = not a payment phone). */
export interface PaymentDeviceRooms { deviceRoomFor(tenantId: string | null | undefined, sessionId: string | null | undefined): Promise<string | null> }

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('realtime')
export class RealtimeController {
  private devices: PaymentDeviceRooms | null | undefined;
  constructor(private readonly streams: RealtimeStreamFactory, @Optional() private readonly moduleRef?: ModuleRef) {}
  /** Tests / a slice wiring by hand: the device lookup to use (null = none). */
  withPaymentDevices(devices: PaymentDeviceRooms | null): this { this.devices = devices; return this; }

  /** The payment module's answer, looked up once (absent in an app slice without it → branch room only, as before). */
  private paymentDevices(): PaymentDeviceRooms | null {
    if (this.devices !== undefined) return this.devices;
    try { this.devices = this.moduleRef?.get(MobileCheckoutService, { strict: false }) ?? null; }
    catch (e) { console.warn('[realtime] no MobileCheckoutService in this app — POS streams carry no payment-device room:', (e as Error)?.message); this.devices = null; }
    return this.devices;
  }

  @Sse('stream')
  @RequirePermission('pos.login')
  stream(@Req() req: any): Observable<MessageEvent> {
    const c = req?.ctx || {};
    const branch = rooms.tenantBranch(c.tenantId, c.branchId);
    const devices = this.paymentDevices();
    if (!devices) return this.streams.open(req, () => [branch], { frame: 'full' });
    return this.streams.open(req, async () => {
      try {
        const deviceId = await devices.deviceRoomFor(c.tenantId, req?.sessionId ?? c.sessionId ?? null);
        return deviceId ? [branch, rooms.paymentDevice(c.tenantId, deviceId)] : [branch];
      } catch (e) {
        console.warn('[realtime] payment-device room lookup failed — branch room only:', (e as Error)?.message);
        return [branch];
      }
    }, { frame: 'full' });
  }
}
