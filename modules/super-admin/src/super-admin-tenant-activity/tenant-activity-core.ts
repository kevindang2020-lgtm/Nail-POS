// tenant-activity-core.ts — pure read-model over audit_logs for the faceted Tenant Activity page.
// No new table: every row is an audit_logs entry, formatted with a category + icon + severity for the dashboard.
// All logic here is pure + unit-tested; the kysely/in-memory adapters only fetch raw rows.
import { activityPresentation } from '../super-admin-overview/overview-core';

export type ActivitySeverity = 'info' | 'success' | 'warning' | 'error';
export type ActivityCategory = 'tenant' | 'payment' | 'hardware' | 'ai' | 'application' | 'support' | 'other';

/** Raw audit_logs row (joined to tenants), as the adapters return it. */
export interface ActivityRaw {
  id: string;
  actionType: string;
  entityType: string | null;
  entityId: string | null;
  tenantId: string | null;
  tenantName: string | null;
  salonCode: string | null;
  actorUserId: string | null;
  actorRole: string | null;
  createdAt: string; // ISO
}

/** Formatted, dashboard-friendly activity item. */
export interface ActivityItem {
  id: string;
  eventType: string;
  category: ActivityCategory;
  icon: string;
  title: string;
  tenantId: string | null;
  tenantName: string | null;
  salonCode: string | null;
  description: string;
  severity: ActivitySeverity;
  actorUserId: string | null;
  actorRole: string | null;
  relatedRecordId: string | null;
  createdAt: string;
  ageLabel: string;
}

export interface ActivityQuery {
  search?: string;
  tenantId?: string;
  eventType?: string;
  severity?: ActivitySeverity;
  category?: ActivityCategory;
  from?: string;
  to?: string;
  page: number;
  limit: number;
  sortDirection?: 'asc' | 'desc';
}

export interface ActivitySummary {
  total: number;
  tenant: number;
  payment: number;
  hardware: number;
  ai: number;
  warningError: number;
}

export interface ActivityPage {
  items: ActivityItem[];
  total: number;
  page: number;
  limit: number;
  pageCount: number;
}

export function severityFor(action: string): ActivitySeverity {
  const a = (action || '').toLowerCase();
  if (/fail|error|declin/.test(a)) return 'error';
  if (/complete|success|activ|approv|connect|deliver|install/.test(a)) return 'success';
  if (/pending|warn|shortfall|pause|suspend|retry|limit/.test(a)) return 'warning';
  return 'info';
}

export function categoryFor(action: string): ActivityCategory {
  const a = (action || '').toLowerCase();
  if (/payment|gateway|billing|cardpointe/.test(a)) return 'payment';
  if (/hardware/.test(a)) return 'hardware';
  if (/ai_|receptionist/.test(a)) return 'ai';
  if (/application|lead/.test(a)) return 'application';
  if (/support|warning_sent/.test(a)) return 'support';
  if (/tenant|onboard|salon/.test(a)) return 'tenant';
  return 'other';
}

export function ageLabel(d: string | Date | null): string {
  if (!d) return '';
  const t = typeof d === 'string' ? Date.parse(d) : d.getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return days < 7 ? `${days}d ago` : new Date(t).toLocaleDateString();
}

export function toActivity(r: ActivityRaw): ActivityItem {
  const action = r.actionType || 'event';
  const p = activityPresentation(action);
  return {
    id: r.id,
    eventType: action,
    category: categoryFor(action),
    icon: p.icon,
    title: p.title,
    tenantId: r.tenantId,
    tenantName: r.tenantName,
    salonCode: r.salonCode,
    description: (r.entityType || '').replace(/_/g, ' '),
    severity: severityFor(action),
    actorUserId: r.actorUserId,
    actorRole: r.actorRole,
    relatedRecordId: r.entityId,
    createdAt: r.createdAt,
    ageLabel: ageLabel(r.createdAt),
  };
}

export function applyFilters(items: ActivityItem[], q: ActivityQuery): ActivityItem[] {
  let out = items;
  if (q.tenantId) out = out.filter((i) => i.tenantId === q.tenantId);
  if (q.category) out = out.filter((i) => i.category === q.category);
  if (q.severity) out = out.filter((i) => i.severity === q.severity);
  if (q.eventType) { const e = q.eventType.toLowerCase(); out = out.filter((i) => i.eventType.toLowerCase().includes(e)); }
  if (q.from) { const f = new Date(q.from).getTime(); if (Number.isFinite(f)) out = out.filter((i) => Date.parse(i.createdAt) >= f); }
  if (q.to) { const t = new Date(q.to).getTime(); if (Number.isFinite(t)) { const end = t + 86_399_999; out = out.filter((i) => Date.parse(i.createdAt) <= end); } }
  if (q.search) {
    const s = q.search.toLowerCase();
    out = out.filter((i) => [i.title, i.tenantName, i.salonCode, i.eventType, i.description, i.actorUserId].some((v) => (v || '').toLowerCase().includes(s)));
  }
  const dir = q.sortDirection === 'asc' ? 1 : -1;
  return [...out].sort((a, b) => (Date.parse(a.createdAt) - Date.parse(b.createdAt)) * dir);
}

export function paginate(items: ActivityItem[], page: number, limit: number): ActivityPage {
  const total = items.length;
  const ps = Math.min(100, Math.max(1, limit || 25));
  const p = Math.max(1, page || 1);
  const start = (p - 1) * ps;
  return { items: items.slice(start, start + ps), total, page: p, limit: ps, pageCount: Math.max(1, Math.ceil(total / ps)) };
}

export function summarize(items: ActivityItem[]): ActivitySummary {
  return {
    total: items.length,
    tenant: items.filter((i) => i.category === 'tenant').length,
    payment: items.filter((i) => i.category === 'payment').length,
    hardware: items.filter((i) => i.category === 'hardware').length,
    ai: items.filter((i) => i.category === 'ai').length,
    warningError: items.filter((i) => i.severity === 'warning' || i.severity === 'error').length,
  };
}
