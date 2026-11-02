// call-intelligence.service.ts — records provider call events (idempotently) and serves today's summary. The production
// producer is the signature-verified telephony webhook calling record(); the tenant-guarded controller also exposes it
// for authorized manual/test ingest. Scope comes from the caller; the repo enforces tenant/branch.
import { HttpException } from '@nestjs/common';
import type { CallIntelRepo, CallIntelScope } from './call-intelligence.repository';
import type { CallEventInput, CallIntelSummary } from './call-intelligence.dto';

/** The table's CHECK vocabularies (migration 149) — checked here so a bad value is a 400, never a database error. */
const STATUSES = ['missed', 'answered_ai', 'answered_human', 'voicemail'];
const DIRECTIONS = ['inbound', 'outbound'];
const OUTCOMES = ['booked', 'recovered', 'transferred', 'message', 'no_action'];
const invalid = (field: string, message: string) => new HttpException({ code: 'VALIDATION_FAILED', message, details: { field } }, 400);

export class CallIntelligenceService {
  constructor(private readonly repo: CallIntelRepo) {}
  async record(tenantId: string, branchId: string | null, e: Omit<CallEventInput, 'tenantId'>) {
    // §163 run 3 (Oct 27 2026): an Error carrying `status` was answered 500, and an unknown status / outcome reached the
    // state machine's SQL — every field is checked against its vocabulary first
    if (!e.providerCallId) throw invalid('providerCallId', 'providerCallId is required.');
    if (!STATUSES.includes(e.status as string)) throw invalid('status', `status must be one of ${STATUSES.join(', ')}.`);
    if (e.direction != null && !DIRECTIONS.includes(e.direction as string)) throw invalid('direction', `direction must be one of ${DIRECTIONS.join(', ')}.`);
    if (e.outcome != null && !OUTCOMES.includes(e.outcome as string)) throw invalid('outcome', `outcome must be one of ${OUTCOMES.join(', ')}.`);
    if (e.durationSeconds != null && !(Number.isInteger(e.durationSeconds) && e.durationSeconds >= 0 && e.durationSeconds <= 86_400)) throw invalid('durationSeconds', 'durationSeconds must be a whole number of seconds (0–86400).');
    if (e.startedAt != null && !(typeof e.startedAt === 'string' && /^\d{4}-\d{2}-\d{2}([T ][0-9:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(e.startedAt) && !Number.isNaN(Date.parse(e.startedAt)))) throw invalid('startedAt', 'startedAt must be a date-time.');
    try {
      return await this.repo.record({ ...e, tenantId, branchId: e.branchId ?? branchId });
    } catch (err: any) {
      if (err?.code === '23503') throw invalid('recoveredAppointmentId', 'The linked appointment does not exist.');   // foreign key
      throw err;
    }
  }
  summary(scope: CallIntelScope): Promise<CallIntelSummary> { return this.repo.summary(scope); }
  recent(scope: CallIntelScope, limit = 50) { return this.repo.listRecent(scope, limit); }
}
