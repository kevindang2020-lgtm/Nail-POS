// observability.ts — wire contract (Constitution 13 §13, §15). Realm: platform. The per-salon health read
// (Constitution 11 §293, GET /super-admin/tenants/:tenantId/health) — moved from the server's own declaration so the API
// and the Super Admin app use ONE definition.

export type IntegrationState = 'HEALTHY' | 'DEGRADED' | 'MISCONFIGURED' | 'RATE_LIMITED' | 'OUTAGE' | 'UNKNOWN';
export interface TenantComponent { state: IntegrationState; reason: string; details: Record<string, string | number | boolean | null> }
export interface TenantHealth { tenantId: string; tenantName: string | null; observedAt: string; overall: IntegrationState; failedQueries: string[]; components: Record<'payments' | 'messaging' | 'booking' | 'devices' | 'jobs', TenantComponent> }

/** §156 the all-salon health list: one row per salon = its LATEST hourly snapshot (§344). realtime is null = not measured. */
export type HealthListSort = 'worst' | 'name' | 'observed';
export interface TenantHealthRow {
  tenantId: string; tenantName: string | null; observedAt: string; overall: IntegrationState;
  components: Record<'payments' | 'messaging' | 'booking' | 'devices' | 'jobs', IntegrationState>; realtime: IntegrationState | null; failedQueries: string[];
}
/** One PAGE of the list (Constitution 7 §290: never every salon in one response). counts = every salon per overall state. */
export interface TenantHealthList { rows: TenantHealthRow[]; generatedAt: string; total?: number; nextCursor?: string | null; counts?: Partial<Record<IntegrationState, number>> }
