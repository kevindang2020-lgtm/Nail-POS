// alerts.kysely.repository.ts — Postgres adapter for Super-Admin Alerts. Each query is guarded so a partial schema
// degrades to empty rather than throwing. syncFromSignals materializes actionable alerts from REAL platform state
// (payment-setup gaps, pending applications, hardware pending, gateway errors, open support) — idempotent by dedupe_key.
import { canMoveToSql } from '@aipowersalon/database';
import { ALERT } from '../lifecycles';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { AlertsRepo, AlertNote } from './alerts.repository';
import { applyFilters, paginate, summarize, type AlertRow, type AlertsQuery, type AlertStatus, type SignalSeed } from './alerts-core';

type R = Record<string, any>;

function toRow(r: R): AlertRow {
  return {
    id: String(r.id), tenantId: r.tenant_id ?? null, tenantName: r.tenant_name ?? null, title: r.title, message: r.message,
    type: r.type, severity: r.severity, status: r.status, relatedModule: r.related_module ?? null, relatedRecordId: r.related_record_id ?? null,
    dedupeKey: r.dedupe_key, createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at ?? r.created_at).toISOString(),
    readAt: r.read_at ? new Date(r.read_at).toISOString() : null, resolvedAt: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
    dismissedAt: r.dismissed_at ? new Date(r.dismissed_at).toISOString() : null,
  };
}

export class KyselyAlertsRepo implements AlertsRepo {
  constructor(private readonly db: Kysely<DB>) {}

  private async all(): Promise<AlertRow[]> {
    const rows = await sql<R>`
      select a.*, t.display_name as tenant_name
      from alerts a left join tenants t on t.id = a.tenant_id
      order by a.created_at desc limit 1000`.execute(this.db).then((r) => r.rows).catch(() => []);
    return rows.map(toRow);
  }
  async list(q: AlertsQuery) { return paginate(applyFilters(await this.all(), q), q.page, q.limit); }
  async recent(limit: number) { return (await this.all()).slice(0, limit); }
  async summary() { return summarize(await this.all()); }
  async get(id: string) {
    const a = (await this.all()).find((x) => x.id === id); if (!a) return null;
    const notes = await sql<R>`select id, alert_id, actor_user_id, note, created_at from alert_notes where alert_id = ${id} order by created_at desc`
      .execute(this.db).then((r) => r.rows).catch(() => []);
    return { ...a, notes: notes.map((n) => ({ id: String(n.id), alertId: id, actorUserId: n.actor_user_id ?? undefined, note: n.note, createdAt: new Date(n.created_at).toISOString() })) as AlertNote[] };
  }
  async setStatus(id: string, status: AlertStatus, _actorUserId?: string) {
    const stamp = status === 'read' ? sql`, read_at = now()` : status === 'resolved' ? sql`, resolved_at = now()` : status === 'dismissed' ? sql`, dismissed_at = now()` : sql``;
    const row = await sql<R>`update alerts set status = ${status}, updated_at = now() ${stamp} where id = ${id} and ${canMoveToSql(ALERT, status)} returning *`
      .execute(this.db).then((r) => r.rows[0]).catch(() => undefined);
    return row ? toRow(row) : null;
  }
  async addNote(id: string, note: string, actorUserId?: string) {
    const row = await sql<R>`insert into alert_notes (id, alert_id, actor_user_id, note) values (gen_random_uuid(), ${id}, ${actorUserId ?? null}, ${note}) returning id, created_at`
      .execute(this.db).then((r) => r.rows[0]).catch(() => undefined);
    return row ? { id: String(row.id), alertId: id, actorUserId, note, createdAt: new Date(row.created_at).toISOString() } : null;
  }
  async markAllRead(_actorUserId?: string) {
    const r = await sql<R>`update alerts set status = 'read', read_at = now(), updated_at = now() where status = 'unread' and ${canMoveToSql(ALERT, 'read')}`.execute(this.db).catch(() => ({ numAffectedRows: 0n } as any));
    return Number((r as any).numAffectedRows ?? 0);
  }
  async unreadCount() {
    return await sql<R>`select count(*)::int n from alerts where status = 'unread'`.execute(this.db).then((r) => Number(r.rows[0]?.n ?? 0)).catch(() => 0);
  }
  async writeAudit(action: string, alertId: string, meta: Record<string, unknown>, actorUserId?: string) {
    await sql`insert into audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
      values (null, ${actorUserId ?? null}, 'SUPER_ADMIN', ${action}, 'alert', ${alertId}, ${JSON.stringify(meta)}::jsonb)`.execute(this.db).catch(() => undefined);
  }

