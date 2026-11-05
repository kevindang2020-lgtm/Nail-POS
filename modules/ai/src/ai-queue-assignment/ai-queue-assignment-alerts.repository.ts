// ai-queue-assignment-alerts.repository.ts — queue alerts (migrations 333, 524, 527). BUILD_PLAN Phase 6.
//
// `applyScan` is the whole lifecycle of one branch's scan in ONE transaction (advisory-locked per branch, so the
// per-minute job and a manager's "Scan now" never race): raise what is new, update what is still true (and say when it
// got worse), and AUTO-RESOLVE every unresolved alert whose condition the scan no longer sees (`auto_resolved`,
// `resolution = 'condition_cleared'`) — before Phase 6 an alert stayed open forever once the guest was served. Each
// raise / resolve writes its domain event (queue.alert_raised / queue.alert_resolved) to the outbox in the same
// transaction. Every statement names the tenant (`tenant_id = ${…}`) and the branch.
//
// A finding a staff member already resolved by hand is NOT raised again at the same or a lower severity for 12 hours
// (they decided it is handled; re-raising it every minute is noise). If it gets worse, it is raised again.
import { sql, type Kysely } from 'kysely';
import { canMoveToSql } from '@aipowersalon/database';
import { QUEUE_ALERT } from '../ai-lifecycles';
import { randomUUID } from 'node:crypto';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';
import { SEVERITY_RANK, findingKey, type AlertFinding, type AlertSeverity } from './ai-queue-assignment-detection';

export type AlertStatus = 'open' | 'acknowledged' | 'resolved';
export interface AlertRecord {
  id: string; tenantId: string; branchId: string; queueEntryId: string; type: string; severity: AlertSeverity;
  reason: string; ageMinutes: number; status: AlertStatus; technicianId: string | null;
  autoResolved: boolean; resolution: string | null; reviewNote: string | null; notifiedSeverity: AlertSeverity | null;
  acknowledgedBy: string | null; acknowledgedAt: string | null; resolvedBy: string | null; resolvedAt: string | null;
  lastSeenAt: string | null; createdAt: string; updatedAt: string;
}
/** 'open' (default for screens) = not resolved (open + acknowledged); 'all' includes resolved. */
export interface AlertFilter { status?: 'open' | 'acknowledged' | 'resolved' | 'all'; type?: string; from?: string; to?: string; limit?: number }
export interface AlertScope { tenantId: string; branchId: string }
export interface ScanOutcome { raised: AlertRecord[]; escalated: AlertRecord[]; updated: number; autoResolved: AlertRecord[] }
export interface RepairRecord { queueEntryId: string; alertId: string | null; action: string; reason: string | null; performedBy: string; role?: string | null; detail?: Record<string, unknown> }

export interface QueueAlertRepositoryPort {
  applyScan(scope: AlertScope, findings: AlertFinding[], nowIso?: string): Promise<ScanOutcome>;
  list(scope: AlertScope, filter?: AlertFilter): Promise<AlertRecord[]>;
  get(scope: AlertScope, id: string): Promise<AlertRecord | null>;
  acknowledge(scope: AlertScope, id: string, by: string, note?: string | null): Promise<AlertRecord | null>;
  /** staff resolve (resolution e.g. 'resolved_by_staff' / 'repaired:unassign') — null when not found or already resolved */
  resolve(scope: AlertScope, id: string, by: string, opts: { note?: string | null; resolution: string }): Promise<AlertRecord | null>;
  recordRepair(scope: AlertScope, r: RepairRecord): Promise<void>;
  markNotified(scope: AlertScope, id: string, severity: AlertSeverity): Promise<void>;
}

const SUPPRESS_MS = 12 * 3600_000;
const isUuid = (s: string | null | undefined): s is string => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as any).toISOString());
const rank = (s: string | null | undefined): number => (s && s in SEVERITY_RANK ? SEVERITY_RANK[s as AlertSeverity] : -1);
function eventFor(type: 'raised' | 'resolved', a: AlertRecord, actor: string | null) {
  return createDomainEvent({
    eventType: type === 'raised' ? DOMAIN_EVENTS.QUEUE_ALERT_RAISED : DOMAIN_EVENTS.QUEUE_ALERT_RESOLVED,
    tenantId: a.tenantId, branchId: a.branchId, aggregateType: 'queue_alert', aggregateId: a.id,
    actorId: isUuid(actor) ? actor : undefined, actorType: isUuid(actor) ? 'user' : 'system',
    // identifiers and plain-words reason only — never a guest's name or phone
    payload: { alertId: a.id, type: a.type, severity: a.severity, queueEntryId: a.queueEntryId, technicianId: a.technicianId, status: a.status, autoResolved: a.autoResolved, resolution: a.resolution },
  });
}

