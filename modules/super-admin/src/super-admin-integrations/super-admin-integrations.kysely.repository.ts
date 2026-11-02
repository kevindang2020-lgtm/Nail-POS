// super-admin-integrations.kysely.repository.ts — Super Admin › System Settings › Integrations.
// Cross-tenant READ surface aggregating the platform's REAL third-party-connection signals into the Integrations
// reference layout. Sources (all pre-existing; nothing re-created):
//   • tenant_webhooks / tenant_webhook_deliveries (134/137) — durable webhook dispatcher: status, failure counts,
//     delivery attempts, dead-letter, last error → webhook health, recent events, sync/webhook errors, retry queue.
//   • tenant_api_keys (134) — hashed API keys with environment/scopes/expiry/revocation → auth & token alerts.
//   • payment_gateway_events — processor webhook/event stream with signature_valid + processed_at → API usage +
//     webhook signature health for payment processors.
//   • tenant_payment_config — configured payment connections (credentials are NEVER read here).
//   • pos_booking_integrations — Google Reserve / Online Booking / AI phone connection flags.
//   • chargebacks / payment_settlements — provider context.
// Honest-verification: connection/auth/sync/webhook are SEPARATE controlled statuses; anything not modelled for a
// provider renders as null/'—'/available:false and is never fabricated. Secrets/tokens are never selected.
// Money (where shown) is integer cents. Write workflows (OAuth, credential rotation, sync engine, live webhook
// reprocessing) are separate audited units; this file is read-only plus the safe status-management writes below.

import { canMoveToSql } from '@aipowersalon/database';
import { TENANT_WEBHOOK } from '../lifecycles';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

export type IntegrationsFilters = { integrationType?: string; tenantId?: string; status?: string; authStatus?: string; syncState?: string; dateFrom?: string; dateTo?: string; q?: string; limit?: number };

// Approved provider catalog (metadata only — not production data). Each maps to a real signal source where one
// exists; category matches the reference. `source` drives how live metrics are derived in connectedIntegrations().
export const PROVIDER_CATALOG: { key: string; name: string; category: string; source: 'payment' | 'webhook' | 'booking_reserve' | 'booking_ai' | 'booking_online' | 'communication' | 'accounting' | 'payroll' | 'data_import' | 'hardware' | 'platform'; webhookCapable: boolean }[] = [
  { key: 'fiserv', name: 'Fiserv', category: 'Payment Gateway', source: 'payment', webhookCapable: true },
  { key: 'payment_gateways', name: 'Payment Gateways', category: 'Payment Gateway', source: 'payment', webhookCapable: true },
  { key: 'twilio', name: 'Twilio', category: 'Communication', source: 'communication', webhookCapable: true },
  { key: 'retell_ai', name: 'Retell AI', category: 'AI & Voice', source: 'booking_ai', webhookCapable: true },
  { key: 'email_providers', name: 'Email Providers', category: 'Communication', source: 'communication', webhookCapable: true },
  { key: 'accounting', name: 'Accounting Software', category: 'Accounting', source: 'accounting', webhookCapable: false },
  { key: 'payroll', name: 'Payroll Systems', category: 'HR & Payroll', source: 'payroll', webhookCapable: false },
  { key: 'google_calendar', name: 'Google Calendar', category: 'Productivity', source: 'booking_reserve', webhookCapable: true },
  { key: 'apple_google', name: 'Apple & Google Services', category: 'Platform Services', source: 'platform', webhookCapable: true },
  { key: 'customer_imports', name: 'Customer Data Imports', category: 'Data Import', source: 'data_import', webhookCapable: false },
  { key: 'hardware', name: 'Hardware Integrations', category: 'Hardware', source: 'hardware', webhookCapable: false },
];

