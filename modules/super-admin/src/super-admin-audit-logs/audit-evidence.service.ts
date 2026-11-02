// audit-evidence.service.ts — Export Audit Evidence + Chain of Custody. Builds a redacted, scoped CSV from the same
// real audit-trail aggregate (so it reconciles with the dashboard), computes a SHA-256 checksum + integrity manifest,
// records the packet metadata, and appends a 'generated' custody entry. Downloads/accesses/verifications each append
// to the APPEND-ONLY chain of custody. Secrets are never exported (toCsv is injection-guarded; values are redacted).
import { createHash } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { toCsv } from '@aipowersalon/reports';
import { parseScope, type OverviewScope } from '@aipowersalon/database';
import { redactText, buildManifest, beforeAfter } from './audit-logs-core';
import { AuditEvidenceRepository, type EvidencePackRow } from './audit-evidence.kysely.repository';
import { AuditLogsRepository } from './audit-logs.kysely.repository';

export interface AdminCtx { userId?: string; email?: string; ip?: string }
const shape = (r: EvidencePackRow) => ({ id: r.id, packRef: r.pack_ref, requestedBy: r.requested_by, scope: r.scope, format: r.format, eventCount: r.event_count, checksum: r.checksum, manifest: r.manifest, redactionApplied: r.redaction_applied, status: r.status, createdAt: r.created_at, expiresAt: r.expires_at });
const validUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export class AuditEvidenceService {
  constructor(private readonly repo: AuditEvidenceRepository, private readonly auditRepo: AuditLogsRepository) {}

  async list() { return { packs: (await this.repo.list()).map(shape) }; }
  async get(id: string) {
    const pack = await this.repo.get(id);
    if (!pack) throw new NotFoundException('evidence pack not found');
    await this.repo.appendCustody(id, 'accessed', 'super_admin', 'viewed pack detail');
    return { pack: shape(pack), custody: (await this.repo.custody(id)).map((c) => ({ entryType: c.entry_type, actor: c.actor, purpose: c.purpose, at: c.created_at })) };
  }

  /** Build the redacted CSV + checksum for a scope, bounded to asOf. Deterministic: same inputs → same bytes. */
  private async buildCsv(scope: OverviewScope, asOf: string): Promise<{ content: string; checksum: string; eventCount: number }> {
    const trail = await this.auditRepo.trailForExport(scope, asOf);
    const headers = ['Date & Time', 'User', 'Role', 'Tenant', 'Action', 'Previous Value', 'New Value', 'IP', 'Device', 'Reason', 'Result'];
    const rows = trail.map((t) => { const ba = beforeAfter(t.metadata); return [t.occurred_at, t.actor_name || 'system', t.actor_role || '—', t.tenant_name || '—', t.action || '—', redactText(ba.previous ?? '—'), redactText(ba.next ?? '—'), t.ip || '—', t.device || '—', redactText(t.summary || '—'), t.status || '—']; });
    const content = toCsv(headers, rows);
    const checksum = createHash('sha256').update(content, 'utf8').digest('hex');
    return { content, checksum, eventCount: rows.length };
  }

  async exportEvidence(ctx: AdminCtx, q: any) {
    const scope: OverviewScope = parseScope(q?.tenantId);
    const asOf = new Date().toISOString();
    const { content, checksum, eventCount } = await this.buildCsv(scope, asOf);
    const packRef = `EP-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const manifest = buildManifest({ packRef, format: 'csv', eventCount, checksum, generatedAt: asOf, redactionApplied: true });
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    const pack = await this.repo.insert({ packRef, requestedBy: ctx.email ?? 'super_admin', requestedById: ctx.userId && validUuid(ctx.userId) ? ctx.userId : null, scope: { tenantId: scope.tenantId ?? null, asOf }, format: 'csv', eventCount, checksum, manifest, redactionApplied: true, expiresAt });
    await this.repo.appendCustody(pack.id, 'generated', ctx.email ?? 'super_admin', 'evidence export generated');
    await this.repo.writeAudit(scope.tenantId ?? null, ctx, 'evidence_exported', `Evidence pack ${packRef} generated (${eventCount} events)`, { packRef, eventCount, checksum });
    const filename = `audit-evidence-${packRef}-${asOf.slice(0, 10)}.csv`;
    return { ok: true, pack: shape(pack), filename, mimeType: 'text/csv', content, checksum, manifest };
  }

  async recordDownload(ctx: AdminCtx, id: string) {
    const pack = await this.repo.get(id);
    if (!pack) throw new NotFoundException('evidence pack not found');
    await this.repo.appendCustody(id, 'downloaded', ctx.email ?? 'super_admin', 'evidence downloaded');
    return { ok: true };
  }

  /** Re-derive the CSV for the pack's stored scope + asOf and compare checksums — integrity verification. */
  async verify(ctx: AdminCtx, id: string) {
    const pack = await this.repo.get(id);
    if (!pack) throw new NotFoundException('evidence pack not found');
    const scope: OverviewScope = parseScope(pack.scope?.tenantId ?? undefined);
    const { checksum } = await this.buildCsv(scope, pack.scope?.asOf ?? pack.created_at);
    const verified = checksum === pack.checksum;
    await this.repo.appendCustody(id, verified ? 'verified' : 'verification_failed', ctx.email ?? 'super_admin', verified ? 'integrity verified' : 'integrity MISMATCH');
    if (!verified) await this.repo.writeAudit(pack.scope?.tenantId ?? null, ctx, 'evidence_integrity_failed', `Evidence pack ${pack.pack_ref} failed integrity verification`, { packRef: pack.pack_ref, expected: pack.checksum, actual: checksum });
    return { ok: true, verified, expected: pack.checksum, actual: checksum };
  }
}
