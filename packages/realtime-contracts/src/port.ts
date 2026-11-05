// port.ts — the server-side emitter PORT domain modules publish through (Constitution 9 §12/§20; Constitution 13 §94:
// a module depends on a stable interface, never on the API's gateway). The API provides an implementation under the
// REALTIME token (InProcessEmitter today, Redis-backed behind the same interface for multi-instance). No runtime
// dependency: a token string and two types, so this package stays browser-safe.
import type { EventName } from './realtime-core';

// DI token: services inject the emitter via this token from their module factories; the @Global RealtimeModule
// provides it, so any module can list REALTIME in a useFactory `inject` array without importing RealtimeModule.
export const REALTIME = 'REALTIME_EMITTER';

type Ctx = { tenantId: string; branchId: string };

export interface RealtimeEmitter {
  toTenant(ctx: Ctx, event: EventName, payload?: unknown): void;
  toTechnician(technicianId: string, event: EventName, payload?: unknown): void;
  toTicket(ticketId: string, event: EventName, payload?: unknown): void;
  toCustomerDisplay(displayId: string, event: EventName, payload?: unknown): void;
  toOwner(tenantId: string, event: EventName, payload?: unknown): void;
  /** Constitution 9 §59/§60: the platform room — aggregates only, sealed like every other emission. */
  toPlatform(event: EventName, payload?: unknown): void;
  toCustomer?(customerId: string, event: EventName, payload?: unknown): void;
  /** 23-inch dual-screen spec §100: ONE registered customer display's own channel (rooms.customerDisplayDevice). */
  toCustomerDisplayDevice?(deviceId: string, event: EventName, payload?: unknown): void;
  /** Secure Tap to Pay M6-6: ONE payment phone's channel (rooms.paymentDevice) — never the branch room. */
  toPaymentDevice?(tenantId: string, deviceId: string, event: EventName, payload?: unknown): void;
}

/** §31–32: `seq` is monotonic PER ROOM (tenant/branch, technician, ticket…), never global. A client that sees
 *  1021 then 1023 knows it missed 1022 and must resync (§33). Assigned once at the origin node (§20's chokepoint),
 *  cross-instance via Redis INCR when the bus is Redis-backed, so two gateways never hand out the same number. */
export interface Emission { room: string; event: EventName; payload: unknown; seq?: number; }
