// telemetry-search.ts — BUILD_PLAN Phase 14 A (Constitution 11 §181, §291–292): the wire shapes of the Super Admin request /
// correlation / trace / log search over the platform's own telemetry store (GET /super-admin/observability/*).
//
// §181 field-level permissions: every response says whether it was REDACTED. A caller with super_admin.telemetry.view only
// gets the aggregate-safe projection — tenant ids null, routes with id segments collapsed to `:id`, error messages and
// non-whitelisted fields removed; super_admin.telemetry.sensitive.view returns the stored (already redacted) rows as-is.
export type TelemetryLevel = 'info' | 'warn' | 'error' | 'fatal';
export const TELEMETRY_SENSITIVE_PERMISSION = 'super_admin.telemetry.sensitive.view';
export const TELEMETRY_VIEW_PERMISSION = 'super_admin.telemetry.view';

export interface TelemetryLogLine {
  ts: string; level: TelemetryLevel | 'debug' | 'trace'; service: string; processRole: string;
  requestId: string | null; correlationId: string | null; traceId: string | null; spanId: string | null;
  tenantId: string | null; route: string | null; status: number | null; durationMs: number | null;
  msg: string; fields: Record<string, unknown>;
}

export interface TelemetryRequestSummary {
  requestId: string; kind: 'request' | 'job' | 'event' | 'other';
  startedAt: string; lastAt: string; correlationId: string | null; traceId: string | null; tenantId: string | null;
  route: string | null; status: number | null; durationMs: number | null; lines: number; maxLevel: TelemetryLevel; service: string | null;
}

export interface TelemetrySpanNode {
  spanId: string; parentSpanId: string | null; name: string; kind: string; service: string;
  startTs: string; offsetMs: number; durationMs: number; depth: number; status: 'unset' | 'ok' | 'error'; statusMessage: string | null;
  attributes: Record<string, unknown>; tenantId: string | null; logs: TelemetryLogLine[];
}

export interface TelemetryRequestList { redacted: boolean; from: string; to: string; items: TelemetryRequestSummary[] }
export interface TelemetryLogList { redacted: boolean; from: string; to: string; items: TelemetryLogLine[] }
export interface TelemetryRequestDetail { redacted: boolean; summary: TelemetryRequestSummary | null; traceIds: string[]; logs: TelemetryLogLine[] }
export interface TelemetryTraceView {
  redacted: boolean; traceId: string; startedAt: string | null; durationMs: number; spans: TelemetrySpanNode[];
  /** Lines of the trace whose span is not in the store (or that carried no span id). */
  unattachedLogs: TelemetryLogLine[];
}
export interface TelemetryCorrelationView {
  redacted: boolean; correlationId: string;
  requests: TelemetryRequestSummary[]; jobs: TelemetryRequestSummary[]; events: TelemetryRequestSummary[];
  traceIds: string[];
  providerCalls: Array<{ traceId: string; spanId: string; name: string; startTs: string; durationMs: number; status: 'unset' | 'ok' | 'error' }>;
  logs: TelemetryLogLine[];
}