// ── in memory ──────────────────────────────────────────────────────────────────────────────────────────────────────
export class InMemoryQueueAlertRepository implements QueueAlertRepositoryPort {
  alerts: AlertRecord[] = [];
  repairs: (RepairRecord & AlertScope & { createdAt: string })[] = [];
  events: { type: 'raised' | 'resolved'; alertId: string }[] = [];
  private mine(s: AlertScope) { return this.alerts.filter((a) => a.tenantId === s.tenantId && a.branchId === s.branchId); }

  async applyScan(scope: AlertScope, findings: AlertFinding[], nowIso = new Date().toISOString()): Promise<ScanOutcome> {
    const out: ScanOutcome = { raised: [], escalated: [], updated: 0, autoResolved: [] };
    const open = this.mine(scope).filter((a) => a.status !== 'resolved');
    const seen = new Set<string>();
    for (const f of findings) {
      const k = findingKey(f); if (seen.has(k)) continue; seen.add(k);
      const cur = open.find((a) => findingKey(a) === k);
      if (cur) {
        const worse = rank(f.severity) > rank(cur.severity);
        Object.assign(cur, { severity: f.severity, reason: f.reason, ageMinutes: f.ageMinutes, technicianId: f.technicianId ?? cur.technicianId, lastSeenAt: nowIso, updatedAt: nowIso });
        out.updated++; if (worse) out.escalated.push(cur);
        continue;
      }
      const handled = this.mine(scope).some((a) => findingKey(a) === k && a.status === 'resolved' && !a.autoResolved && a.resolvedAt && Date.parse(nowIso) - Date.parse(a.resolvedAt) < SUPPRESS_MS && rank(a.severity) >= rank(f.severity));
      if (handled) continue;
      const a: AlertRecord = { id: randomUUID(), tenantId: scope.tenantId, branchId: scope.branchId, queueEntryId: f.queueEntryId, type: f.type, severity: f.severity, reason: f.reason, ageMinutes: f.ageMinutes,
        status: 'open', technicianId: f.technicianId ?? null, autoResolved: false, resolution: null, reviewNote: null, notifiedSeverity: null, acknowledgedBy: null, acknowledgedAt: null,
        resolvedBy: null, resolvedAt: null, lastSeenAt: nowIso, createdAt: nowIso, updatedAt: nowIso };
      this.alerts.push(a); out.raised.push(a); this.events.push({ type: 'raised', alertId: a.id });
    }
    for (const a of open) if (!seen.has(findingKey(a))) {
      Object.assign(a, { status: 'resolved', autoResolved: true, resolution: 'condition_cleared', resolvedBy: 'system', resolvedAt: nowIso, updatedAt: nowIso });
      out.autoResolved.push(a); this.events.push({ type: 'resolved', alertId: a.id });
    }
    return out;
  }
  async list(scope: AlertScope, f: AlertFilter = {}): Promise<AlertRecord[]> {
    const st = f.status ?? 'open';
    return this.mine(scope).filter((a) => (st === 'all' ? true : st === 'open' ? a.status !== 'resolved' : a.status === st) && (!f.type || a.type === f.type)
      && (!f.from || a.createdAt >= f.from) && (!f.to || a.createdAt <= f.to)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, f.limit ?? 500);
  }
  async get(scope: AlertScope, id: string) { return this.mine(scope).find((a) => a.id === id) ?? null; }
  async acknowledge(scope: AlertScope, id: string, by: string, note?: string | null) {
    const a = this.mine(scope).find((x) => x.id === id && x.status === 'open'); if (!a) return null;
    Object.assign(a, { status: 'acknowledged', acknowledgedBy: by, acknowledgedAt: new Date().toISOString(), reviewNote: note ?? a.reviewNote, updatedAt: new Date().toISOString() }); return a;
  }
  async resolve(scope: AlertScope, id: string, by: string, o: { note?: string | null; resolution: string }) {
    const a = this.mine(scope).find((x) => x.id === id && x.status !== 'resolved'); if (!a) return null;
    Object.assign(a, { status: 'resolved', resolvedBy: by, resolvedAt: new Date().toISOString(), resolution: o.resolution, reviewNote: o.note ?? a.reviewNote, autoResolved: false, updatedAt: new Date().toISOString() });
    this.events.push({ type: 'resolved', alertId: a.id }); return a;
  }
  async recordRepair(scope: AlertScope, r: RepairRecord) { this.repairs.push({ ...scope, ...r, createdAt: new Date().toISOString() }); }
  async markNotified(scope: AlertScope, id: string, severity: AlertSeverity) { const a = this.mine(scope).find((x) => x.id === id); if (a) a.notifiedSeverity = severity; }
}