  /** Collect real signals, then upsert by dedupe_key. */
  async syncFromSignals(extra: SignalSeed[] = []): Promise<number> {
    const seeds: SignalSeed[] = [...extra];
    const rows = async (q: ReturnType<typeof sql>) => q.execute(this.db).then((r: any) => r.rows as R[]).catch(() => [] as R[]);

    for (const t of await rows(sql`
      select t.id, t.display_name from tenants t
      where not exists (select 1 from tenant_payment_config c where c.tenant_id = t.id and coalesce(c.status,'') in ('active','live','complete')) limit 200`)) {
      seeds.push({ tenantId: t.id, tenantName: t.display_name, title: 'Payment setup needed', message: 'No active payment gateway configured.', type: 'payment', severity: 'high', relatedModule: '/payment-gateways', relatedRecordId: t.id, dedupeKey: `payment_setup:${t.id}` });
    }
    for (const a of await rows(sql`select id, salon_name from tenant_applications where status in ('new','reviewing') limit 200`)) {
      seeds.push({ tenantId: null, tenantName: a.salon_name ?? null, title: 'Tenant application needs review', message: 'A new salon application is awaiting review.', type: 'application', severity: 'low', relatedModule: '/tenant-applications', relatedRecordId: a.id, dedupeKey: `application_review:${a.id}` });
    }
    for (const h of await rows(sql`select id, tenant_id from hardware_packages where status = 'pending_approval' limit 200`)) {
      seeds.push({ tenantId: h.tenant_id ?? null, tenantName: null, title: 'Hardware shipment pending', message: 'A hardware package is pending shipment.', type: 'hardware', severity: 'medium', relatedModule: '/hardware-packages', relatedRecordId: h.id, dedupeKey: `hardware_pending:${h.id}` });
    }
    // ── monitoring must not fail silent ────────────────────────────────────────────────────────────────
    //
    // This used to be `.catch(() => 0)`, and the very next line is `if (gwErr > 0)`. So a FAILED count produced
    // NO ALERT — and the moment the database is unhealthy enough to fail this query is exactly the moment a
    // payment-gateway incident is most likely and most urgent.
    //
    // An alerting system that goes quiet when the thing it watches breaks is worse than no alerting system: it
    // actively reassures you. So `null` (we could not check) raises its OWN alert, because "we cannot see whether
    // payments are failing" is itself something a human needs to know tonight.
    const gwErr: number | null = await sql<R>`select count(*)::int n from payment_gateway_events where created_at > now() - interval '24 hours' and (coalesce(event_type,'') ilike '%error%' or coalesce(event_type,'') ilike '%fail%' or coalesce(event_type,'') ilike '%decline%' or signature_valid = false)`
      .execute(this.db).then((r) => Number(r.rows[0]?.n ?? 0)).catch(() => null);

    if (gwErr == null) {
      seeds.push({ tenantId: null, tenantName: 'Platform', title: 'Payment gateway health could not be checked', message: 'The gateway error check failed to run. Payment failures may be going undetected.', type: 'system', severity: 'high', relatedModule: '/system-health', relatedRecordId: null, dedupeKey: `gateway_check_failed:${new Date().toISOString().slice(0, 10)}` });
    } else if (gwErr > 0) {
      seeds.push({ tenantId: null, tenantName: 'Platform', title: 'Payment gateway errors detected', message: `${gwErr} gateway error(s) in the last 24h.`, type: 'system', severity: 'high', relatedModule: '/system-health', relatedRecordId: null, dedupeKey: `gateway_errors:${new Date().toISOString().slice(0, 10)}` });
    }

    let created = 0;
    for (const s of seeds) {
      const r = await sql<R>`
        insert into alerts (id, tenant_id, tenant_name, title, message, type, severity, status, related_module, related_record_id, dedupe_key)
        values (gen_random_uuid(), ${s.tenantId}, ${s.tenantName}, ${s.title}, ${s.message}, ${s.type}, ${s.severity}, 'unread', ${s.relatedModule}, ${s.relatedRecordId}, ${s.dedupeKey})
        on conflict (dedupe_key) do nothing returning id`.execute(this.db).then((r) => r.rows[0]).catch(() => undefined);
      if (r) created++;
    }
    return created;
  }
}
