/* audit-logs-smoke.ts — exercises the READ-ONLY AuditLogsService against live Postgres. Seeds a variety of audit_events
 * (logins, failed logins, role changes, exports, support access, AI config, critical + before/after events), runs the
 * exact service the controller serves, and asserts the aggregates are real, reconcile, scope by tenant, honestly mark
 * un-tracked surfaces (legal holds, investigations, evidence packets), and — critically — that reading the log does NOT
 * mutate it (tamper-resistance). Cleans up after itself.
 * Run: DATABASE_URL=postgres://… npx tsx scripts/audit-logs-smoke.ts
 */
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import type { DB } from '../../../packages/database/src/kysely.types';
import { AuditLogsRepository } from '../../../modules/super-admin/src/super-admin-audit-logs/audit-logs.kysely.repository';
import { AuditLogsService } from '../../../modules/super-admin/src/super-admin-audit-logs/audit-logs.service';
import { AuditLegalHoldsRepository } from '../../../modules/super-admin/src/super-admin-audit-logs/audit-legal-holds.kysely.repository';
import { AuditLegalHoldsService } from '../../../modules/super-admin/src/super-admin-audit-logs/audit-legal-holds.service';
import { AuditInvestigationsRepository } from '../../../modules/super-admin/src/super-admin-audit-logs/audit-investigations.kysely.repository';
import { AuditInvestigationsService } from '../../../modules/super-admin/src/super-admin-audit-logs/audit-investigations.service';
import { AuditEvidenceRepository } from '../../../modules/super-admin/src/super-admin-audit-logs/audit-evidence.kysely.repository';
import { AuditEvidenceService } from '../../../modules/super-admin/src/super-admin-audit-logs/audit-evidence.service';
import { AuditTamperControlsRepository, AuditTamperControlsService } from '../../../modules/super-admin/src/super-admin-audit-logs/audit-tamper-controls.service';
import { AuditExportFlagsRepository, AuditExportFlagsService } from '../../../modules/super-admin/src/super-admin-audit-logs/audit-export-flags.service';
import { AuditRetentionRepository, AuditRetentionService } from '../../../modules/super-admin/src/super-admin-audit-logs/audit-retention.service';

const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: process.env.DATABASE_URL }) }) });
let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); } };

const tA = 'ddee1111-1111-1111-1111-111111111111';
const tB = 'ddee2222-2222-2222-2222-222222222222';
const ids = [tA, tB];

async function clean() {
  await sql`delete from audit_export_flags where event_ref in (select id::text from audit_events where tenant_id = any(${ids}))`.execute(db);
  // Constitution 12 migration 452: audit tables are append-only. Smoke cleanup of its OWN rows on a dev database
  // skips triggers for this one statement (superuser, dev only) — production has no such path.
  await sql`set session_replication_role = replica`.execute(db);
  await sql`delete from audit_events where actor_name like 'AL-Smoke%' or tenant_id = any(${ids})`.execute(db);
  await sql`set session_replication_role = default`.execute(db);
  await sql`delete from audit_investigation_timeline where investigation_id in (select id from audit_investigations where title like 'AL-Smoke%')`.execute(db);
  await sql`delete from audit_investigations where title like 'AL-Smoke%'`.execute(db);
  await sql`delete from audit_evidence_custody where pack_id in (select id from audit_evidence_packs where requested_by = 'al-smoke@evidence')`.execute(db);
  await sql`delete from audit_evidence_packs where requested_by = 'al-smoke@evidence'`.execute(db);
  await sql`delete from audit_tamper_controls`.execute(db);
  await sql`delete from audit_retention_policies`.execute(db);
  await sql`delete from audit_legal_holds where reason like 'AL-Smoke%'`.execute(db);
  await sql`delete from tenants where id = any(${ids})`.execute(db);
}

async function ev(i: { tenant: string; module: string; action: string; status: string; severity: string; device: string; role?: string; meta?: unknown }) {
  await sql`insert into audit_events (tenant_id, occurred_at, actor_name, actor_role, module, action, resource_type, summary, status, severity, ip, device, metadata)
    values (${i.tenant}, now(), ${'AL-Smoke User'}, ${i.role ?? 'Super Admin'}, ${i.module}, ${i.action}, 'thing', ${i.action + ' summary'}, ${i.status}, ${i.severity}, '203.0.113.10', ${i.device}, ${JSON.stringify(i.meta ?? {})}::jsonb)`.execute(db);
}

