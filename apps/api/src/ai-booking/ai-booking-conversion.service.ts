// ai-booking-conversion.service.ts — records the ai_booking funnel and reads it back tenant-scoped. Append-only; no
// conversational content. Every write and read is tenant-filtered; a null DB is a safe no-op (dev/offline).
import { Injectable, Inject } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import type { AiBookingContext } from './ai-booking-context';
import { computeConversionMetrics } from './ai-booking-metrics-core';

export type FunnelStage =
  | 'BOOKING_INTENT_DETECTED' | 'AVAILABILITY_SEARCHED' | 'OPTIONS_PRESENTED' | 'OPTION_SELECTED'
  | 'CUSTOMER_VERIFIED' | 'CONFIRMATION_REQUESTED' | 'BOOKING_ATTEMPTED' | 'BOOKING_SUCCEEDED'
  | 'BOOKING_FAILED' | 'HUMAN_HANDOFF' | 'ABANDONED'
  | 'RESCHEDULE_INTENT' | 'RESCHEDULE_ATTEMPTED' | 'RESCHEDULE_SUCCEEDED' | 'RESCHEDULE_FAILED'
  | 'CANCEL_INTENT' | 'CANCEL_SUCCEEDED' | 'CANCEL_FAILED';

export interface ConversionInput { stage: FunnelStage; outcome?: 'succeeded' | 'failed' | 'abandoned' | null; failureReason?: string | null; appointmentId?: string | null; latencyMs?: number | null }

@Injectable()
export class AiBookingConversionService {
  constructor(@Inject(DATABASE) private readonly db: AppDatabase | null) {}

  /** Record one funnel event. Tenant/branch/source/actor/correlation come from the TRUSTED context, never the caller. */
  async record(ctx: AiBookingContext, e: ConversionInput): Promise<void> {
    if (!this.db) return;
    await sql`
      INSERT INTO ai_booking_conversion_events (tenant_id, branch_id, source, stage, outcome, failure_reason, appointment_id, actor_user_id, correlation_id, latency_ms, campaign_id)
      VALUES (${ctx.tenantId}, ${ctx.branchId}, ${ctx.source}, ${e.stage}, ${e.outcome ?? null}, ${e.failureReason ?? null}, ${e.appointmentId ?? null}, ${ctx.userId}, ${ctx.correlationId}, ${e.latencyMs ?? null}, ${(ctx as any).campaignId ?? null})
    `.execute(this.db as any).catch(() => undefined);
  }

  /** Tenant-scoped funnel rollup by source + stage, bounded to a date window. */
  async summary(ctx: { tenantId: string }, opts: { sinceDays?: number } = {}): Promise<{ source: string; stage: string; count: number }[]> {
    if (!this.db) return [];
    const days = Math.min(365, Math.max(1, opts.sinceDays ?? 30));
    const res: any = await sql`
      SELECT source, stage, count(*)::int AS count
      FROM ai_booking_conversion_events
      WHERE tenant_id = ${ctx.tenantId} AND created_at >= now() - (${days} || ' days')::interval
      GROUP BY source, stage ORDER BY source, stage
    `.execute(this.db as any).catch(() => ({ rows: [] }));
    return res.rows ?? [];
  }

  /** Tenant-scoped conversion metrics (§27/§46): per-source + overall rates and a failure-reason breakdown. */
  async metrics(ctx: { tenantId: string }, opts: { sinceDays?: number } = {}): Promise<ReturnType<typeof computeConversionMetrics>> {
    if (!this.db) return computeConversionMetrics([]);
    const days = Math.min(365, Math.max(1, opts.sinceDays ?? 30));
    const res: any = await sql`
      SELECT source, stage, outcome, failure_reason AS "failureReason"
      FROM ai_booking_conversion_events
      WHERE tenant_id = ${ctx.tenantId} AND created_at >= now() - (${days} || ' days')::interval
    `.execute(this.db as any).catch(() => ({ rows: [] }));
    return computeConversionMetrics(res.rows ?? []);
  }
}
