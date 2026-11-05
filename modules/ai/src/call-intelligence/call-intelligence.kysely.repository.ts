// call-intelligence.kysely.repository.ts — Postgres CallIntelRepo. Idempotent insert via ON CONFLICT (tenant_id,
// provider_call_id). Summary is computed from today's rows with the same shape as the in-memory repo. Tenant/branch
// scoped from the session, never the client.
import { sql, type Kysely } from 'kysely';
import { branchTimeZone, type DB } from '@aipowersalon/database';
import { canMoveToSql } from '@aipowersalon/database';
import { CALL_INTELLIGENCE_EVENT } from '../ai-lifecycles';
import { dayStartMs } from '@aipowersalon/date-time';
import type { CallIntelRepo, CallIntelScope } from './call-intelligence.repository';
import { summarize, type CallEventInput, type CallEventRow, type CallIntelSummary } from './call-intelligence.dto';

export class KyselyCallIntelRepo implements CallIntelRepo {
  constructor(private readonly db: Kysely<DB>) {}
  /** The clock (tests set it). */
  now: () => number = Date.now;

  async record(e: CallEventInput): Promise<{ id: string; deduped: boolean }> {
    const r: any = await sql`
      insert into call_intelligence_events
        (tenant_id, branch_id, provider_call_id, customer_id, caller_phone, direction, status, ai_handled, intent,
         duration_seconds, outcome, recovered_appointment_id, started_at)
      values (${e.tenantId}, ${e.branchId ?? null}, ${e.providerCallId}, ${e.customerId ?? null}, ${e.callerPhone ?? null},
         ${e.direction ?? 'inbound'}, ${e.status}, ${e.aiHandled ?? false}, ${e.intent ?? null}, ${e.durationSeconds ?? 0},
         ${e.outcome ?? 'no_action'}, ${e.recoveredAppointmentId ?? null}, ${e.startedAt ?? new Date().toISOString()})
      on conflict (tenant_id, provider_call_id) do update set
         status = excluded.status, ai_handled = excluded.ai_handled, intent = excluded.intent,
         duration_seconds = excluded.duration_seconds, outcome = excluded.outcome,
         recovered_appointment_id = excluded.recovered_appointment_id, updated_at = now()
      where ${canMoveToSql(CALL_INTELLIGENCE_EVENT, e.status, 'call_intelligence_events')}
      returning id, (xmax <> 0) as deduped
    `.execute(this.db as any);
    const row = r.rows?.[0];
    return { id: row?.id, deduped: !!row?.deduped };
  }

  async summary(scope: CallIntelScope): Promise<CallIntelSummary> {
    // today = since the BRANCH's midnight (Oct 6 2026 — was the UTC date, so from 8 pm in New York the summary was empty)
    const tz = await branchTimeZone(this.db, scope.tenantId, scope.branchId ?? null), at = new Date(this.now());
    const since = new Date(dayStartMs(tz, at));
    let q = this.db.selectFrom('call_intelligence_events')
      .where('tenant_id', '=', scope.tenantId)
      .where('started_at', '>=', since as any);
    if (scope.branchId) q = q.where((eb: any) => eb.or([eb('branch_id', '=', scope.branchId), eb('branch_id', 'is', null)]));
    const rows: any[] = await q.selectAll().execute().catch(() => []);
    const mapped: CallEventRow[] = rows.map((x) => ({
      id: x.id, tenantId: x.tenant_id, branchId: x.branch_id, providerCallId: x.provider_call_id, customerId: x.customer_id,
      callerPhone: x.caller_phone, direction: x.direction, status: x.status, aiHandled: x.ai_handled, intent: x.intent,
      durationSeconds: Number(x.duration_seconds ?? 0), outcome: x.outcome, recoveredAppointmentId: x.recovered_appointment_id,
      startedAt: typeof x.started_at === 'string' ? x.started_at : new Date(x.started_at).toISOString(),
    }));
    return summarize(mapped, at, tz);
  }

  async listRecent(scope: CallIntelScope, limit: number): Promise<CallEventRow[]> {
    let q = this.db.selectFrom('call_intelligence_events').where('tenant_id', '=', scope.tenantId);
    if (scope.branchId) q = q.where((eb: any) => eb.or([eb('branch_id', '=', scope.branchId), eb('branch_id', 'is', null)]));
    const rows: any[] = await q.selectAll().orderBy('started_at', 'desc').limit(Math.max(1, Math.min(200, limit))).execute().catch(() => []);
    return rows.map((x) => ({
      id: x.id, tenantId: x.tenant_id, branchId: x.branch_id, providerCallId: x.provider_call_id, customerId: x.customer_id,
      callerPhone: x.caller_phone, direction: x.direction, status: x.status, aiHandled: x.ai_handled, intent: x.intent,
      durationSeconds: Number(x.duration_seconds ?? 0), outcome: x.outcome, recoveredAppointmentId: x.recovered_appointment_id,
      startedAt: typeof x.started_at === 'string' ? x.started_at : new Date(x.started_at).toISOString(),
    }));
  }
}
