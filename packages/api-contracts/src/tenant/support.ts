// support.ts — wire contract (Constitution 13 §13, §15). Realm: tenant.

export type HelpArticleSummary = {
  id: string; slug: string; title: string; summary: string | null;
  categorySlug: string | null; categoryLabel: string | null;
  viewCount: number; readingMinutes: number; lastUpdatedAt: string | null;
};
export type StatusComponent = { key: string; name: string; status: string; lastCheckedAt: string | null };
export type StatusIncident = { id: string; title: string; status: string; impact: string; startedAt: string | null; resolvedAt: string | null };

/** GET /tenant/help/status — the platform status the help center shows (overall + components + incidents). */
export interface HelpSystemStatus { overall: { status: string; label: string; healthy: boolean }; components: StatusComponent[]; incidents: StatusIncident[] }
