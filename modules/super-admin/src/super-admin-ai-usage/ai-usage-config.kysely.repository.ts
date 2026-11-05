// Kysely (Postgres) repo for AI Usage & Configuration. Usage aggregates come from ai_usage_logs (+ tenant_ai_features
// / tenant_usage_limits where available). Providers persist ONLY ciphertext + mask + fingerprint; no read path ever
// selects the ciphertext into a client-facing shape. Latency / safety-flags / provider-health have no column → null.

import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { UsageConfigRepo, ProviderRecord, ProviderWrite, GlobalPromptRecord, GlobalPromptWrite } from './ai-usage-config.repository';
import type { UsageAggregate } from './ai-usage-config-core';
import type { UsageSeries } from './ai-usage-analytics-core';
import { canMoveToSql } from '@aipowersalon/database';
import { AI_PROVIDER } from '../lifecycles';

const iso = (d: unknown): string | null => (d == null ? null : d instanceof Date ? d.toISOString() : String(d));
const mapProvider = (r: any): ProviderRecord => ({
  id: r.id, providerKey: r.provider_key, displayName: r.display_name, status: r.status, defaultModel: r.default_model,
  apiKeyMasked: r.api_key_masked, apiKeyFingerprint: r.api_key_fingerprint, hasKey: !!r.api_key_ciphertext,
  lastSyncAt: iso(r.last_sync_at), updatedAt: iso(r.updated_at) as string,
});
const mapPrompt = (r: any): GlobalPromptRecord => ({ id: r.id, promptKey: r.prompt_key, name: r.name, body: r.body, version: Number(r.version || 1), status: r.status, updatedAt: iso(r.updated_at) as string });

export class KyselyUsageConfigRepo implements UsageConfigRepo {
  constructor(private readonly db: Kysely<DB>) {}

  async usageAggregate(scope: { tenantId?: string }): Promise<UsageAggregate> {
    const t = scope.tenantId ? sql`WHERE tenant_id = ${scope.tenantId}` : sql``;
    try {
      const u = await sql<any>`
        SELECT count(DISTINCT tenant_id)::int AS active_tenants,
               COALESCE(sum(total_tokens),0)::bigint AS total_tokens,
               COALESCE(sum(cost_estimate_cents),0)::bigint AS cost_cents,
               count(*)::int AS model_requests,
               count(*) FILTER (WHERE status IN ('failed','provider_error'))::int AS failed_requests,
               count(*) FILTER (WHERE usage_unit = 'minutes')::int AS minute_rows,
               COALESCE(sum(total_tokens) FILTER (WHERE usage_unit = 'minutes'),0)::int AS total_minutes,
               count(*) FILTER (WHERE usage_unit = 'calls')::int AS receptionist_calls
        FROM ai_usage_logs ${t}`.execute(this.db);
      const row = u.rows[0] || {};
      let activeFeatures = 0;
      try { const f = await sql<{ n: number }>`SELECT count(*)::int AS n FROM tenant_ai_features WHERE enabled = true`.execute(this.db); activeFeatures = Number(f.rows[0]?.n ?? 0); } catch { /* table shape may differ */ }
      let allowanceUsedPct: number | null = null, overageEvents: number | null = null;
      try {
        // `used_value`, NOT `used` — tenant_usage_limits has no column called `used`. The catch below said
        // "schema may differ → leave null", which was a guess; it did differ, so `allowanceUsedPct` has always
        // been NULL and the Super Admin AI Usage screen has never shown an allowance figure. The catch stays
        // (returning null beats inventing a percentage), but it no longer has anything to swallow.
        const l = await sql<any>`SELECT COALESCE(avg(NULLIF(used_pct,NULL)),NULL) AS used FROM (SELECT (used_value::float / NULLIF(limit_value,0) * 100) AS used_pct FROM tenant_usage_limits) s`.execute(this.db);
        if (l.rows[0]?.used != null) allowanceUsedPct = Math.round(Number(l.rows[0].used));
      } catch { /* schema may differ → leave null */ }
      return {
        activeTenants: Number(row.active_tenants || 0), totalTokens: Number(row.total_tokens || 0), totalMinutes: Number(row.total_minutes || 0),
        receptionistCalls: Number(row.receptionist_calls || 0), costCents: Number(row.cost_cents || 0), modelRequests: Number(row.model_requests || 0),
        failedRequests: Number(row.failed_requests || 0), allowanceUsedPct, overageEvents, activeFeatures,
        avgLatencyMs: null, safetyFlags: null, providerHealthPct: null,
      };
    } catch {
      return { activeTenants: 0, totalTokens: 0, totalMinutes: 0, receptionistCalls: 0, costCents: 0, modelRequests: 0, failedRequests: 0, allowanceUsedPct: null, overageEvents: null, activeFeatures: 0, avgLatencyMs: null, safetyFlags: null, providerHealthPct: null };
    }
  }