// ── PostgreSQL ─────────────────────────────────────────────────────────────────────────────────────────────────────
export class KyselyQueueAlertRepository implements QueueAlertRepositoryPort {
  constructor(private readonly db: Kysely<any>, private readonly outbox: OutboxWriter | null = null) {}
  private map(r: any): AlertRecord {
    return { id: String(r.id), tenantId: String(r.tenant_id), branchId: String(r.branch_id), queueEntryId: String(r.queue_entry_id), type: r.type, severity: r.severity, reason: r.reason,
      ageMinutes: Number(r.age_minutes), status: r.status, technicianId: r.technician_id ? String(r.technician_id) : null, autoResolved: !!r.auto_resolved, resolution: r.resolution ?? null,
      reviewNote: r.review_note ?? null, notifiedSeverity: r.notified_severity ?? null, acknowledgedBy: r.acknowledged_by ?? null, acknowledgedAt: iso(r.acknowledged_at),
      resolvedBy: r.resolved_by ?? null, resolvedAt: iso(r.resolved_at), lastSeenAt: iso(r.last_seen_at), createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)! };
  }
  private async event(trx: any, type: 'raised' | 'resolved', a: AlertRecord, actor: string | null) {
    if (this.outbox) await this.outbox.write(trx, eventFor(type, a, actor));
  }

  async applyScan(scope: AlertScope, findings: AlertFinding[], nowIso = new Date().toISOString()): Promise<ScanOutcome> {
    const out: ScanOutcome = { raised: [], escalated: [], updated: 0, autoResolved: [] };
    await (this.db as any).transaction().execute(async (trx: any) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${'qalerts:' + scope.tenantId + ':' + scope.branchId}, 0))`.execute(trx);
      const open = ((await sql`select * from queue_alerts where tenant_id = ${scope.tenantId} and branch_id = ${scope.branchId} and status <> 'resolved'`.execute(trx)).rows as any[]).map((r) => this.map(r));
      const handled = ((await sql`select type, queue_entry_id, severity from queue_alerts where tenant_id = ${scope.tenantId} and branch_id = ${scope.branchId}
                                    and status = 'resolved' and auto_resolved = false and resolved_at > ${new Date(Date.parse(nowIso) - SUPPRESS_MS).toISOString()}::timestamptz`.execute(trx)).rows as any[]);
      const byKey = new Map(open.map((a) => [findingKey(a), a]));
      const seen = new Set<string>();
      for (const f of findings) {
        const k = findingKey(f); if (seen.has(k)) continue; seen.add(k);
        const cur = byKey.get(k);
        if (cur) {
          const r = (await sql`update queue_alerts set severity = ${f.severity}, reason = ${f.reason}, age_minutes = ${f.ageMinutes}, technician_id = coalesce(${f.technicianId ?? null}::uuid, technician_id),
                                 last_seen_at = ${nowIso}::timestamptz, updated_at = now()
                               where id = ${cur.id} and tenant_id = ${scope.tenantId} and branch_id = ${scope.branchId} returning *`.execute(trx)).rows as any[];
          out.updated++;
          if (rank(f.severity) > rank(cur.severity) && r[0]) out.escalated.push(this.map(r[0]));
          continue;
        }
        if (handled.some((h) => findingKey({ type: h.type, queueEntryId: h.queue_entry_id }) === k && rank(h.severity) >= rank(f.severity))) continue;
        // the partial unique index uq_qalerts_active (one unresolved alert per guest + type) is the backstop behind the
        // advisory lock: a scan that loses a race to another writer updates nothing and raises nothing — never a raw error
        const ins = (await sql`insert into queue_alerts (tenant_id, branch_id, queue_entry_id, type, severity, reason, age_minutes, technician_id, last_seen_at)
                               values (${scope.tenantId}, ${scope.branchId}, ${f.queueEntryId}, ${f.type}, ${f.severity}, ${f.reason}, ${f.ageMinutes}, ${isUuid(f.technicianId) ? f.technicianId : null}, ${nowIso}::timestamptz)
                               on conflict (tenant_id, branch_id, queue_entry_id, type) where status <> 'resolved' do nothing
                               returning *`.execute(trx)).rows as any[];
        if (!ins[0]) { out.updated++; continue; }
        const a = this.map(ins[0]); out.raised.push(a); await this.event(trx, 'raised', a, null);
      }
      for (const a of open) {
        if (seen.has(findingKey(a))) continue;
        const r = (await sql`update queue_alerts set status = 'resolved', auto_resolved = true, resolution = 'condition_cleared', resolved_by = 'system', resolved_at = ${nowIso}::timestamptz, updated_at = now()
                             where id = ${a.id} and tenant_id = ${scope.tenantId} and branch_id = ${scope.branchId} and ${canMoveToSql(QUEUE_ALERT, 'resolved')} returning *`.execute(trx)).rows as any[];
        if (r[0]) { const x = this.map(r[0]); out.autoResolved.push(x); await this.event(trx, 'resolved', x, null); }
      }
    });
    return out;
  }

  async list(scope: AlertScope, f: AlertFilter = {}): Promise<AlertRecord[]> {
    const st = f.status ?? 'open';
    const r = await sql`select * from queue_alerts where tenant_id = ${scope.tenantId} and branch_id = ${scope.branchId}
      ${st === 'all' ? sql`` : st === 'open' ? sql`and status <> 'resolved'` : sql`and status = ${st}`}
      ${f.type ? sql`and type = ${f.type}` : sql``}
      ${f.from ? sql`and created_at >= ${f.from}::timestamptz` : sql``}
      ${f.to ? sql`and created_at <= ${f.to}::timestamptz` : sql``}
      order by created_at desc limit ${Math.max(1, Math.min(5000, f.limit ?? 500))}`.execute(this.db);
    return (r.rows as any[]).map((x) => this.map(x));
  }
  async get(scope: AlertScope, id: string): Promise<AlertRecord | null> {
    if (!isUuid(id)) return null;
    const r = await sql`select * from queue_alerts where id = ${id} and tenant_id = ${scope.tenantId} and branch_id = ${scope.branchId}`.execute(this.db);
    return r.rows[0] ? this.map(r.rows[0]) : null;
  }
  async acknowledge(scope: AlertScope, id: string, by: string, note?: string | null): Promise<AlertRecord | null> {
    if (!isUuid(id)) return null;
    const r = await sql`update queue_alerts set status = 'acknowledged', acknowledged_by = ${by}, acknowledged_at = now(), review_note = coalesce(${note ?? null}, review_note), updated_at = now()
                        where id = ${id} and tenant_id = ${scope.tenantId} and branch_id = ${scope.branchId} and ${canMoveToSql(QUEUE_ALERT, 'acknowledged')} returning *`.execute(this.db);
    return r.rows[0] ? this.map(r.rows[0]) : null;
  }
  async resolve(scope: AlertScope, id: string, by: string, o: { note?: string | null; resolution: string }): Promise<AlertRecord | null> {
    if (!isUuid(id)) return null;
    let out: AlertRecord | null = null;
    await (this.db as any).transaction().execute(async (trx: any) => {
      const r = await sql`update queue_alerts set status = 'resolved', resolved_by = ${by}, resolved_at = now(), resolution = ${o.resolution}, review_note = coalesce(${o.note ?? null}, review_note),
                            auto_resolved = false, updated_at = now()
                          where id = ${id} and tenant_id = ${scope.tenantId} and branch_id = ${scope.branchId} and ${canMoveToSql(QUEUE_ALERT, 'resolved')} returning *`.execute(trx);
      if (r.rows[0]) { out = this.map(r.rows[0]); await this.event(trx, 'resolved', out, by); }
    });
    return out;
  }
  async recordRepair(scope: AlertScope, r: RepairRecord): Promise<void> {
    await (this.db as any).transaction().execute(async (trx: any) => {
      await sql`insert into queue_repair_actions (tenant_id, branch_id, queue_entry_id, alert_id, action, reason, performed_by)
                values (${scope.tenantId}, ${scope.branchId}, ${r.queueEntryId}, ${isUuid(r.alertId) ? r.alertId : null}, ${r.action}, ${r.reason}, ${r.performedBy})`.execute(trx);
      await sql`insert into audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
                values (${scope.tenantId}, ${scope.branchId}, ${isUuid(r.performedBy) ? r.performedBy : null}, ${r.role ?? null}, 'ai_queue_alert_repaired', 'queue_alert', ${r.alertId ?? r.queueEntryId},
                        ${JSON.stringify({ queueEntryId: r.queueEntryId, action: r.action, reason: r.reason, ...(r.detail ?? {}) })}::jsonb)`.execute(trx);
    });
  }
  async markNotified(scope: AlertScope, id: string, severity: AlertSeverity): Promise<void> {
    await sql`update queue_alerts set notified_severity = ${severity} where id = ${id} and tenant_id = ${scope.tenantId} and branch_id = ${scope.branchId}`.execute(this.db);
  }
}
