// voice-gateway-metrics.service.ts — honest, in-process operational counters for the Booking Gateway (spec §28).
// Single-instance, since-process-start (like the rate limiter); resets on restart, and the snapshot says so. No
// fabricated numbers: a metric that hasn't happened reads 0, and rates are null until there's a denominator. This is
// NOT a tenant-level analytics store (that's VoiceCallOutcomeService) — it's lightweight gateway health for the
// admin to watch during pilot rollout. Deliberately low-cardinality: per-operation and per-error-code only, never
// per-tenant labels (§28 warns against unbounded tenant labels).
import { Injectable } from '@nestjs/common';

export type GwOp = 'services' | 'hours' | 'availability' | 'customer' | 'book' | 'get_appointment' | 'reschedule' | 'cancel' | 'handoff';

export interface GatewayMetricsSnapshot {
  since: string;                                  // ISO process-start; the window these counts cover
  totalRequests: number;
  totalErrors: number;
  successRatePct: number | null;                  // null until there's at least one request
  idempotentReplays: number;
  rateLimitEvents: number;
  handoffs: number;
  byOperation: Record<string, { requests: number; errors: number }>;
  byErrorCode: Record<string, number>;
}

@Injectable()
export class VoiceGatewayMetricsService {
  private readonly since = new Date().toISOString();
  private total = 0;
  private errors = 0;
  private replays = 0;
  private rateLimits = 0;
  private handoffCount = 0;
  private ops = new Map<GwOp, { requests: number; errors: number }>();
  private codes = new Map<string, number>();

  private op(o: GwOp) { let r = this.ops.get(o); if (!r) { r = { requests: 0, errors: 0 }; this.ops.set(o, r); } return r; }

  request(o: GwOp) { this.total++; this.op(o).requests++; }
  success(o: GwOp) { /* request() already counted it; success = request − error, derived in the snapshot */ void o; }
  error(o: GwOp, code: string) { this.errors++; this.op(o).errors++; this.codes.set(code, (this.codes.get(code) ?? 0) + 1); if (code === 'RATE_LIMIT_EXCEEDED') this.rateLimits++; }
  replay() { this.replays++; }
  handoff() { this.handoffCount++; }

  snapshot(): GatewayMetricsSnapshot {
    const byOperation: Record<string, { requests: number; errors: number }> = {};
    for (const [k, v] of this.ops) byOperation[k] = { ...v };
    const byErrorCode: Record<string, number> = {};
    for (const [k, v] of this.codes) byErrorCode[k] = v;
    return {
      since: this.since,
      totalRequests: this.total,
      totalErrors: this.errors,
      successRatePct: this.total > 0 ? Math.round(((this.total - this.errors) / this.total) * 1000) / 10 : null,
      idempotentReplays: this.replays,
      rateLimitEvents: this.rateLimits,
      handoffs: this.handoffCount,
      byOperation,
      byErrorCode,
    };
  }
}