  async usageSeries(scope: { tenantId?: string; days?: number }): Promise<UsageSeries> {
    const t = scope.tenantId ? sql`AND tenant_id = ${scope.tenantId}` : sql``;
    const days = Math.max(1, Math.min(90, scope.days ?? 7));
    const empty: UsageSeries = { trend: [], costRequests: [], byProvider: [], byFeature: [], tenants: [] };
    try {
      const trend = await sql<any>`SELECT to_char(created_at, 'YYYY-MM-DD') AS date, COALESCE(sum(total_tokens),0)::bigint AS tokens FROM ai_usage_logs WHERE created_at >= now() - (${days} || ' days')::interval ${t} GROUP BY 1 ORDER BY 1`.execute(this.db);
      const cr = await sql<any>`SELECT to_char(created_at, 'YYYY-MM-DD') AS date, COALESCE(sum(cost_estimate_cents),0)::bigint AS cost_cents, count(*)::int AS requests FROM ai_usage_logs WHERE created_at >= now() - (${days} || ' days')::interval ${t} GROUP BY 1 ORDER BY 1`.execute(this.db);
      const prov = await sql<any>`SELECT COALESCE(model_provider,'unknown') AS provider, count(*)::int AS requests FROM ai_usage_logs WHERE created_at >= now() - (${days} || ' days')::interval ${t} GROUP BY 1`.execute(this.db);
      const feat = await sql<any>`SELECT package_code AS feature, count(*)::int AS requests FROM ai_usage_logs WHERE created_at >= now() - (${days} || ' days')::interval ${t} GROUP BY 1`.execute(this.db);
      const ten = await sql<any>`SELECT tenant_id, COALESCE(sum(total_tokens),0)::bigint AS tokens, COALESCE(sum(usage_amount) FILTER (WHERE usage_unit='minutes'),0)::int AS minutes, count(*) FILTER (WHERE usage_unit='calls')::int AS calls, COALESCE(sum(cost_estimate_cents),0)::bigint AS cost_cents, count(*)::int AS requests, count(*) FILTER (WHERE status IN ('failed','provider_error'))::int AS failed FROM ai_usage_logs WHERE created_at >= now() - (${days} || ' days')::interval ${t} GROUP BY tenant_id ORDER BY cost_cents DESC LIMIT 25`.execute(this.db);
      return {
        trend: trend.rows.map((r) => ({ date: r.date, tokens: Number(r.tokens || 0) })),
        costRequests: cr.rows.map((r) => ({ date: r.date, costCents: Number(r.cost_cents || 0), requests: Number(r.requests || 0) })),
        byProvider: prov.rows.map((r) => ({ provider: r.provider, requests: Number(r.requests || 0) })),
        byFeature: feat.rows.map((r) => ({ feature: r.feature, requests: Number(r.requests || 0) })),
        tenants: ten.rows.map((r) => ({ tenantId: r.tenant_id, tenantName: null, tokens: Number(r.tokens || 0), minutes: Number(r.minutes || 0), calls: Number(r.calls || 0), costCents: Number(r.cost_cents || 0), requests: Number(r.requests || 0), failed: Number(r.failed || 0) })),
      };
    } catch { return empty; }
  }

