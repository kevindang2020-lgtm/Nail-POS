// super-admin-integrations.service.ts — Integrations reads + safe connection disable/enable (audited to audit_logs).

import { KyselyIntegrationsRepo, type IntegrationsFilters } from './super-admin-integrations.kysely.repository';
import { toCsvGrid, toXlsxGrid, toPdfGrid } from '../super-admin-analytics/analytics-export';
import { sql } from 'kysely';

export class SuperAdminIntegrationsService {
  constructor(private readonly repo?: KyselyIntegrationsRepo, private readonly db?: any) {}

  async overview(o: IntegrationsFilters = {}) { if (!this.repo) return { available: false }; return this.repo.overview(o); }
  async connectedIntegrations(o: IntegrationsFilters = {}) { if (!this.repo) return { available: false, integrations: [] }; return { available: true, integrations: await this.repo.connectedIntegrations(o) }; }
  async recentWebhookEvents(o: IntegrationsFilters = {}) { if (!this.repo) return { available: false, events: [] }; return { available: true, events: await this.repo.recentWebhookEvents(o) }; }
  async authAlerts(o: IntegrationsFilters = {}) { if (!this.repo) return { available: false, alerts: [] }; return { available: true, alerts: await this.repo.authAlerts(o) }; }
  async errorLogs(o: IntegrationsFilters = {}) { if (!this.repo) return { available: false, errors: [] }; return { available: true, errors: await this.repo.errorLogs(o) }; }
  async tenantUsage(o: IntegrationsFilters = {}) { if (!this.repo) return { available: false, tenants: [] }; return { available: true, tenants: await this.repo.tenantUsage(o) }; }
  async marketplace() { if (!this.repo) return { available: false, services: [] }; return { available: true, services: this.repo.marketplace() }; }

  private async audit(actor: { id?: string; role?: string }, action: string, entityId: string, tenantId: string | null, meta: Record<string, unknown>) {
    if (!this.db) return;
    await sql`insert into audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
      values (${tenantId ?? null}::uuid, ${actor.id ?? null}::uuid, 'SUPER_ADMIN', ${action}, 'integration_connection', ${entityId}, ${JSON.stringify(meta || {})}::jsonb)`.execute(this.db).catch(() => undefined);
  }

  // Disable a compromised webhook-based connection (stops new deliveries). Reason required; audited.
  async disableConnection(actor: { id?: string; role?: string }, connectionId?: string, reason?: string) {
    if (!this.repo) return { ok: false as const, error: 'unavailable', status: 503 };
    if (!String(connectionId ?? '').trim()) return { ok: false as const, error: 'connection_required', status: 400 };
    if (!String(reason ?? '').trim()) return { ok: false as const, error: 'reason_required', status: 400 };
    const res = await this.repo.setWebhookStatus(String(connectionId), 'disabled');
    if (!res) return { ok: false as const, error: 'not_found', status: 404 };
    if (!res.ok) return { ok: false as const, error: 'write_failed', status: 400 };
    await this.audit(actor, 'super_admin_integration_disabled', String(connectionId), res.tenantId, { reason });
    return { ok: true as const, status: 'disabled' };
  }

  async enableConnection(actor: { id?: string; role?: string }, connectionId?: string, reason?: string) {
    if (!this.repo) return { ok: false as const, error: 'unavailable', status: 503 };
    if (!String(connectionId ?? '').trim()) return { ok: false as const, error: 'connection_required', status: 400 };
    const res = await this.repo.setWebhookStatus(String(connectionId), 'active');
    if (!res) return { ok: false as const, error: 'not_found', status: 404 };
    if (!res.ok) return { ok: false as const, error: 'write_failed', status: 400 };
    await this.audit(actor, 'super_admin_integration_enabled', String(connectionId), res.tenantId, { reason: reason ?? null });
    return { ok: true as const, status: 'active' };
  }

  // Export (filter-aware, formula-injection-guarded by the grid serializers, audited; secrets/tokens excluded).
  async exportReport(actor: { id?: string; role?: string }, o: IntegrationsFilters & { format?: string } = {}) {
    if (!this.repo) return { ok: false as const, error: 'unavailable', status: 503 };
    const stamp = new Date().toISOString().slice(0, 10);
    const list = await this.repo.connectedIntegrations({ ...o, limit: 5000 });
    const headers = ['Integration', 'Category', 'Status', 'Tenants Using', 'Auth Status', 'Last Successful Sync', 'Failed Syncs', 'API Usage (Today)', 'Webhook Status'];
    const rows: (string | number | null)[][] = list.map((r: any) => [r.name, r.category, r.status, r.tenantsUsing, r.authStatus, r.lastSuccessfulSync ?? '', r.failedSyncs, r.apiUsageToday, r.webhookStatus]);
    const filterSummary = ['integrationType', 'tenantId', 'status', 'authStatus', 'syncState', 'dateFrom', 'dateTo'].map((k) => (o as any)[k] ? `${k}=${(o as any)[k]}` : null).filter(Boolean).join(', ') || 'no filters';
    await this.audit(actor, 'super_admin_integration_report_exported', stamp, null, { count: rows.length, filters: filterSummary, format: String(o.format ?? 'csv') });
    const fmt = ['csv', 'xlsx', 'pdf'].includes(String(o.format)) ? String(o.format) : 'csv';
    if (fmt === 'xlsx') { const buf = toXlsxGrid(headers, rows, 'integrations'); return { ok: true as const, status: 200, filename: `integrations-${stamp}.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', encoding: 'base64' as const, rowCount: rows.length, content: buf.toString('base64') }; }
    if (fmt === 'pdf') { const buf = toPdfGrid(`Integrations — ${stamp}`, headers, rows); return { ok: true as const, status: 200, filename: `integrations-${stamp}.pdf`, mime: 'application/pdf', encoding: 'base64' as const, rowCount: rows.length, content: buf.toString('base64') }; }
    return { ok: true as const, status: 200, filename: `integrations-${stamp}.csv`, mime: 'text/csv', encoding: 'utf8' as const, rowCount: rows.length, content: toCsvGrid(headers, rows) };
  }
}
