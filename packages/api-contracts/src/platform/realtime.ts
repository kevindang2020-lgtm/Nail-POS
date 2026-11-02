// realtime.ts — wire contract (Constitution 13 §13, §15). Realm: platform. Moved from the server's own declaration so the
// server and every app use ONE definition.

export interface PlatformOpsSnapshot {
  at: string;
  activeTenants: number;
  connections: number;
  connectedTenants: number;
  paymentsPerMinute: number;
  queueJoinsPerMinute: number;
  bookingsPerMinute: number;
  eventsPerMinute: number;
  latencyP95Ms: number | null;
  health: { status: string; signals: string[] };
}
