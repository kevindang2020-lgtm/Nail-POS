// ai-business-admin.repository.ts — platform-level ADOPTION aggregates for Super Admin (§40). These are counts across
// the saved-questions and alerts tables — approved aggregate data, never a tenant private drilldown (§39). Model
// usage/tokens/cost for ai_business already flow into the existing Super Admin AI Usage panel via ai_usage_logs
// (GROUP BY package_code), so this deliberately covers only the pieces that do NOT go through the usage logger.
export interface AiBusinessAdminOverview {
  savedQuestions: { total: number; tenants: number; byIntent: { intent: string; count: number }[] };
  alerts: { total: number; active: number; tenants: number; byMetric: { metricId: string; count: number }[] };
}

export interface AiBusinessAdminRepositoryPort {
  overview(): Promise<AiBusinessAdminOverview>;
}

/** In-memory fallback (DB-less deploy / tests): reports zero adoption rather than fabricating platform numbers. */
export class InMemoryAiBusinessAdminRepository implements AiBusinessAdminRepositoryPort {
  async overview(): Promise<AiBusinessAdminOverview> {
    return { savedQuestions: { total: 0, tenants: 0, byIntent: [] }, alerts: { total: 0, active: 0, tenants: 0, byMetric: [] } };
  }
}
