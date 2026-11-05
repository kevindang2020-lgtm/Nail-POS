// provisioning-metrics.service.ts — honest, in-process observability for agent provisioning. Mirrors
// VoiceGatewayMetricsService: single-instance, since-process-start counters that reset on restart (the snapshot says
// so). Low-cardinality — no tenant labels — so it's safe to expose to Super Admin. Complements the fleet view (which
// is a point-in-time DB snapshot of failed jobs) with success/failure RATES over the process lifetime, broken down by
// error code. Success rate is null until there's a denominator (no fabricated 100%).
import { Injectable } from '@nestjs/common';

export interface ProvisioningMetricsSnapshot {
  since: string;
  attempts: number;
  succeeded: number;
  failed: number;
  successRatePct: number | null;   // succeeded / (succeeded + failed); null until settled attempts exist
  byErrorCode: Record<string, number>;
}

@Injectable()
export class ProvisioningMetricsService {
  private readonly since = new Date().toISOString();
  private attempts = 0;
  private succeeded = 0;
  private failed = 0;
  private readonly codes = new Map<string, number>();

  attempt() { this.attempts += 1; }
  success() { this.succeeded += 1; }
  failure(errorCode: string) {
    this.failed += 1;
    const code = errorCode || 'UNKNOWN';
    this.codes.set(code, (this.codes.get(code) ?? 0) + 1);
  }

  snapshot(): ProvisioningMetricsSnapshot {
    const settled = this.succeeded + this.failed;
    const byErrorCode: Record<string, number> = {};
    for (const [k, v] of this.codes) byErrorCode[k] = v;
    return {
      since: this.since,
      attempts: this.attempts,
      succeeded: this.succeeded,
      failed: this.failed,
      successRatePct: settled > 0 ? Math.round((this.succeeded / settled) * 100) : null,
      byErrorCode,
    };
  }
}
