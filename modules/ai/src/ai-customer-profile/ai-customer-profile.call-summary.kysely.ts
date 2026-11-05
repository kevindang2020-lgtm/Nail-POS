// ai-customer-profile.call-summary.kysely.ts — reads a customer's VERIFIED call events from the existing
// call_intelligence_events table (§24). This is a read-model over an existing table, not a second call system: it
// only SELECTs, is tenant + customer scoped, filters to matched customer_id (never unverified caller-ID as history),
// and never touches transcripts/recordings (there are none in this table).
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { AiCustomerProfileContext } from './ai-customer-profile.dto';
import type { CallSummaryPort } from './ai-customer-profile.service';
import type { CallRow } from './ai-customer-profile-core';

export class KyselyCallSummary implements CallSummaryPort {
  constructor(private readonly db: Kysely<DB>) {}

  async customerCalls(ctx: AiCustomerProfileContext, customerId: string, limit: number): Promise<CallRow[]> {
    const rows = await this.db.selectFrom('call_intelligence_events')
      .select(['started_at', 'direction', 'ai_handled', 'intent', 'outcome', 'duration_seconds', 'recovered_appointment_id'])
      .where('tenant_id', '=', ctx.tenantId)                 // tenant-scoped
      .where('customer_id', '=', customerId)                 // verified match only
      .orderBy('started_at', 'desc')
      .limit(Math.min(50, Math.max(1, limit)))
      .execute().catch(() => [] as any[]);
    return (rows as any[]).map(r => ({
      startedAt: r.started_at ? new Date(r.started_at).toISOString() : '',
      direction: String(r.direction ?? 'inbound'),
      aiHandled: !!r.ai_handled,
      intent: r.intent ?? null,
      outcome: r.outcome ?? null,
      durationSeconds: r.duration_seconds == null ? undefined : Number(r.duration_seconds),
      recoveredAppointmentId: r.recovered_appointment_id ?? null,
    }));
  }
}