  async listProviders(): Promise<ProviderRecord[]> {
    try { const r = await sql<any>`SELECT id, provider_key, display_name, status, default_model, api_key_masked, api_key_fingerprint, (api_key_ciphertext IS NOT NULL) AS api_key_ciphertext, last_sync_at, updated_at FROM ai_providers ORDER BY display_name`.execute(this.db); return r.rows.map(mapProvider); } catch { return []; }
  }
  async getProviderByKey(providerKey: string): Promise<ProviderRecord | null> {
    try { const r = await sql<any>`SELECT id, provider_key, display_name, status, default_model, api_key_masked, api_key_fingerprint, (api_key_ciphertext IS NOT NULL) AS api_key_ciphertext, last_sync_at, updated_at FROM ai_providers WHERE provider_key = ${providerKey} LIMIT 1`.execute(this.db); return r.rows[0] ? mapProvider(r.rows[0]) : null; } catch { return null; }
  }
  async upsertProvider(w: ProviderWrite): Promise<ProviderRecord> {
    const keyBits = w.apiKeyCiphertext ? sql`, api_key_ciphertext = ${w.apiKeyCiphertext}, api_key_masked = ${w.apiKeyMasked ?? null}, api_key_fingerprint = ${w.apiKeyFingerprint ?? null}` : sql``;
    const r = await sql<any>`
      INSERT INTO ai_providers (provider_key, display_name, status, default_model, api_key_ciphertext, api_key_masked, api_key_fingerprint, last_sync_at)
      VALUES (${w.providerKey}, ${w.displayName}, ${w.status || 'inactive'}, ${w.defaultModel ?? null}, ${w.apiKeyCiphertext ?? null}, ${w.apiKeyMasked ?? null}, ${w.apiKeyFingerprint ?? null}, now())
      ON CONFLICT (provider_key) DO UPDATE SET display_name = EXCLUDED.display_name, status = EXCLUDED.status,
        default_model = COALESCE(EXCLUDED.default_model, ai_providers.default_model), updated_at = now(), last_sync_at = now() ${keyBits}
      WHERE ${canMoveToSql(AI_PROVIDER, w.status || 'inactive', 'ai_providers')}
      RETURNING id, provider_key, display_name, status, default_model, api_key_masked, api_key_fingerprint, (api_key_ciphertext IS NOT NULL) AS api_key_ciphertext, last_sync_at, updated_at`.execute(this.db);
    try { await sql`INSERT INTO audit_logs (action_type, entity_type, entity_id, user_id, created_at) VALUES ('ai_provider_saved', 'ai_provider', ${r.rows[0].id}, NULL, now())`.execute(this.db); } catch { /* best-effort */ }
    return mapProvider(r.rows[0]);
  }
  async setStatus(providerKey: string, status: string): Promise<ProviderRecord | null> {
    const r = await sql<any>`UPDATE ai_providers SET status = ${status}, updated_at = now() WHERE provider_key = ${providerKey} AND ${canMoveToSql(AI_PROVIDER, status)} RETURNING id, provider_key, display_name, status, default_model, api_key_masked, api_key_fingerprint, (api_key_ciphertext IS NOT NULL) AS api_key_ciphertext, last_sync_at, updated_at`.execute(this.db);
    return r.rows[0] ? mapProvider(r.rows[0]) : null;
  }

  async listPrompts(): Promise<GlobalPromptRecord[]> {
    try { const r = await sql<any>`SELECT id, prompt_key, name, body, version, status, updated_at FROM ai_global_prompts ORDER BY name`.execute(this.db); return r.rows.map(mapPrompt); } catch { return []; }
  }
  async getPromptByKey(promptKey: string): Promise<GlobalPromptRecord | null> {
    try { const r = await sql<any>`SELECT id, prompt_key, name, body, version, status, updated_at FROM ai_global_prompts WHERE prompt_key = ${promptKey} LIMIT 1`.execute(this.db); return r.rows[0] ? mapPrompt(r.rows[0]) : null; } catch { return null; }
  }
  async upsertPrompt(w: GlobalPromptWrite): Promise<GlobalPromptRecord> {
    const r = await sql<any>`
      INSERT INTO ai_global_prompts (prompt_key, name, body, version, status)
      VALUES (${w.promptKey}, ${w.name}, ${w.body}, ${w.version}, ${w.status || 'active'})
      ON CONFLICT (prompt_key) DO UPDATE SET name = EXCLUDED.name, body = EXCLUDED.body, version = EXCLUDED.version, status = EXCLUDED.status, updated_at = now()
      RETURNING id, prompt_key, name, body, version, status, updated_at`.execute(this.db);
    try { await sql`INSERT INTO audit_logs (action_type, entity_type, entity_id, user_id, created_at) VALUES ('ai_global_prompt_saved', 'ai_global_prompt', ${r.rows[0].id}, NULL, now())`.execute(this.db); } catch { /* best-effort */ }
    return mapPrompt(r.rows[0]);
  }
}
