// Data-retention engine — validated (with compliance floors), versioned, audited. previewPurge is a non-destructive dry
// run (count only). Physical purge/anonymize/archive of records is a separate data-plane integration — this engine is the
// authoritative policy + preview + ledger.
import { validateRetentionRule, normalizeDataClass, normalizeAction, computeCutoff, nextRetentionVersion, assemblePurgePreview } from './retention-core';
import type { RetentionRepositoryPort, RetentionActor } from './retention.repository';

export class RetentionError extends Error { constructor(public code: 'invalid' | 'not_found' | 'unsupported', message: string) { super(message); } }

export class RetentionService {
  constructor(private readonly repo: RetentionRepositoryPort) {}

  async get(dataClass: string) {
    const dc = normalizeDataClass(dataClass);
    if (!dc) throw new RetentionError('invalid', `unsupported data class "${dataClass}"`);
    const active = await this.repo.getActive(dc);
    if (!active) return { dataClass: dc, available: false as const, note: 'No active retention rule configured' };
    return { dataClass: dc, available: true as const, version: active.version, retentionDays: active.retentionDays, action: active.action };
  }

  async upsert(dataClass: string, retentionDays: number, action: string, actor: RetentionActor) {
    const dc = normalizeDataClass(dataClass);
    const v = validateRetentionRule({ dataClass: dc, retentionDays, action });
    if (!v.ok) throw new RetentionError('invalid', v.reason);
    const version = nextRetentionVersion(await this.repo.listVersions(dc));
    const row = await this.repo.insertActive(dc, version, retentionDays, normalizeAction(action), actor);
    return { dataClass: dc, version: row.version, retentionDays: row.retentionDays, action: row.action };
  }

  async previewPurge(dataClass: string, actor: RetentionActor) {
    const dc = normalizeDataClass(dataClass);
    const rule = await this.repo.getActive(dc);
    if (!rule) throw new RetentionError('not_found', 'No active retention rule for this data class');
    const cutoff = computeCutoff(Date.now(), rule.retentionDays);
    const { supported, count } = await this.repo.previewCount(dc, cutoff);
    if (!supported) throw new RetentionError('unsupported', `dry-run count is not connected for data class "${dc}" (retention rule is stored; physical purge is a data-plane integration)`);
    const preview = assemblePurgePreview({ dataClass: dc, cutoff, eligibleCount: count, legalHoldExcluded: 0, action: rule.action });
    await this.repo.recordPurgeRun(dc, 'dry_run', cutoff, count, preview.netToProcess, actor);
    return preview;
  }

  async list(limit = 30) { return this.repo.list(limit); }
}
