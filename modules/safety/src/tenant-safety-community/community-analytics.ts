// community-analytics.ts — BUILD_PLAN Phase 8 (agent C): a salon's own Safety Community numbers (its advisories, the
// comments / "this happened to us too" reports / followers they drew, time to publish, top categories). PURE: the range
// parser and the response shape. Only the salon's OWN posts are counted — never another salon's activity.
import type { CommunityCategory, CommunityTenantAnalytics } from '@aipowersalon/api-contracts/tenant';
import { utcDate, addDays } from '@aipowersalon/date-time';
import { planFanout, type FanoutRecipient } from './community-notify';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const ANALYTICS_MAX_DAYS = 366;
export const ANALYTICS_DEFAULT_DAYS = 30;

const validYmd = (s: string) => { if (!YMD.test(s)) return false; const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && utcDate(d) === s; };
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** from / to are inclusive UTC days (YYYY-MM-DD). Default: the last 30 days ending today. The SQL bound is [from, to+1). */
export function parseAnalyticsRange(q: { from?: unknown; to?: unknown }, now = new Date()):
  { ok: true; from: string; to: string; fromTs: string; toExclusiveTs: string } | { ok: false; field: string; message: string } {
  const to = q.to == null || q.to === '' ? utcDate(now) : String(q.to);
  if (!validYmd(to)) return { ok: false, field: 'to', message: 'YYYY-MM-DD' };
  const from = q.from == null || q.from === '' ? addDays(to, -(ANALYTICS_DEFAULT_DAYS - 1)) : String(q.from);
  if (!validYmd(from)) return { ok: false, field: 'from', message: 'YYYY-MM-DD' };
  const span = dayDiff(from, to);
  if (span < 0) return { ok: false, field: 'from', message: 'from must not be after to' };
  if (span + 1 > ANALYTICS_MAX_DAYS) return { ok: false, field: 'from', message: `at most ${ANALYTICS_MAX_DAYS} days` };
  return { ok: true, from, to, fromTs: `${from}T00:00:00Z`, toExclusiveTs: `${addDays(to, 1)}T00:00:00Z` };
}

export interface AnalyticsRaw {
  byStatus: { status: string; n: number }[]; published: number; avgHoursToPublish: number | null;
  comments: number; similar: number; followers: number; categories: { category: string; n: number }[];
}

export function shapeAnalytics(from: string, to: string, r: AnalyticsRaw): CommunityTenantAnalytics {
  const posts: Record<string, number> = {};
  for (const s of r.byStatus) posts[s.status] = (posts[s.status] ?? 0) + Number(s.n || 0);
  return {
    from, to, posts,
    published: Number(r.published || 0), comments: Number(r.comments || 0), similarReports: Number(r.similar || 0), followers: Number(r.followers || 0),
    avgHoursToPublish: r.avgHoursToPublish == null || !Number.isFinite(Number(r.avgHoursToPublish)) ? null : Math.round(Number(r.avgHoursToPublish) * 10) / 10,
    topCategories: [...r.categories].sort((a, b) => Number(b.n) - Number(a.n) || a.category.localeCompare(b.category)).slice(0, 5)
      .map((c) => ({ category: c.category as CommunityCategory, count: Number(c.n) })),
  };
}

// ── extras Safety Community 07: Region Alert Preferences Preview ─────────────────────────────────────────────────────
// What THIS salon's saved alert preferences would have brought it over the same range: every advisory another salon
// published (still published) is run through the fan-out's own plan (planFanout — the one rule, never a second copy) with
// this salon as the only recipient. Only counts leave — by reason, channel, severity and category; never a title, body,
// id or author, so no source case is exposed. Read-only: nothing is sent and nothing is stored.
export const ALERT_PREVIEW_MAX_POSTS = 2000;
export interface AlertPreviewSummary {
  /** false = the community is off for this salon (or never set up): it would receive nothing */
  communityEnabled: boolean;
  considered: number; wouldReceive: number; truncated: boolean;
  byReason: { critical: number; follow: number; category: number; default: number };
  channels: { inApp: number; push: number; email: number; sms: number };
  bySeverity: { severity: string; count: number }[];
  byCategory: { category: string; count: number }[];
}
export function previewAlerts(
  posts: { originTenantId: string; category: string; region: string | null; severity: string }[],
  me: FanoutRecipient | null,
  limit = ALERT_PREVIEW_MAX_POSTS,
): AlertPreviewSummary {
  const out: AlertPreviewSummary = {
    communityEnabled: !!me?.communityEnabled, considered: Math.min(posts.length, limit), wouldReceive: 0, truncated: posts.length >= limit,
    byReason: { critical: 0, follow: 0, category: 0, default: 0 }, channels: { inApp: 0, push: 0, email: 0, sms: 0 }, bySeverity: [], byCategory: [],
  };
  if (!me) return out;
  const sev = new Map<string, number>(); const cat = new Map<string, number>();
  for (const p of posts.slice(0, limit)) {
    const hit = planFanout(p, [me])[0];
    if (!hit) continue;
    out.wouldReceive++; out.byReason[hit.reason]++;
    out.channels.inApp++;
    if (hit.push) out.channels.push++;
    if (hit.email) out.channels.email++;
    if (hit.sms) out.channels.sms++;
    sev.set(p.severity, (sev.get(p.severity) ?? 0) + 1); cat.set(p.category, (cat.get(p.category) ?? 0) + 1);
  }
  const RANK: Record<string, number> = { critical: 0, high: 1, moderate: 2, low: 3, informational: 4 };
  out.bySeverity = [...sev].map(([severity, count]) => ({ severity, count })).sort((a, b) => (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9));
  out.byCategory = [...cat].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  return out;
}
