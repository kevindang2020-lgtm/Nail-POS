// voice-call-outcome.kysely.repository.ts — production persistence over the 299 migration. Upsert is idempotent on
// (tenant_id, provider_call_id) so a retried outcome POST updates rather than duplicates.
import { sql, type Kysely } from 'kysely';
import type { CallOutcomeRepo, CallOutcomeRecord } from './voice-call-outcome.service';
import type { NormalizedCallOutcome } from './voice-call-outcome-core';
import type { VoiceContext } from './voice-booking.service';

const ms = (v: any): number => (v == null ? Date.now() : new Date(v).getTime());

function toRecord(r: any): CallOutcomeRecord {
  return {
    id: r.id, tenantId: r.tenant_id, branchId: r.branch_id, provider: r.provider, providerCallId: r.provider_call_id,
    promptVersion: r.prompt_version ?? null, startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
    endedAt: r.ended_at ? new Date(r.ended_at).toISOString() : null, durationSeconds: r.duration_seconds ?? null,
    language: r.language ?? null, intents: r.intents ?? [], toolCalls: r.tool_calls ?? [],
    bookingOutcome: r.booking_outcome ?? null, handoffOutcome: r.handoff_outcome ?? null, sentiment: r.sentiment ?? null,
    errorCategory: r.error_category ?? null, interruptionCount: r.interruption_count ?? 0,
    repeatedQuestionCount: r.repeated_question_count ?? 0, abandoned: r.abandoned ?? false,
    followUpRequired: r.follow_up_required ?? false, summary: r.summary ?? null, createdMs: ms(r.created_at),
  };
}

export class KyselyCallOutcomeRepo implements CallOutcomeRepo {
  constructor(private readonly db: Kysely<any>) {}

  async upsert(ctx: VoiceContext, provider: string, o: NormalizedCallOutcome): Promise<CallOutcomeRecord> {
    const r = (await sql`
      INSERT INTO voice_call_outcomes (tenant_id, branch_id, provider, provider_call_id, prompt_version, started_at, ended_at,
        duration_seconds, language, intents, tool_calls, booking_outcome, handoff_outcome, sentiment, error_category,
        interruption_count, repeated_question_count, abandoned, follow_up_required, summary)
      VALUES (${ctx.tenantId}, ${ctx.branchId}, ${provider}, ${o.providerCallId}, ${o.promptVersion},
        ${o.startedAt}, ${o.endedAt}, ${o.durationSeconds}, ${o.language},
        ${JSON.stringify(o.intents)}::jsonb, ${JSON.stringify(o.toolCalls)}::jsonb, ${o.bookingOutcome}, ${o.handoffOutcome},
        ${o.sentiment}, ${o.errorCategory}, ${o.interruptionCount}, ${o.repeatedQuestionCount}, ${o.abandoned},
        ${o.followUpRequired}, ${o.summary})
      ON CONFLICT (tenant_id, provider_call_id) DO UPDATE SET
        branch_id = EXCLUDED.branch_id, provider = EXCLUDED.provider, prompt_version = EXCLUDED.prompt_version,
        started_at = EXCLUDED.started_at, ended_at = EXCLUDED.ended_at, duration_seconds = EXCLUDED.duration_seconds,
        language = EXCLUDED.language, intents = EXCLUDED.intents, tool_calls = EXCLUDED.tool_calls,
        booking_outcome = EXCLUDED.booking_outcome, handoff_outcome = EXCLUDED.handoff_outcome, sentiment = EXCLUDED.sentiment,
        error_category = EXCLUDED.error_category, interruption_count = EXCLUDED.interruption_count,
        repeated_question_count = EXCLUDED.repeated_question_count, abandoned = EXCLUDED.abandoned,
        follow_up_required = EXCLUDED.follow_up_required, summary = EXCLUDED.summary, updated_at = now()
      RETURNING *`.execute(this.db)).rows[0];
    return toRecord(r);
  }

  async get(tenantId: string, providerCallId: string): Promise<CallOutcomeRecord | null> {
    const r = (await sql`SELECT * FROM voice_call_outcomes WHERE tenant_id = ${tenantId} AND provider_call_id = ${providerCallId} LIMIT 1`.execute(this.db)).rows[0];
    return r ? toRecord(r) : null;
  }

  async list(tenantId: string, opts: { branchId?: string; limit?: number } = {}): Promise<CallOutcomeRecord[]> {
    const limit = Math.min(opts.limit ?? 50, 200);
    const rows = opts.branchId
      ? (await sql`SELECT * FROM voice_call_outcomes WHERE tenant_id = ${tenantId} AND branch_id = ${opts.branchId} ORDER BY started_at DESC NULLS LAST LIMIT ${limit}`.execute(this.db)).rows
      : (await sql`SELECT * FROM voice_call_outcomes WHERE tenant_id = ${tenantId} ORDER BY started_at DESC NULLS LAST LIMIT ${limit}`.execute(this.db)).rows;
    return rows.map(toRecord);
  }
}