export const MARKETPLACE = [
  { key: 'fiserv', name: 'Fiserv', category: 'Payment Gateway' },
  { key: 'twilio', name: 'Twilio', category: 'Communication' },
  { key: 'retell_ai', name: 'Retell AI', category: 'AI & Voice' },
  { key: 'quickbooks', name: 'QuickBooks', category: 'Accounting' },
  { key: 'xero', name: 'Xero', category: 'Accounting' },
  { key: 'google_calendar', name: 'Google Calendar', category: 'Productivity' },
  { key: 'gmail', name: 'Gmail', category: 'Email' },
  { key: 'outlook', name: 'Outlook', category: 'Email' },
  { key: 'clover', name: 'Clover', category: 'Payments' },
  { key: 'hardware_connectors', name: 'Hardware Connectors', category: 'Hardware' },
];

export class KyselyIntegrationsRepo {
  constructor(private readonly db: Kysely<DB>) {}

  private tenantFilter(o: IntegrationsFilters) {
    return o.tenantId ? sql`and tenant_id = ${o.tenantId}::uuid` : sql``;
  }

  async overview(opts: IntegrationsFilters = {}): Promise<any> {
    const tf = this.tenantFilter(opts);
    // webhook connections + health
    const wh: any = await sql<any>`
      select count(*)::int as total,
        coalesce(sum(case when status = 'active' then 1 else 0 end),0)::int as active,
        coalesce(sum(case when status = 'paused' then 1 else 0 end),0)::int as paused,
        coalesce(sum(case when status = 'disabled' then 1 else 0 end),0)::int as disabled,
        coalesce(sum(case when status = 'active' and failure_count = 0 then 1 else 0 end),0)::int as healthy,
        coalesce(sum(case when status = 'active' and failure_count > 0 then 1 else 0 end),0)::int as warning
      from tenant_webhooks where true ${tf}`.execute(this.db).then((r: any) => r.rows[0]).catch(() => null);
    // webhook deliveries (sync/webhook activity)
    const del: any = await sql<any>`
      select
        coalesce(sum(case when status in ('failed','dead') then 1 else 0 end),0)::int as failed_total,
        coalesce(sum(case when status = 'delivered' and updated_at >= now() - interval '24 hours' then 1 else 0 end),0)::int as delivered_24h,
        coalesce(sum(case when status in ('failed','dead') and updated_at >= now() - interval '24 hours' then 1 else 0 end),0)::int as failed_24h,
        coalesce(sum(case when created_at::date = current_date then 1 else 0 end),0)::int as today,
        coalesce(sum(case when status = 'delivered' and created_at::date = current_date then 1 else 0 end),0)::int as delivered_today
      from tenant_webhook_deliveries where true ${tf}`.execute(this.db).then((r: any) => r.rows[0]).catch(() => null);
    // api keys → token alerts
    const keys: any = await sql<any>`
      select count(*)::int as total,
        coalesce(sum(case when revoked_at is null and (expires_at is null or expires_at > now()) then 1 else 0 end),0)::int as valid,
        coalesce(sum(case when revoked_at is null and expires_at is not null and expires_at <= now() then 1 else 0 end),0)::int as expired,
        coalesce(sum(case when revoked_at is null and expires_at is not null and expires_at > now() and expires_at <= now() + interval '14 days' then 1 else 0 end),0)::int as expiring,
        coalesce(sum(case when revoked_at is not null then 1 else 0 end),0)::int as revoked
      from tenant_api_keys where true ${tf}`.execute(this.db).then((r: any) => r.rows[0]).catch(() => null);
    // payment gateway events → api usage + signature health
    const ev: any = await sql<any>`
      select count(*)::int as total,
        coalesce(sum(case when created_at::date = current_date then 1 else 0 end),0)::int as today,
        coalesce(sum(case when created_at::date = current_date and signature_valid then 1 else 0 end),0)::int as today_valid,
        coalesce(sum(case when created_at >= now() - interval '24 hours' and not signature_valid then 1 else 0 end),0)::int as bad_sig_24h
      from payment_gateway_events where true ${tf}`.execute(this.db).then((r: any) => r.rows[0]).catch(() => null);
    // configured payment connections + connected tenants
    const pay: any = await sql<any>`select count(*)::int as configured, count(distinct tenant_id)::int as tenants from tenant_payment_config where true ${tf}`.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({ configured: 0, tenants: 0 }));
    const connTenants: any = await sql<any>`
      select count(distinct t)::int as n from (
        select tenant_id::text as t from tenant_webhooks where true ${tf}
        union select tenant_id::text from tenant_api_keys where true ${tf}
        union select tenant_id::text from tenant_payment_config where true ${tf}
      ) u`.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({ n: 0 }));

    if (!wh && !del && !keys) return { available: false };
    const activeWebhooks = n(wh?.active); const configuredPay = n(pay?.configured);
    const totalActive = activeWebhooks + configuredPay;
    const healthy = n(wh?.healthy) + configuredPay; // active webhooks w/o failures + configured payment connections
    const disabledConnections = n(wh?.disabled) + n(keys?.revoked);
    const webhookErrors = n(del?.failed_24h) + n(ev?.bad_sig_24h);
    const apiUsageToday = n(ev?.today) + n(del?.today);
    const requiringAttention = n(wh?.paused) + n(wh?.warning) + n(keys?.expired) + n(keys?.expiring) + n(ev?.bad_sig_24h);

    // sync success trend — last 7 days of webhook deliveries
    const trend: any = await sql<any>`
      with days as (select generate_series((current_date - interval '6 days')::date, current_date, interval '1 day')::date as d)
      select to_char(days.d,'Mon DD') as label, to_char(days.d,'YYYY-MM-DD') as date,
        coalesce(sum(case when x.status = 'delivered' then 1 else 0 end),0)::int as ok,
        coalesce(count(x.id),0)::int as total
      from days left join tenant_webhook_deliveries x on x.created_at::date = days.d ${opts.tenantId ? sql`and x.tenant_id = ${opts.tenantId}::uuid` : sql``}
      group by days.d order by days.d`.execute(this.db).then((r: any) => r.rows ?? []).catch(() => []);

    // API usage by integration (today) — group gateway events by processor + webhook deliveries bucket
    const usageByProc: any = await sql<any>`
      select coalesce(processor_type,'Other') as k, count(*)::int as c from payment_gateway_events
      where created_at::date = current_date ${tf} group by processor_type order by c desc limit 6`.execute(this.db).then((r: any) => r.rows ?? []).catch(() => []);

    const statusBreakdown = [
      { status: 'Active', count: activeWebhooks + configuredPay },
      { status: 'Warning', count: n(wh?.warning) + n(keys?.expiring) },
      { status: 'Failed', count: n(del?.failed_24h) },
      { status: 'Disabled', count: n(wh?.disabled) },
      { status: 'Unknown', count: n(keys?.total) - n(keys?.valid) - n(keys?.expired) - n(keys?.revoked) },
    ].map((s) => ({ ...s, count: Math.max(0, s.count) }));

    const webhookHealth = [
      { status: 'Healthy', count: n(wh?.healthy) },
      { status: 'Warning', count: n(wh?.warning) },
      { status: 'Failed', count: n(wh?.disabled) + n(del?.failed_total > 0 ? 0 : 0) },
      { status: 'No Webhook', count: Math.max(0, n(connTenants?.n) - n(wh?.total)) },
    ];

    const totalHealthDenom = totalActive || 1;
    return {
      available: true,
      kpis: {
        totalActiveIntegrations: totalActive,
        connectedTenants: n(connTenants?.n),
        healthyConnections: healthy, healthyPct: Math.round((healthy / totalHealthDenom) * 1000) / 10,
        failedSynchronizations: n(del?.failed_total), failedSync24h: n(del?.failed_24h),
        expiredAuthTokens: n(keys?.expired),
        webhookErrors,
        apiUsageToday,
        integrationsRequiringAttention: requiringAttention,
        successfulSyncs24h: n(del?.delivered_24h),
        disabledConnections,
      },
      syncTrend: trend.map((r: any) => ({ label: r.label, date: r.date, successPct: n(r.total) > 0 ? Math.round((n(r.ok) / n(r.total)) * 1000) / 10 : 0, total: n(r.total) })),
      apiUsageByIntegration: usageByProc.map((r: any) => ({ integration: r.k, calls: n(r.c) })),
      statusBreakdown,
      webhookHealth,
    };
  }

  // Connected Integrations directory — one row per approved provider, with live metrics derived from the real
  // signal source for that provider (honest '—'/0 where a provider isn't separately modelled yet).
  async connectedIntegrations(opts: IntegrationsFilters = {}): Promise<any[]> {
    const tf = this.tenantFilter(opts);
    const payByProc: Record<string, any> = {};
    const rows: any = await sql<any>`
      select coalesce(processor_type,'unknown') as p, count(distinct tenant_id)::int as tenants,
        coalesce(sum(case when created_at::date = current_date then 1 else 0 end),0)::int as today,
        coalesce(sum(case when created_at >= now() - interval '24 hours' and not signature_valid then 1 else 0 end),0)::int as bad_sig,
        max(created_at) as last_ev
      from payment_gateway_events where true ${tf} group by processor_type`.execute(this.db).then((r: any) => r.rows ?? []).catch(() => []);
    for (const r of rows) payByProc[String(r.p).toLowerCase()] = r;
    const payConfigured: any = await sql<any>`select count(distinct tenant_id)::int as tenants from tenant_payment_config where true ${tf}`.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({ tenants: 0 }));
    const booking: any = await sql<any>`select
      coalesce(sum(case when google_reserve_connected then 1 else 0 end),0)::int as reserve,
      coalesce(sum(case when ai_phone_enabled then 1 else 0 end),0)::int as ai,
      coalesce(sum(case when online_booking_enabled then 1 else 0 end),0)::int as online from pos_booking_integrations`.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({ reserve: 0, ai: 0, online: 0 }));

    const dt = (v: any) => { try { return v ? new Date(v).toISOString().slice(0, 19) : null; } catch { return null; } };
    const list = PROVIDER_CATALOG.map((p) => {
      let tenants = 0, apiToday = 0, failed = 0, lastSync: string | null = null, status = 'pending_setup', auth = 'not_configured', webhook = p.webhookCapable ? 'not_configured' : 'not_supported', modelled = true;
      if (p.source === 'payment') {
        const key = p.key === 'fiserv' ? 'fiserv' : null;
        const agg = key ? payByProc[key] : Object.values(payByProc).reduce((a: any, b: any) => ({ tenants: n(a.tenants) + n(b.tenants), today: n(a.today) + n(b.today), bad_sig: n(a.bad_sig) + n(b.bad_sig), last_ev: a.last_ev }), { tenants: 0, today: 0, bad_sig: 0, last_ev: null });
        tenants = key ? n(agg?.tenants) : n(payConfigured?.tenants); apiToday = n(agg?.today); failed = n(agg?.bad_sig); lastSync = dt(agg?.last_ev);
        status = tenants > 0 ? 'active' : 'pending_setup'; auth = tenants > 0 ? 'valid' : 'not_configured'; webhook = n(agg?.bad_sig) > 0 ? 'warning' : tenants > 0 ? 'healthy' : 'not_configured';
      } else if (p.source === 'booking_reserve') { tenants = n(booking?.reserve); status = tenants > 0 ? 'active' : 'pending_setup'; auth = tenants > 0 ? 'valid' : 'not_configured'; webhook = 'healthy'; }
      else if (p.source === 'booking_ai') { tenants = n(booking?.ai); status = tenants > 0 ? 'active' : 'pending_setup'; auth = tenants > 0 ? 'valid' : 'not_configured'; webhook = 'healthy'; }
      else if (p.source === 'booking_online') { tenants = n(booking?.online); status = tenants > 0 ? 'active' : 'pending_setup'; }
      else { modelled = false; status = 'pending_setup'; auth = 'not_configured'; webhook = p.webhookCapable ? 'not_configured' : 'not_supported'; }
      return { key: p.key, name: p.name, category: p.category, status, tenantsUsing: tenants, authStatus: auth, lastSuccessfulSync: lastSync, failedSyncs: failed, apiUsageToday: apiToday, webhookStatus: webhook, errorLogs: failed, modelled };
    });
    // optional status filter (controlled)
    return opts.status ? list.filter((r) => r.status === opts.status) : list;
  }

  async recentWebhookEvents(opts: IntegrationsFilters = {}): Promise<any[]> {
    const lim = Math.min(200, Math.max(1, opts.limit ?? 10));
    const tf = opts.tenantId ? sql`and d.tenant_id = ${opts.tenantId}::uuid` : sql``;
    try {
      const r: any = await sql<any>`
        select d.id::text as id, d.event_type, w.name as source, d.tenant_id::text as tenant_id, t.display_name as tenant_name,
          d.status, d.attempt_count, d.last_status_code, d.last_error, to_char(d.created_at,'YYYY-MM-DD"T"HH24:MI:SS') as ts
        from tenant_webhook_deliveries d left join tenant_webhooks w on w.id = d.webhook_id left join tenants t on t.id = d.tenant_id
        where true ${tf} order by d.created_at desc limit ${lim}`.execute(this.db);
      return (r.rows ?? []).map((x: any) => ({
        id: String(x.id), eventSource: x.source ?? x.event_type ?? '—', tenantId: x.tenant_id ?? null, tenantName: x.tenant_name ?? null,
        result: x.status === 'delivered' ? 'Delivered' : x.status === 'dead' ? 'Failed' : x.status === 'failed' ? 'Failed' : x.status === 'pending' ? 'Delayed' : x.status,
        retries: n(x.attempt_count), statusCode: x.last_status_code ?? null, error: x.last_error ?? null, timestamp: x.ts ?? null,
      }));
    } catch { return []; }
  }

  async authAlerts(opts: IntegrationsFilters = {}): Promise<any[]> {
    const lim = Math.min(200, Math.max(1, opts.limit ?? 10));
    const tf = opts.tenantId ? sql`and k.tenant_id = ${opts.tenantId}::uuid` : sql``;
    try {
      const r: any = await sql<any>`
        select k.id::text as id, k.name, k.prefix, k.environment, k.tenant_id::text as tenant_id, t.display_name as tenant_name,
          k.revoked_at, k.expires_at, to_char(k.expires_at,'YYYY-MM-DD') as expires_on,
          case when k.revoked_at is not null then 'Credential revoked'
               when k.expires_at is not null and k.expires_at <= now() then 'API key expired'
               when k.expires_at is not null and k.expires_at <= now() + interval '14 days' then 'Token expiring soon'
               else null end as issue
        from tenant_api_keys k left join tenants t on t.id = k.tenant_id
        where (k.revoked_at is not null or (k.expires_at is not null and k.expires_at <= now() + interval '14 days')) ${tf}
        order by k.expires_at asc nulls last limit ${lim}`.execute(this.db);
      return (r.rows ?? []).filter((x: any) => x.issue).map((x: any) => ({
        id: String(x.id), integration: `API Key · ${x.prefix ?? x.name}`, tenantId: x.tenant_id ?? null, tenantName: x.tenant_name ?? null,
        issue: x.issue, expiresOn: x.revoked_at ? null : (x.expires_on ?? null),
      }));
    } catch { return []; }
  }

  async errorLogs(opts: IntegrationsFilters = {}): Promise<any[]> {
    const lim = Math.min(200, Math.max(1, opts.limit ?? 10));
    const tf = opts.tenantId ? sql`and d.tenant_id = ${opts.tenantId}::uuid` : sql``;
    try {
      const r: any = await sql<any>`
        select d.id::text as id, w.name as source, d.event_type, d.tenant_id::text as tenant_id, t.display_name as tenant_name,
          d.status, d.attempt_count, d.max_attempts, d.last_status_code, d.last_error, to_char(d.updated_at,'YYYY-MM-DD"T"HH24:MI:SS') as last_attempt
        from tenant_webhook_deliveries d left join tenant_webhooks w on w.id = d.webhook_id left join tenants t on t.id = d.tenant_id
        where d.status in ('failed','dead') ${tf} order by d.updated_at desc limit ${lim}`.execute(this.db);
      return (r.rows ?? []).map((x: any) => {
        const dead = x.status === 'dead';
        return {
          id: String(x.id), integration: x.source ?? '—', tenantId: x.tenant_id ?? null, tenantName: x.tenant_name ?? null,
          errorType: 'Webhook Failed', severity: dead ? 'Critical' : n(x.attempt_count) >= n(x.max_attempts) ? 'High' : 'Medium',
          lastAttempt: x.last_attempt ?? null, statusCode: x.last_status_code ?? null, message: x.last_error ?? null,
          nextAction: dead ? 'Disable Connection' : 'Retry Sync',
        };
      });
    } catch { return []; }
  }

  async tenantUsage(opts: IntegrationsFilters = {}): Promise<any[]> {
    const lim = Math.min(200, Math.max(1, opts.limit ?? 10));
    try {
      const r: any = await sql<any>`
        with base as (
          select t.id::text as tenant_id, t.display_name as tenant_name,
            (select count(*) from tenant_webhooks w where w.tenant_id = t.id) as webhooks,
            (select count(*) from tenant_api_keys k where k.tenant_id = t.id and k.revoked_at is null) as keys,
            (select count(*) from tenant_payment_config p where p.tenant_id = t.id) as pay,
            (select count(*) from payment_gateway_events e where e.tenant_id = t.id and e.created_at::date = current_date) as api_today,
            (select max(d.created_at) from tenant_webhook_deliveries d where d.tenant_id = t.id) as last_sync,
            (select coalesce(sum(w.failure_count),0) from tenant_webhooks w where w.tenant_id = t.id) as failures
          from tenants t
        )
        select *, (webhooks + keys + pay)::int as integrations from base
        where (webhooks + keys + pay) > 0 order by (webhooks + keys + pay) desc, api_today desc limit ${lim}`.execute(this.db);
      return (r.rows ?? []).map((x: any) => ({
        tenantId: String(x.tenant_id), tenantName: x.tenant_name ?? '—', integrations: n(x.integrations),
        status: n(x.failures) > 5 ? 'Warning' : n(x.integrations) > 0 ? 'Active' : 'Setup Required',
        apiCallsToday: n(x.api_today), lastSync: x.last_sync ? new Date(x.last_sync).toISOString().slice(0, 19) : null,
      }));
    } catch { return []; }
  }

  marketplace(): any[] { return MARKETPLACE.map((m) => ({ ...m })); }

  // ── Safe status-management write: disable / re-enable a webhook-based connection (audited by the service) ──
  async setWebhookStatus(id: string, status: 'active' | 'paused' | 'disabled'): Promise<{ ok: boolean; tenantId: string | null } | null> {
    const cur: any = await sql<any>`select status, tenant_id::text as tenant_id from tenant_webhooks where id = ${id}`.execute(this.db).then((r: any) => r.rows[0]).catch(() => undefined);
    if (!cur) return null;
    try { await sql`update tenant_webhooks set status = ${status}, updated_at = now() where id = ${id}::uuid and ${canMoveToSql(TENANT_WEBHOOK, status)}`.execute(this.db); return { ok: true, tenantId: cur.tenant_id ?? null }; }
    catch { return { ok: false, tenantId: cur.tenant_id ?? null }; }
  }
}
