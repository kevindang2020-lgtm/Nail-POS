import { formatCentsOrDash as formatCents } from '@aipowersalon/money';
export { formatCents };   // owned by @aipowersalon/money (Constitution 13 §86) — en-US grouping now explicit (was the process locale)
// communications-overview-core.ts — pure, framework-free shaping for Super Admin → Business Management →
// Communications (platform messaging oversight). No I/O; deterministic + unit-tested. Money is integer cents.
// Values are real or honestly marked unavailable — nothing is fabricated.

// Semantic (the good / warn / bad / neutral tone of a KPI): ONE definition, the platform contract's (Constitution 13 §15)
// — this module had its own copy (four modules did, one of them without 'warn').
export type { Semantic } from '@aipowersalon/api-contracts/platform';
import type { Semantic } from '@aipowersalon/api-contracts/platform';

// ---------- channels (the 7 communication types) ----------
export const CHANNELS = ['sms', 'email', 'push', 'in_app', 'system_alert', 'tenant_notice', 'support'] as const;
export type ChannelBucket = (typeof CHANNELS)[number] | 'other';
export const CHANNEL_LABEL: Record<string, string> = {
  sms: 'SMS', email: 'Email', push: 'Push Notifications', in_app: 'In-App Announcements',
  system_alert: 'System Alerts', tenant_notice: 'Tenant Notices', support: 'Support Messages', other: 'Other',
};

export function channelBucket(raw: string | null | undefined): ChannelBucket {
  const c = (raw || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (c === 'sms' || c === 'text') return 'sms';
  if (c === 'email' || c === 'mail') return 'email';
  if (c === 'push' || c === 'fcm' || c === 'push_notification') return 'push';
  if (c === 'in_app' || c === 'in_app_announcement' || c === 'announcement') return 'in_app';
  if (c === 'system_alert' || c === 'system' || c === 'alert') return 'system_alert';
  if (c === 'tenant_notice' || c === 'tenant') return 'tenant_notice';
  if (c === 'support' || c === 'support_message') return 'support';
  return 'other';
}

// Platform announcements target tenant STAFF/ADMIN users — never customers. This is the platform-vs-customer boundary:
// 'CUSTOMER' must never appear in an announcement's recipient roles.
export const TENANT_USER_ROLES = ['OWNER', 'MANAGER', 'RECEPTION', 'TECHNICIAN'] as const;
export function isTenantUserRole(role: string): boolean { return (TENANT_USER_ROLES as readonly string[]).includes(role); }

// ---------- delivery status ----------
export function deliveryStatus(raw: string | null | undefined): { key: string; label: string; semantic: Semantic } {
  switch ((raw || '').toLowerCase()) {
    case 'delivered': return { key: 'delivered', label: 'Delivered', semantic: 'good' };
    case 'sent': return { key: 'sent', label: 'Sent', semantic: 'neutral' };
    case 'failed': case 'error': case 'undelivered': return { key: 'failed', label: 'Failed', semantic: 'bad' };
    case 'suppressed': case 'blocked': return { key: 'suppressed', label: 'Suppressed', semantic: 'warn' };
    case 'queued': case 'pending': case 'scheduled': return { key: 'queued', label: 'Queued', semantic: 'neutral' };
    default: return { key: 'sent', label: 'Sent', semantic: 'neutral' };
  }
}
// A message counts as "delivered attempt succeeded" for rate math when delivered; "failed" when failed.
export const isDelivered = (s: string | null | undefined): boolean => deliveryStatus(s).key === 'delivered';
export const isFailed = (s: string | null | undefined): boolean => deliveryStatus(s).key === 'failed';
export const isSuppressed = (s: string | null | undefined): boolean => deliveryStatus(s).key === 'suppressed';

// ---------- provider health ----------
// Health from the delivered vs failed mix: <2% failure = healthy, <10% = degraded, otherwise down.
export function providerHealth(delivered: number, failed: number): { key: string; label: string; semantic: Semantic } {
  const total = delivered + failed;
  if (total === 0) return { key: 'healthy', label: 'Healthy', semantic: 'good' };
  const failRate = failed / total;
  if (failRate < 0.02) return { key: 'healthy', label: 'Healthy', semantic: 'good' };
  if (failRate < 0.10) return { key: 'degraded', label: 'Degraded', semantic: 'warn' };
  return { key: 'down', label: 'Down', semantic: 'bad' };
}

// ---------- math ----------
export const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
export function deliveryRate(delivered: number, sentTotal: number): number { return pct(delivered, sentTotal); }

export function distribution<T extends { key: string; label: string; count: number }>(rows: T[], total: number): (T & { pct: number })[] {
  return rows.map((r) => ({ ...r, pct: pct(r.count, total) }));
}

// Some KPIs are "bad when up" (failed, suppressed, opt-outs, system alerts).
export function kpiTrendSemantic(key: string, direction: 'up' | 'down' | 'flat'): Semantic {
  const upIsBad = ['failed', 'suppressed', 'opt_outs', 'system_alerts'].includes(key);
  if (direction === 'flat') return 'neutral';
  const up = direction === 'up';
  return upIsBad ? (up ? 'bad' : 'good') : (up ? 'good' : 'bad');
}

export function trendDelta(current: number, prior: number): { deltaPct: number; direction: 'up' | 'down' | 'flat' } {
  if (prior === 0) return { deltaPct: current > 0 ? 100 : 0, direction: current > 0 ? 'up' : 'flat' };
  const d = Math.round(((current - prior) / prior) * 1000) / 10;
  return { deltaPct: d, direction: d > 0 ? 'up' : d < 0 ? 'down' : 'flat' };
}
