// ai-business.dto.ts — request/response contracts + the stable error taxonomy for the AI Business Assistant.
// Pure types + small pure builders only (no DB, no I/O). Tenant/branch/role/permissions are ALWAYS taken from
// req.ctx server-side (spec §5); nothing here trusts client-supplied identity.
import type { MetricDefinition } from './ai-business-metrics';

/** Trusted, server-derived context. Mirrors the shape other slices read from req.ctx (see commission-report). */
export interface AiBusinessContext {
  tenantId: string;
  branchId: string;          // '' = tenant-wide / no single branch selected
  userId: string;
  role: string;
  permissions: string[];     // coarse capabilities carried by the session token
  /** A4 (Nov 6 2026): a custom From–To for the 'custom' preset (validated by the assistant; at most 366 days) */
  range?: { from: string; to: string } | null;
}

/** A4 (Nov 6 2026): 'custom' is a valid preset only when the context carries a validated range. */
export function presetAllowed(ctx: AiBusinessContext, preset: string | undefined, valid: readonly string[]): boolean {
  return preset == null || valid.includes(preset) || (preset === 'custom' && !!ctx.range);
}
/** The From–To a 'custom' preset reads, merged into the report filters (nothing for a named preset). */
export function rangeFilters(ctx: AiBusinessContext, preset: string): { from?: string; to?: string } {
  return preset === 'custom' && ctx.range ? { from: ctx.range.from, to: ctx.range.to } : {};
}

/** Stable, project-compatible error codes (spec §48). User-facing messages never leak SQL/tables/keys/other tenants. */
export const AiBusinessErrorCode = {
  DISABLED: 'AI_BUSINESS_DISABLED',
  INSUFFICIENT_PERMISSION: 'INSUFFICIENT_PERMISSION',
  TENANT_NOT_FOUND: 'TENANT_NOT_FOUND',
  BRANCH_NOT_AUTHORIZED: 'BRANCH_NOT_AUTHORIZED',
  METRIC_NOT_FOUND: 'METRIC_NOT_FOUND',
  METRIC_NOT_AVAILABLE: 'METRIC_NOT_AVAILABLE',
  INVALID_DATE_RANGE: 'INVALID_DATE_RANGE',
  DATE_RANGE_TOO_LARGE: 'DATE_RANGE_TOO_LARGE',
  DATA_NOT_READY: 'DATA_NOT_READY',
  DATA_DELAYED: 'DATA_DELAYED',
  INSUFFICIENT_SAMPLE_SIZE: 'INSUFFICIENT_SAMPLE_SIZE',
  READ_REPLICA_UNAVAILABLE: 'READ_REPLICA_UNAVAILABLE',
  MODEL_PROVIDER_UNAVAILABLE: 'MODEL_PROVIDER_UNAVAILABLE',
  QUERY_TIMEOUT: 'QUERY_TIMEOUT',
  EXPORT_NOT_AUTHORIZED: 'EXPORT_NOT_AUTHORIZED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type AiBusinessErrorCode = (typeof AiBusinessErrorCode)[keyof typeof AiBusinessErrorCode];

/** A domain error carrying a stable code. The controller maps `.code` → HTTP status and a safe message. */
export class AiBusinessError extends Error {
  constructor(public readonly code: AiBusinessErrorCode, message?: string) {
    super(message || code);
    this.name = 'AiBusinessError';
  }
}
export class AiBusinessForbiddenError extends AiBusinessError {
  constructor(message = 'Not authorized') { super(AiBusinessErrorCode.INSUFFICIENT_PERMISSION, message); }
}

/** Definition metadata is safe to return as-is (it's tenant-agnostic); values come from separate data tools. */
export type MetricDefinitionView = MetricDefinition;

export interface MetricListResponse {
  metrics: MetricDefinitionView[];   // filtered to the metrics THIS user is permitted to see
  total: number;                     // count after permission filtering
}

/** Observed freshness for a metric right now (spec §24). `class` is the intended class from the registry; `observed`
 *  and `note` describe the ACTUAL state so the UI never presents stale data as current. */
export interface MetricFreshness {
  metricId: string;
  class: MetricDefinition['freshness'];
  observed: MetricDefinition['freshness'];
  asOf: string;                      // ISO timestamp the value would be current as-of
  partialCurrentDay: boolean;        // true when the period includes an incomplete current day
  note: string | null;
}
