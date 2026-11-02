// Campaign compliance service. Summarizes open flags into the reference alert categories, raises/resolves flags,
// records a pause action (never silent deletion), and manages platform campaign limits.

import { summarizeAlerts, canPause, validateLimits, type LimitsInput } from './campaign-compliance-core';
import type { ComplianceRepo, FlagRow, LimitsRow } from './campaign-compliance.repository';

export class CampaignComplianceService {
  constructor(private readonly repo: ComplianceRepo) {}

  // tenantId comes from the VERIFIED session (req.ctx), never the client. Without it these read tenant-owned rows.
  listFlags(tenantId: string, scope: { status?: string } = {}) { return this.repo.listFlags({ ...scope, tenantId }); }

  async alertsSummary(tenantId: string) {
    const flags = await this.repo.listFlags({ tenantId, cap: 500 });
    return { available: true, ...summarizeAlerts(flags) };
  }

  raiseFlag(input: { subjectType: string; subjectId: string; subjectName?: string | null; tenantId?: string | null; flagType: string; severity?: string; detail?: string | null; raisedByUserId?: string | null }):
    Promise<{ ok: boolean; errors?: string[]; flag?: FlagRow }> {
    if (!input.subjectId || !input.flagType) return Promise.resolve({ ok: false, errors: ['Subject and flag type are required.'] });
    return this.repo.raiseFlag(input).then((flag) => ({ ok: true, flag }));
  }

  async pause(input: { subjectType: 'tenant_campaign' | 'platform_announcement'; subjectId: string; subjectName?: string | null; tenantId?: string | null; currentStatus: string; reason: string; actorUserId?: string | null }):
    Promise<{ ok: boolean; errors?: string[]; flag?: FlagRow }> {
    if (!input.reason || !input.reason.trim()) return { ok: false, errors: ['A reason is required to pause a campaign.'] };
    if (!canPause(input.currentStatus)) return { ok: false, errors: [`A ${input.currentStatus} campaign cannot be paused.`] };
    // Record the pause as an actioned compliance flag (auditable, reversible outcome — no deletion).
    const raised = await this.repo.raiseFlag({ subjectType: input.subjectType, subjectId: input.subjectId, subjectName: input.subjectName, tenantId: input.tenantId, flagType: 'abusive', severity: 'high', detail: 'Paused by Super Admin', raisedByUserId: input.actorUserId });
    // Resolve the flag we just raised, IN THE TENANT it was raised for — not whatever tenant happens to be active.
    const flag = await this.repo.resolveFlag(raised.id, String(input.tenantId ?? ''), 'actioned', { actionTaken: 'paused', reason: input.reason.trim(), resolvedByUserId: input.actorUserId ?? null });
    return { ok: true, flag: flag ?? raised };
  }

  async resolveFlag(id: string, tenantId: string, status: 'cleared' | 'actioned', reason?: string): Promise<{ ok: boolean; errors?: string[]; flag?: FlagRow }> {
    const flag = await this.repo.resolveFlag(id, tenantId, status, { reason });
    return flag ? { ok: true, flag } : { ok: false, errors: ['Flag not found.'] };
  }

  getLimits(): Promise<LimitsRow | null> { return this.repo.getActiveLimits(); }
  /** For the send path: propagates a read error so the caller can refuse to start, rather than seeing 'no limits'. */
  getLimitsStrict(): Promise<LimitsRow | null> { return this.repo.getActiveLimitsStrict(); }
  async setLimits(input: LimitsInput & { updatedByUserId?: string | null }): Promise<{ ok: boolean; errors?: string[]; limits?: LimitsRow }> {
    const { errors } = validateLimits(input);
    if (errors.length) return { ok: false, errors };
    const limits = await this.repo.setLimits(input);
    return { ok: true, limits };
  }
}
