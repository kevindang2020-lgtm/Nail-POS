import { defineStateMachine } from '@aipowersalon/database';
// pos-social.dto.ts — social content planner. A salon drafts/schedules/tracks posts as a content calendar.
// PLANNING ONLY — no platform publishing. KPI + validation logic is pure so it is unit-testable.

export interface SocialContext {
  tenantId: string;
  branchId?: string;
  userId: string;
  role: string;
  permissions: string[];
}

export type SocialPlatform = 'instagram' | 'facebook' | 'tiktok' | 'other';
export const SOCIAL_PLATFORMS: SocialPlatform[] = ['instagram', 'facebook', 'tiktok', 'other'];
export type SocialStatus = 'draft' | 'scheduled' | 'posted' | 'archived';
export const SOCIAL_STATUSES: SocialStatus[] = ['draft', 'scheduled', 'posted', 'archived'];

export interface SocialPost {
  id: string;
  platform: SocialPlatform;
  caption: string;
  scheduledAt: string | null;
  status: SocialStatus;
  postedAt: string | null;
  createdAt: string;
}

export interface SocialKpis {
  drafts: number;
  scheduled: number;
  posted: number;
  total: number;
}

export interface SocialState {
  kpis: SocialKpis;
  posts: SocialPost[];
}

export interface CreateSocialPostInput {
  platform: SocialPlatform;
  caption: string;
  scheduledAt?: string | null;
}

// Pure: header KPIs (archived excluded from the "total" active count).
export function buildSocialKpis(posts: SocialPost[]): SocialKpis {
  return {
    drafts: posts.filter((p) => p.status === 'draft').length,
    scheduled: posts.filter((p) => p.status === 'scheduled').length,
    posted: posts.filter((p) => p.status === 'posted').length,
    total: posts.filter((p) => p.status !== 'archived').length,
  };
}

// Pure: validate a create request.
export function validateCreateSocialPost(input: CreateSocialPostInput): { ok: boolean; error?: string } {
  if (!input?.caption || !String(input.caption).trim()) return { ok: false, error: 'A caption is required' };
  if (!input?.platform || !SOCIAL_PLATFORMS.includes(input.platform)) return { ok: false, error: 'Choose a valid platform' };
  return { ok: true };
}

// Pure: allowed status transitions (draft <-> scheduled -> posted; anything -> archived).
export function canTransition(from: SocialStatus, to: SocialStatus): boolean {
  if (!SOCIAL_STATUSES.includes(to)) return false;
  if (to === 'archived') return true;
  const allowed: Record<SocialStatus, SocialStatus[]> = {
    draft: ['scheduled', 'posted'],
    scheduled: ['draft', 'posted'],
    posted: ['archived'],
    archived: [],
  };
  return (allowed[from] || []).includes(to);
}

/** BUILD_PLAN Phase 12 (#27): social_posts.status as ONE state machine — exactly canTransition above (draft ⇄ scheduled →
 *  posted; anything → archived). The repository's UPDATE is conditional on the state the service read. */
export const SOCIAL_POST = defineStateMachine({
  name: 'social_post', table: 'social_posts', column: 'status',
  states: ['draft', 'scheduled', 'posted', 'archived'],
  transitions: { draft: ['scheduled', 'posted', 'archived'], scheduled: ['draft', 'posted', 'archived'], posted: ['archived'], archived: ['archived'] },
  initial: ['draft', 'scheduled'],
});
