// Repository for campaign compliance flags + limits. In-memory impl is stateful so flag/pause/resolve and limits are
// exercised without a database.

import type { LimitsInput } from './campaign-compliance-core';

export interface FlagRow {
  id: string; subjectType: string; subjectId: string; subjectName: string | null; tenantId: string | null;
  flagType: string; severity: string; status: string; actionTaken: string | null; detail: string | null; reason: string | null;
  createdAt: string; resolvedAt: string | null;
}
export interface LimitsRow {
  id: string; maxSendsPerDay: number | null; maxCampaignsPerDay: number | null; quietHoursStart: number | null;
  quietHoursEnd: number | null; minHoursBetween: number | null; createdAt: string;
}

export interface ComplianceRepo {
  /** tenantId is REQUIRED — this reads tenant-owned rows. */
  listFlags(scope: { tenantId: string; status?: string; cap?: number }): Promise<FlagRow[]>;
  raiseFlag(input: { subjectType: string; subjectId: string; subjectName?: string | null; tenantId?: string | null; flagType: string; severity?: string; detail?: string | null; raisedByUserId?: string | null }): Promise<FlagRow>;
  resolveFlag(id: string, tenantId: string, status: 'cleared' | 'actioned', extra?: { actionTaken?: string; reason?: string; resolvedByUserId?: string | null }): Promise<FlagRow | null>;
  getActiveLimits(): Promise<LimitsRow | null>;
  /** Enforcement read: THROWS on error instead of returning null (null would mean 'no limits'). */
  getActiveLimitsStrict(): Promise<LimitsRow | null>;
  setLimits(input: LimitsInput & { updatedByUserId?: string | null }): Promise<LimitsRow>;
}

let FSEQ = 1, LSEQ = 1;

export class InMemoryComplianceRepo implements ComplianceRepo {
  private flags: FlagRow[] = [];
  private limits: LimitsRow | null = null;

  async listFlags(scope: { tenantId: string; status?: string; cap?: number }) {
    // Mirrors the real repo: no tenant → nothing. A fake that ignores scoping would let a leaky test pass.
    if (!scope.tenantId) return [];
    const mine = this.flags.filter((f) => String(f.tenantId ?? '') === String(scope.tenantId));
    let r = [...mine].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    if (scope.status) r = r.filter((f) => f.status === scope.status);
    return r.slice(0, scope.cap ?? 200);
  }
  async raiseFlag(input: { subjectType: string; subjectId: string; subjectName?: string | null; tenantId?: string | null; flagType: string; severity?: string; detail?: string | null; raisedByUserId?: string | null }): Promise<FlagRow> {
    const row: FlagRow = {
      id: `CFLAG-${String(FSEQ++).padStart(4, '0')}`, subjectType: input.subjectType, subjectId: input.subjectId,
      subjectName: input.subjectName ?? null, tenantId: input.tenantId ?? null, flagType: input.flagType,
      severity: input.severity || 'medium', status: 'open', actionTaken: null, detail: input.detail ?? null, reason: null,
      createdAt: new Date().toISOString(), resolvedAt: null,
    };
    this.flags.push(row);
    return row;
  }
  async resolveFlag(id: string, tenantId: string, status: 'cleared' | 'actioned', extra?: { actionTaken?: string; reason?: string }): Promise<FlagRow | null> {
    // ENFORCE the tenant, exactly as the real repo does. A fake that accepted `tenantId` and ignored it would let a
    // cross-tenant write pass every test — which is how a leak survives a green suite.
    const row = this.flags.find((f) => f.id === id && String(f.tenantId ?? '') === String(tenantId));
    if (!row) return null;
    row.status = status; row.actionTaken = extra?.actionTaken ?? row.actionTaken; row.reason = extra?.reason ?? row.reason; row.resolvedAt = new Date().toISOString();
    return row;
  }
  async getActiveLimits(): Promise<LimitsRow | null> { return this.limits; }
  async getActiveLimitsStrict(): Promise<LimitsRow | null> { return this.limits; }
  async setLimits(input: LimitsInput & { updatedByUserId?: string | null }): Promise<LimitsRow> {
    this.limits = {
      id: `CLIM-${String(LSEQ++).padStart(4, '0')}`, maxSendsPerDay: input.maxSendsPerDay ?? null, maxCampaignsPerDay: input.maxCampaignsPerDay ?? null,
      quietHoursStart: input.quietHoursStart ?? null, quietHoursEnd: input.quietHoursEnd ?? null, minHoursBetween: input.minHoursBetween ?? null,
      createdAt: new Date().toISOString(),
    };
    return this.limits;
  }
}
