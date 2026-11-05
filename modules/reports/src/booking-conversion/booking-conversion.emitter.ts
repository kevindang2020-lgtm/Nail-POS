// booking-conversion.emitter.ts — a NEUTRAL, low-level writer for the shared booking-conversion funnel
// (ai_booking_conversion_events). It depends only on DATABASE, so any channel module (ai-center Copilot, and later
// voice-booking, customer, etc.) can emit into the cross-channel analytics WITHOUT importing ai-booking — which avoids
// the circular dependency (ai-booking already imports ai-center). Append-only; best-effort; never throws into a channel.
// This is the single low-level INSERT site; ai-booking's own AiBookingConversionService remains for its controllers and
// writes the same table with the same shape.
import { Injectable, Inject, Module } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

export interface BookingConversionEvent {
  tenantId: string; branchId?: string | null; source: string; stage: string;
  outcome?: 'succeeded' | 'failed' | 'abandoned' | null; failureReason?: string | null;
  appointmentId?: string | null; actorUserId?: string | null; correlationId?: string | null; latencyMs?: number | null;
}

@Injectable()
export class BookingConversionEmitter {
  constructor(@Inject(DATABASE) private readonly db: AppDatabase | null) {}

  async emit(e: BookingConversionEvent): Promise<void> {
    if (!this.db || !e?.tenantId || !e?.source || !e?.stage) return;
    await sql`
      INSERT INTO ai_booking_conversion_events (tenant_id, branch_id, source, stage, outcome, failure_reason, appointment_id, actor_user_id, correlation_id, latency_ms)
      VALUES (${e.tenantId}, ${e.branchId ?? null}, ${e.source}, ${e.stage}, ${e.outcome ?? null}, ${e.failureReason ?? null}, ${e.appointmentId ?? null}, ${e.actorUserId ?? null}, ${e.correlationId ?? null}, ${e.latencyMs ?? null})
    `.execute(this.db as any).catch(() => undefined);
  }
}

@Module({ providers: [BookingConversionEmitter], exports: [BookingConversionEmitter] })
export class BookingConversionModule {}