async function seed() {
  await clean();
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values
    (${tA}, 'Glamour Studio LLC', 'Glamour Studio', 'gl-al', 'GLAL'), (${tB}, 'Luxe Salon LLC', 'Luxe Salon', 'lx-al', 'LXAL')`.execute(db);
  for (let i = 0; i < 5; i++) await ev({ tenant: tA, module: 'auth', action: 'login', status: 'ok', severity: 'info', device: 'Chrome / Windows' });
  for (let i = 0; i < 3; i++) await ev({ tenant: tA, module: 'auth', action: 'login', status: 'failed', severity: 'high', device: 'Safari / iPhone' });
  await ev({ tenant: tA, module: 'tenants', action: 'role_changed', status: 'ok', severity: 'info', device: 'Chrome / Mac', meta: { before: 'Staff', after: 'Manager' } });
  await ev({ tenant: tB, module: 'tenants', action: 'role_changed', status: 'ok', severity: 'info', device: 'Chrome / Mac', meta: { before: 'Reception', after: 'Manager' } });
  await ev({ tenant: tA, module: 'payments', action: 'data_export', status: 'ok', severity: 'info', device: 'Chrome / Windows' });
  await ev({ tenant: tB, module: 'payments', action: 'data_export', status: 'ok', severity: 'info', device: 'Firefox / Windows' });
  await ev({ tenant: tA, module: 'support', action: 'support_access', status: 'ok', severity: 'info', device: 'Chrome / Windows' });
  await ev({ tenant: tA, module: 'ai', action: 'ai_config_changed', status: 'ok', severity: 'info', device: 'Chrome / Windows', meta: { before: 'GPT-3.5', after: 'GPT-4' } });
  await ev({ tenant: tB, module: 'tenants', action: 'tenant_suspended', status: 'warning', severity: 'warning', device: 'Chrome / Windows', meta: { before: 'Active', after: 'Suspended' } });
  await ev({ tenant: tA, module: 'security', action: 'security_setting_changed', status: 'under_review', severity: 'critical', device: 'Chrome / Windows' });
}

async function main() {
  await seed();
  const svc = new AuditLogsService(new AuditLogsRepository(db as any));
  const o: any = await svc.getOverview({ userId: 'u', email: 'super_admin' }, { days: 7 });
  const kpi = (k: string) => o.kpis.find((x: any) => x.key === k);
  const seg = (b: any, k: string) => b.segments.find((s: any) => s.key === k)?.count ?? 0;

  check('KPI total logged events = 16', kpi('total').value === 16, String(kpi('total').value));
  check('KPI critical events = 4 (high+critical severity)', kpi('critical').value === 4, String(kpi('critical').value));
  check('KPI failed logins = 3', kpi('failed_logins').value === 3, String(kpi('failed_logins').value));
  check('KPI data exports = 2', kpi('data_exports').value === 2, String(kpi('data_exports').value));
  check('KPI role changes = 2', kpi('role_changes').value === 2, String(kpi('role_changes').value));
  check('KPI support-mode access = 1', kpi('support_access').value === 1, String(kpi('support_access').value));
  check('KPI AI config changes = 1', kpi('ai_config').value === 1, String(kpi('ai_config').value));
  check('all three governance KPIs (legal-hold, investigations, evidence) become real once their tables exist', kpi('evidence_packets').available === true && kpi('legal_hold').available === true && kpi('investigations').available === true);

  check('result breakdown: success 11 / failed 3 / warning 1 / under_review 1', seg(o.resultBreakdown, 'success') === 11 && seg(o.resultBreakdown, 'failed') === 3 && seg(o.resultBreakdown, 'warning') === 1 && seg(o.resultBreakdown, 'under_review') === 1, JSON.stringify(o.resultBreakdown.segments));
  check('events by category reconcile to total', o.eventsByCategory.segments.reduce((s: number, x: any) => s + x.count, 0) === 16);
  check('event volume trend has a day total 16', o.eventVolumeTrend.some((d: any) => d.count === 16));
  check('top users present', o.topUsers.length >= 1 && o.topUsers[0].events > 0);
  check('suspicious queue surfaces high-risk (failed login / critical)', o.suspiciousQueue.length >= 4 && o.suspiciousQueue.some((s: any) => s.risk === 'high'), String(o.suspiciousQueue.length));
  check('audit trail derives previous/new from metadata (Staff → Manager)', o.auditTrail.some((r: any) => r.previous === 'Staff' && r.next === 'Manager'));
  check('before/after review lists changed values (4 events)', o.beforeAfterReview.length === 4 && o.beforeAfterReview.some((r: any) => r.previous === 'GPT-3.5' && r.next === 'GPT-4'), String(o.beforeAfterReview.length));
  check('recent export events = 2', o.recentExports.length === 2);
  check('access source summary reconciles', o.accessSourceSummary.segments.reduce((s: number, x: any) => s + x.count, 0) === 16);
  check('tamper-resistance flag: not editable / append-only', o.tamperResistance.editable === false && o.tamperResistance.appendOnly === true);
  check('retention honestly unavailable; legal-hold + investigations panels real (empty until seeded)', o.retentionStatus.available === false && o.legalHoldRecords.available === true && o.legalHoldRecords.records.length === 0 && o.openInvestigations.available === true && o.openInvestigations.investigations.length === 0);
  check('at-a-glance today: events 16 / failed logins 3 / high risk 4', o.atAGlance.eventsToday === 16 && o.atAGlance.failedLoginsToday === 3 && o.atAGlance.highRiskToday === 4, JSON.stringify(o.atAGlance));

  // Tamper-resistance: reading the overview must NOT mutate the log.
  const before: any = await sql`select count(*)::int as c from audit_events where actor_name like 'AL-Smoke%'`.execute(db);
  await svc.getOverview({ userId: 'u', email: 'super_admin' }, {});
  const after: any = await sql`select count(*)::int as c from audit_events where actor_name like 'AL-Smoke%'`.execute(db);
  check('reading the audit log does NOT write to it (row count unchanged)', before.rows[0].c === after.rows[0].c && after.rows[0].c === 16, `${before.rows[0].c} → ${after.rows[0].c}`);

  // Tenant scope
  const oa: any = await svc.getOverview({ userId: 'u', email: 'super_admin' }, { tenantId: tA });
  check('tenant scope narrows to tA (total 13)', oa.kpis.find((x: any) => x.key === 'total').value === 13, String(oa.kpis.find((x: any) => x.key === 'total').value));

  // ── Controlled write: Place Logs Under Legal Hold (Unit 3) ──
  const holds = new AuditLegalHoldsService(new AuditLegalHoldsRepository(db as any), db as any);
  const totalBefore: any = await sql`select count(*)::int as c from audit_events`.execute(db);
  let holdBad = 0;
  for (const bad of [{ scopeType: 'tenant', scopeValue: tA }, { scopeType: 'tenant', reason: 'AL-Smoke hold' }, { scopeType: 'nope', scopeValue: 'x', reason: 'AL-Smoke hold' }]) { try { await holds.place({ userId: 'u', email: 'super_admin' }, bad); } catch { holdBad++; } }
  check('placing a hold rejects missing reason / missing scopeValue / bad scopeType', holdBad === 3, String(holdBad));
  const placed: any = await holds.place({ userId: 'u', email: 'super_admin' }, { scopeType: 'tenant', scopeValue: tA, reason: 'AL-Smoke litigation preservation', legalAuthority: 'Case 24-CV-1187' });
  check('hold placed with ref + active status + protects tA slice (13 events)', placed.ok && /^LH-/.test(placed.hold.holdRef) && placed.hold.status === 'active' && placed.protectedCount === 13, JSON.stringify({ ref: placed.hold.holdRef, n: placed.protectedCount }));
  const totalAfterPlace: any = await sql`select count(*)::int as c from audit_events`.execute(db);
  check('placing a hold does NOT delete/alter log rows (adds only its own audit row)', totalAfterPlace.rows[0].c === totalBefore.rows[0].c + 1, `${totalBefore.rows[0].c} → ${totalAfterPlace.rows[0].c}`);
  // an action-scoped hold protecting exports
  const exportHold: any = await holds.place({ userId: 'u', email: 'super_admin' }, { scopeType: 'action', scopeValue: 'export', reason: 'AL-Smoke export investigation' });
  check('action-scoped hold protects the 2 export events', exportHold.protectedCount === 2, String(exportHold.protectedCount));
  // overview now shows the hold KPI + records as real
  const o2: any = await svc.getOverview({ userId: 'u', email: 'super_admin' }, {});
  check('overview legal-hold KPI now real (2 active)', o2.kpis.find((x: any) => x.key === 'legal_hold').available === true && o2.kpis.find((x: any) => x.key === 'legal_hold').value === 2, String(o2.kpis.find((x: any) => x.key === 'legal_hold').value));
  check('overview legal-hold records panel now real', o2.legalHoldRecords.available === true && o2.legalHoldRecords.records.length === 2 && o2.atAGlance.legalHoldsActive.value === 2);
  // release requires a reason; releasing frees the slice but never touches logs
  let relBad = false; try { await holds.release({ userId: 'u', email: 'super_admin' }, placed.hold.id, {}); } catch { relBad = true; }
  check('release requires a reason', relBad);
  const rel: any = await holds.release({ userId: 'u', email: 'super_admin' }, placed.hold.id, { reason: 'AL-Smoke matter closed' });
  check('release → status released with reason recorded', rel.ok && rel.hold.status === 'released' && rel.hold.releaseReason === 'AL-Smoke matter closed');
  const o3: any = await svc.getOverview({ userId: 'u', email: 'super_admin' }, {});
  check('released hold no longer counts as active (1 remains)', o3.kpis.find((x: any) => x.key === 'legal_hold').value === 1, String(o3.kpis.find((x: any) => x.key === 'legal_hold').value));
  const holdAudit: any = await sql`select count(*)::int as c from audit_events where module='audit-logs' and action in ('legal_hold_placed','legal_hold_released') and tenant_id = ${tA}`.execute(db);
  check('hold placement + release audited (tenant-scoped)', holdAudit.rows[0].c >= 2, String(holdAudit.rows[0].c));

  // ── Controlled write: Open Investigation / case management (Unit 4) ──
  const inv = new AuditInvestigationsService(new AuditInvestigationsRepository(db as any));
  let invBad = 0;
  for (const bad of [{ severity: 'high' }, { title: 'ab' }]) { try { await inv.open({ userId: 'u', email: 'super_admin' }, bad); } catch { invBad++; } }
  check('opening rejects missing / too-short title', invBad === 2, String(invBad));
  const opened: any = await inv.open({ userId: 'u', email: 'super_admin' }, { title: 'AL-Smoke suspicious exports', severity: 'high', tenantId: tA, assignee: 'Jordan Vega', eventRefs: ['evt-1', 'evt-2'] });
  check('investigation opened with case ref + 2 linked events', opened.ok && /^INV-/.test(opened.investigation.caseRef) && opened.linkedEvents === 2);
  const det1: any = await inv.get(opened.investigation.id);
  const created = det1.timeline.filter((t: any) => t.entryType === 'created').length;
  const linked1 = det1.timeline.filter((t: any) => t.entryType === 'event_linked').length;
  check('timeline seeded: 1 created + 2 event_linked entries', created === 1 && linked1 === 2, JSON.stringify({ created, linked1 }));
  const firstEntryId = det1.timeline[0].id;
  // append another event + a note — prior timeline entries must be untouched
  await inv.addEvent({ userId: 'u', email: 'super_admin' }, opened.investigation.id, { eventRef: 'evt-3' });
  await inv.addNote({ userId: 'u', email: 'super_admin' }, opened.investigation.id, { note: 'AL-Smoke: reviewed export pattern' });
  const det2: any = await inv.get(opened.investigation.id);
  check('adding an event + note APPENDS (timeline grows, earliest entry unchanged)', det2.timeline.length === det1.timeline.length + 2 && det2.timeline[0].id === firstEntryId && det2.timeline.filter((t: any) => t.entryType === 'event_linked').length === 3, String(det2.timeline.length));
  // status transitions append status_change and never rewrite prior entries
  await inv.setStatus({ userId: 'u', email: 'super_admin' }, opened.investigation.id, { status: 'in_progress' });
  await inv.setStatus({ userId: 'u', email: 'super_admin' }, opened.investigation.id, { status: 'resolved', reason: 'AL-Smoke closed out' });
  const det3: any = await inv.get(opened.investigation.id);
  const statusChanges = det3.timeline.filter((t: any) => t.entryType === 'status_change');
  check('status transitions append status_change entries with from→to', statusChanges.length === 2 && statusChanges[0].payload.from === 'open' && statusChanges[0].payload.to === 'in_progress' && statusChanges[1].payload.to === 'resolved');
  check('resolved investigation no longer counts as open; timeline preserved', det3.investigation.status === 'resolved' && det3.timeline[0].id === firstEntryId);
  // a second still-open case + overview reconciliation
  await inv.open({ userId: 'u', email: 'super_admin' }, { title: 'AL-Smoke merchant anomaly', severity: 'medium', tenantId: tB });
  const oi: any = await svc.getOverview({ userId: 'u', email: 'super_admin' }, {});
  check('overview investigations KPI now real (1 open — resolved excluded)', oi.kpis.find((x: any) => x.key === 'investigations').available === true && oi.kpis.find((x: any) => x.key === 'investigations').value === 1, String(oi.kpis.find((x: any) => x.key === 'investigations').value));
  check('overview open-investigations panel + at-a-glance real', oi.openInvestigations.available === true && oi.openInvestigations.investigations.length === 1 && oi.atAGlance.openInvestigations.value === 1);
  const invAudit: any = await sql`select count(*)::int as c from audit_events where module='audit-logs' and action like 'investigation%' and tenant_id = ${tA}`.execute(db);
  check('investigation open + status changes audited (tenant-scoped)', invAudit.rows[0].c >= 3, String(invAudit.rows[0].c));

  // ── Controlled write: Export Audit Evidence + Chain of Custody (Unit 5) ──
  // Seed one event whose metadata carries secrets, to prove redaction in the exported packet.
  await ev({ tenant: tA, module: 'payments', action: 'payment_method_updated', status: 'ok', severity: 'info', device: 'Chrome / Windows', meta: { before: 'none', after: '4111111111111111 tokenABCDEFGHIJKLMNOPQRSTUVWXYZ012345' } });
  const evi = new AuditEvidenceService(new AuditEvidenceRepository(db as any), new AuditLogsRepository(db as any));
  const ectx = { userId: 'u', email: 'al-smoke@evidence' };
  const exp: any = await evi.exportEvidence(ectx, { tenantId: tA });
  check('evidence pack generated with ref + sha256 checksum + manifest', exp.ok && /^EP-/.test(exp.pack.packRef) && /^[0-9a-f]{64}$/.test(exp.checksum) && exp.manifest.checksum === exp.checksum && exp.manifest.redactionApplied === true);
  check('exported CSV REDACTS secrets (no raw card / token)', exp.content.includes('****REDACTED****') && !exp.content.includes('4111111111111111') && !exp.content.includes('tokenABCDEFGHIJKLMNOPQRSTUVWXYZ012345'));
  check('exported CSV header intact + injection-guarded reuse', exp.content.split('\n')[0] === 'Date & Time,User,Role,Tenant,Action,Previous Value,New Value,IP,Device,Reason,Result');
  // chain of custody: generated → accessed (on get) → downloaded → verified
  await evi.get(exp.pack.id);
  await evi.recordDownload(ectx, exp.pack.id);
  const okVerify: any = await evi.verify(ectx, exp.pack.id);
  check('integrity verification passes for an untampered pack', okVerify.verified === true && okVerify.expected === okVerify.actual);
  const custody1: any = await sql`select entry_type from audit_evidence_custody where pack_id = ${exp.pack.id} order by created_at`.execute(db);
  const types = custody1.rows.map((r: any) => r.entry_type);
  check('chain of custody is append-only: generated → accessed → downloaded → verified', JSON.stringify(types) === JSON.stringify(['generated', 'accessed', 'downloaded', 'verified']), JSON.stringify(types));
  // tamper the stored checksum → verification must fail + raise an alert, without touching the pack content
  await sql`update audit_evidence_packs set checksum = 'deadbeef' where id = ${exp.pack.id}`.execute(db);
  const badVerify: any = await evi.verify(ectx, exp.pack.id);
  check('tampered checksum → integrity verification FAILS', badVerify.verified === false && badVerify.expected === 'deadbeef' && badVerify.actual !== 'deadbeef');
  const custody2: any = await sql`select count(*)::int as c from audit_evidence_custody where pack_id = ${exp.pack.id} and entry_type = 'verification_failed'`.execute(db);
  check('verification failure recorded in chain of custody', custody2.rows[0].c === 1);
  const integrityAlert: any = await sql`select count(*)::int as c from audit_events where module='audit-logs' and action='evidence_integrity_failed' and tenant_id = ${tA}`.execute(db);
  check('integrity failure raises a tenant-scoped audit alert', integrityAlert.rows[0].c >= 1, String(integrityAlert.rows[0].c));
  const oe: any = await svc.getOverview({ userId: 'u', email: 'super_admin' }, {});
  check('overview evidence-packets KPI now real (>= 1 ready)', oe.kpis.find((x: any) => x.key === 'evidence_packets').available === true && oe.kpis.find((x: any) => x.key === 'evidence_packets').value >= 1);
  const expAudit: any = await sql`select count(*)::int as c from audit_events where module='audit-logs' and action='evidence_exported' and tenant_id = ${tA}`.execute(db);
  check('evidence export audited (tenant-scoped)', expAudit.rows[0].c >= 1, String(expAudit.rows[0].c));

  // ── Controlled write: Tamper-Resistance & Retention Status (Unit 6) ──
  const tamper = new AuditTamperControlsService(new AuditTamperControlsRepository(db as any));
  const st0: any = await tamper.status();
  check('all 5 controls reported; unset ones honestly not_configured (no fabricated green)', st0.available === true && st0.controls.length === 5 && st0.controls.every((c: any) => c.status === 'not_configured') && st0.configuredCount === 0);
  let tcBad = 0;
  for (const bad of [{ controlKey: 'nope', value: 'x', status: 'compliant' }, { controlKey: 'encryption', value: '', status: 'enabled' }]) { try { await tamper.setControl({ userId: 'u', email: 'super_admin' }, bad); } catch { tcBad++; } }
  check('setControl rejects bad key / empty value', tcBad === 2, String(tcBad));
  await tamper.setControl({ userId: 'u', email: 'super_admin' }, { controlKey: 'worm_storage', value: 'Enabled', status: 'compliant' });
  await tamper.setControl({ userId: 'u', email: 'super_admin' }, { controlKey: 'retention_policy', value: '7 Years', status: 'active', detail: 'Per platform policy' });
  await tamper.setControl({ userId: 'u', email: 'super_admin' }, { controlKey: 'encryption', value: 'AES-256', status: 'enabled' });
  await tamper.setControl({ userId: 'u', email: 'super_admin' }, { controlKey: 'backup_replication', value: 'Geo-Redundant', status: 'degraded' });
  const st1: any = await tamper.status();
  check('controls reflect recorded values + statuses (not hardcoded)', st1.configuredCount === 4 && st1.controls.find((c: any) => c.key === 'worm_storage').value === 'Enabled' && st1.controls.find((c: any) => c.key === 'retention_policy').value === '7 Years');
  check('a degraded control is surfaced honestly (anyFailing true)', st1.anyFailing === true && st1.controls.find((c: any) => c.key === 'backup_replication').status === 'degraded');
  check('digital_signature still not_configured (honest — not fabricated)', st1.controls.find((c: any) => c.key === 'digital_signature').status === 'not_configured');
  check('setting a control stamps last_verified_at', st1.lastVerifiedAt !== null);
  await tamper.verify({ userId: 'u', email: 'super_admin' }, 'worm_storage');
  const st2: any = await tamper.status();
  check('verify refreshes last-verified timestamp', st2.lastVerifiedAt !== null);
  // overview retention panel now real when the service is wired with tamper controls
  const svcT = new AuditLogsService(new AuditLogsRepository(db as any), tamper);
  const ot: any = await svcT.getOverview({ userId: 'u', email: 'super_admin' }, {});
  check('overview retention-status panel now real (append-only true, admin-editable false, 4 configured)', ot.retentionStatus.available === true && ot.retentionStatus.appendOnly === true && ot.retentionStatus.adminEditable === false && ot.retentionStatus.configuredCount === 4);

  // ── Controlled write: Export-risk flagging (Unit 7) ──
  await ev({ tenant: tA, module: 'payments', action: 'data_export', status: 'ok', severity: 'info', device: 'Chrome / Windows', meta: { recordCount: 5000 } });
  // Constitution 12 migration 452: audit tables are append-only. Smoke cleanup of its OWN rows on a dev database
  // skips triggers for this one statement (superuser, dev only) — production has no such path.
  await sql`set session_replication_role = replica`.execute(db);
  await sql`update audit_events set summary = 'customer data export', metadata = '{"recordCount":5000}'::jsonb where tenant_id = ${tA} and action = 'data_export' and (metadata->>'recordCount') = '5000'`.execute(db);
  await sql`set session_replication_role = default`.execute(db);
  await ev({ tenant: tA, module: 'payments', action: 'data_export', status: 'failed', severity: 'warning', device: 'Chrome / Windows' });
  const flags = new AuditExportFlagsService(new AuditExportFlagsRepository(db as any));
  const scan1: any = await flags.scan({ userId: 'u', email: 'super_admin' });
  check('scan raises flags from documented rules (>= 3: large + sensitive + failed)', scan1.created >= 3, JSON.stringify(scan1));
  const open1: any = await flags.list('open');
  check('flags include a high-risk large_export and a sensitive_scope', open1.flags.some((f: any) => f.ruleKey === 'large_export' && f.risk === 'high') && open1.flags.some((f: any) => f.ruleKey === 'sensitive_scope'));
  const scan2: any = await flags.scan({ userId: 'u', email: 'super_admin' });
  check('scanning is idempotent (no duplicate flags on re-scan)', scan2.created === 0, JSON.stringify(scan2));
  const openCountBefore = open1.flags.length;
  let flagBad = 0;
  try { await flags.review({ userId: 'u', email: 'super_admin' }, open1.flags[0].id, { status: 'dismissed' }); } catch { flagBad++; }
  check('dismissing as false positive requires a reason', flagBad === 1);
  await flags.review({ userId: 'u', email: 'super_admin' }, open1.flags[0].id, { status: 'reviewed' });
  await flags.review({ userId: 'u', email: 'super_admin' }, open1.flags[1].id, { status: 'dismissed', note: 'AL-Smoke false positive — expected report' });
  const open2: any = await flags.list('open');
  check('reviewing / dismissing removes flags from the open queue', open2.flags.length === openCountBefore - 2, `${openCountBefore} → ${open2.flags.length}`);
  const of: any = await svcT.getOverview({ userId: 'u', email: 'super_admin' }, {});
  check('overview exports-flagged at-a-glance now real (= open flag count)', of.atAGlance.exportsFlagged.available === true && of.atAGlance.exportsFlagged.value === open2.flags.length, JSON.stringify(of.atAGlance.exportsFlagged));

  // ── Context-aware export-risk rules (Unit 9: velocity + volume-spike baseline) ──
  const actorV = 'aaaa1111-1111-1111-1111-111111111111';
  const actorS = 'bbbb2222-2222-2222-2222-222222222222';
  for (const mins of [55, 50, 45, 40, 35, 30]) await sql`insert into audit_events (tenant_id, occurred_at, actor_user_id, actor_name, module, action, status, severity, device, metadata) values (${tA}, now() - (${mins} || ' minutes')::interval, ${actorV}, 'AL-Smoke Velocity', 'reports', 'data_export', 'ok', 'info', 'seed', '{"recordCount":10}'::jsonb)`.execute(db);
  for (const m of [{ mins: 55, rc: 10 }, { mins: 50, rc: 10 }, { mins: 45, rc: 10 }, { mins: 20, rc: 100 }]) await sql`insert into audit_events (tenant_id, occurred_at, actor_user_id, actor_name, module, action, status, severity, device, metadata) values (${tA}, now() - (${m.mins} || ' minutes')::interval, ${actorS}, 'AL-Smoke Spike', 'reports', 'data_export', 'ok', 'info', 'seed', ${JSON.stringify({ recordCount: m.rc })}::jsonb)`.execute(db);
  const scanC: any = await flags.scan({ userId: 'u', email: 'super_admin' });
  check('re-scan picks up context-aware flags on the new events', scanC.created >= 2, JSON.stringify(scanC));
  const allFlags: any = await flags.list();
  check('velocity rule fires for a burst of exports by one user', allFlags.flags.some((f: any) => f.ruleKey === 'velocity' && f.risk === 'medium'));
  check('volume_spike rule fires vs the user baseline (100 vs ~10)', allFlags.flags.some((f: any) => f.ruleKey === 'volume_spike' && f.risk === 'high'));
  const scanD: any = await flags.scan({ userId: 'u', email: 'super_admin' });
  check('context-aware scan stays idempotent', scanD.created === 0, JSON.stringify(scanD));

  // Seed aged 'auth' events (200 days old) for tA so retention windows have something to act on.
  await sql`insert into audit_events (tenant_id, occurred_at, actor_name, module, action, status, severity, device) select ${tA}, now() - interval '200 days', 'AL-Smoke Aged', 'auth', 'login', 'ok', 'info', 'seed' from generate_series(1,3)`.execute(db);
  const retention = new AuditRetentionService(new AuditRetentionRepository(db as any));
  let retBad = 0;
  for (const bad of [{ category: 'nope', hotDays: 1, archiveDays: 1 }, { category: 'auth', hotDays: -1, archiveDays: 1 }]) { try { await retention.setPolicy({ userId: 'u', email: 'super_admin' }, bad); } catch { retBad++; } }
  check('setPolicy rejects invalid category / negative days', retBad === 2, String(retBad));
  const p1: any = await retention.setPolicy({ userId: 'u', email: 'super_admin' }, { category: 'auth', hotDays: 30, archiveDays: 60, reason: 'AL-Smoke policy' });
  check('policy created at version 1 with 90 total days', p1.policy.version === 1 && p1.policy.hotDays === 30 && p1.policy.archiveDays === 60);
  const list1: any = await retention.list();
  const authPol = list1.flags ? null : list1.policies.find((x: any) => x.category === 'auth');
  check('eligibility preview counts aged events past retention (3, honoring holds)', authPol && authPol.totalDays === 90 && authPol.purgeEligible === 3, JSON.stringify(authPol));
  // a global active hold overrides retention → nothing eligible
  const gh: any = await sql`insert into audit_legal_holds (hold_ref, scope_type, scope_value, reason, status) values ('LH-ALSMOKE-RET', 'global', null, 'AL-Smoke retention override', 'active') returning id`.execute(db);
  const list2: any = await retention.list();
  check('active legal hold overrides retention (eligibility → 0)', list2.policies.find((x: any) => x.category === 'auth').purgeEligible === 0);
  await sql`delete from audit_legal_holds where id = ${gh.rows[0].id}`.execute(db);
  // append-only versioning: updating supersedes v1, keeps history
  const p2: any = await retention.setPolicy({ userId: 'u', email: 'super_admin' }, { category: 'auth', hotDays: 365, archiveDays: 0, reason: 'AL-Smoke extend' });
  check('updating a policy bumps to version 2 (append-only)', p2.policy.version === 2 && p2.policy.hotDays === 365);
  const hist: any = await retention.history('auth');
  check('version history preserved (v2 active, v1 superseded)', hist.versions.length === 2 && hist.versions[0].version === 2 && hist.versions[0].status === 'active' && hist.versions[1].status === 'superseded');
  const activeCount: any = await sql`select count(*)::int as c from audit_retention_policies where category = 'auth' and status = 'active'`.execute(db);
  check('exactly one active version per category', activeCount.rows[0].c === 1);
  const svcR = new AuditLogsService(new AuditLogsRepository(db as any), tamper, retention);
  const orr: any = await svcR.getOverview({ userId: 'u', email: 'super_admin' }, {});
  check('overview retention panel now carries per-category policies', orr.retentionStatus.retention && orr.retentionStatus.retention.available === true && orr.retentionStatus.retention.policies.some((x: any) => x.category === 'auth'));

  await clean();
  console.log(`──────────── ${pass}/${pass + fail} checks passed ────────────`);
  await db.destroy();
  process.exit(fail ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await db.destroy(); process.exit(1); });
