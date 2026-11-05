// call-intelligence.service.ts — records provider call events (idempotently) and serves today's summary. The production
// producer is the signature-verified telephony webhook calling record(); the tenant-guarded controller also exposes it
// for authorized manual/test ingest. Scope comes from the caller; the repo enforces tenant/branch.
import type { CallIntelRepo, CallIntelScope } from './call-intelligence.repository';
import type { CallEventInput, CallIntelSummary } from './call-intelligence.dto';

export class CallIntelligenceService {
  constructor(private readonly repo: CallIntelRepo) {}
  record(tenantId: string, branchId: string | null, e: Omit<CallEventInput, 'tenantId'>) {
    if (!e.providerCallId) throw Object.assign(new Error('provider_call_id_required'), { status: 400 });
    return this.repo.record({ ...e, tenantId, branchId: e.branchId ?? branchId });
  }
  summary(scope: CallIntelScope): Promise<CallIntelSummary> { return this.repo.summary(scope); }
  recent(scope: CallIntelScope, limit = 50) { return this.repo.listRecent(scope, limit); }
}
