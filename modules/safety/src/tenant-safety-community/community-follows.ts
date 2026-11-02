// community-follows.ts — BUILD_PLAN Phase 8 (agent C): what a salon follows (a category, a region, a minimum severity,
// the channels it wants) and whether a published advisory matches. PURE. Follows are SALON-WIDE (the table's unique key is
// tenant + category + region); the user who created one is recorded, not shown. Post follows ("follow this advisory")
// are per USER and live in community_post_follows.
import { COMMUNITY_CATEGORIES, type CommunityFollowInput, type CommunitySeverity } from '@aipowersalon/api-contracts/tenant';

export const SEVERITIES: readonly CommunitySeverity[] = ['informational', 'low', 'moderate', 'high', 'critical'];
export const SEV_RANK: Record<string, number> = { informational: 0, low: 1, moderate: 2, high: 3, critical: 4 };
export const FOLLOW_CHANNELS = ['in_app', 'push', 'email', 'sms'] as const;
export type FollowChannel = typeof FOLLOW_CHANNELS[number];

export interface FollowRecord { id: string; category: string | null; region: string | null; severityMin: string | null; channels: FollowChannel[] }

export type Invalid = { field: string; message: string };

/** Validate + normalise a follow. Returns the clean row or the first invalid field. */
export function normalizeFollow(input: CommunityFollowInput | null | undefined): { ok: true; value: Omit<FollowRecord, 'id'> } | { ok: false; invalid: Invalid } {
  const b: any = input ?? {};
  const category = b.category == null || b.category === '' ? null : String(b.category);
  if (category !== null && !(COMMUNITY_CATEGORIES as readonly string[]).includes(category)) return { ok: false, invalid: { field: 'category', message: 'unknown category' } };
  const region = b.region == null || String(b.region).trim() === '' ? null : String(b.region).trim().slice(0, 80);
  const severityMin = b.severityMin == null || b.severityMin === '' ? null : String(b.severityMin);
  if (severityMin !== null && !(severityMin in SEV_RANK)) return { ok: false, invalid: { field: 'severityMin', message: 'unknown severity' } };
  const raw = b.channels == null ? ['in_app'] : b.channels;
  if (!Array.isArray(raw) || raw.some((c: unknown) => !(FOLLOW_CHANNELS as readonly string[]).includes(String(c)))) return { ok: false, invalid: { field: 'channels', message: 'channels must be in_app | push | email | sms' } };
  const channels = [...new Set(raw.map(String))] as FollowChannel[];
  if (!channels.length) return { ok: false, invalid: { field: 'channels', message: 'at least one channel' } };
  if (category === null && region === null && severityMin === null) return { ok: false, invalid: { field: 'category', message: 'follow a category, a region or a minimum severity' } };
  return { ok: true, value: { category, region, severityMin, channels } };
}

/** Does this follow match the advisory? A null field matches anything; regions compare case-insensitively. */
export function followMatches(f: Pick<FollowRecord, 'category' | 'region' | 'severityMin'>, post: { category: string; region: string | null; severity: string }): boolean {
  if (f.category && f.category !== post.category) return false;
  if (f.region && (!post.region || f.region.toLowerCase() !== post.region.toLowerCase())) return false;
  if (f.severityMin && (SEV_RANK[post.severity] ?? 0) < (SEV_RANK[f.severityMin] ?? 0)) return false;
  return true;
}
