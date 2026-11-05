// community-comments.ts — BUILD_PLAN Phase 8 (agent C): the PURE half of threaded, versioned community comments.
// The tree a reader sees: replies nested under their parent (depth 0..3), oldest first, a removed comment kept in place
// (so the thread still reads) with its text replaced — "[removed by moderator]" when a moderator removed it, "[deleted by
// author]" when its author did. Authors are shown only by the label frozen at write time (the commenting salon's own
// choice: its name, its display name, or "A salon in <region>") — never a salon id or a user id.
import type { CommunityCommentView } from '@aipowersalon/api-contracts/tenant';

export const COMMENT_MAX_DEPTH = 3;
export const COMMENT_MAX_LENGTH = 4000;
export const REMOVED_BY_MODERATOR = '[removed by moderator]';
export const DELETED_BY_AUTHOR = '[deleted by author]';
/** removed_reason the author's own delete writes (anything else is a moderator removal). */
export const AUTHOR_DELETE_REASON = 'deleted_by_author';

export interface CommentRecord {
  id: string; postId: string; parentId: string | null; depth: number; tenantId: string; createdByUserId: string;
  visibility: 'community_published' | 'removed'; body: string; authorLabel: string | null; version: number;
  editedAt: string | null; removedReason: string | null; createdAt: string;
}

const ANON = /^A salon( in .+)?$/;

/** One comment as a reader sees it. Own salon / own user are derived, never exposed as ids. */
export function commentView(c: CommentRecord, viewer: { tenantId: string; userId: string }): Omit<CommunityCommentView, 'replies'> {
  const removed = c.visibility === 'removed';
  const label = c.authorLabel || 'A salon';
  return {
    id: c.id, postId: c.postId, parentId: c.parentId, depth: c.depth,
    body: removed ? (c.removedReason === AUTHOR_DELETE_REASON ? DELETED_BY_AUTHOR : REMOVED_BY_MODERATOR) : c.body,
    author: { label, isOwnSalon: c.tenantId === viewer.tenantId, anonymous: ANON.test(label) },
    mine: !removed && c.createdByUserId === viewer.userId && c.tenantId === viewer.tenantId,
    edited: !!c.editedAt && !removed, removed, version: c.version, createdAt: c.createdAt,
  };
}

/** Rows (any order) → the thread. Orphans (a parent outside the set) surface at the top level, never dropped. */
export function buildCommentTree(rows: CommentRecord[], viewer: { tenantId: string; userId: string }): CommunityCommentView[] {
  const sorted = [...rows].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
  const byId = new Map<string, CommunityCommentView>();
  for (const r of sorted) byId.set(r.id, { ...commentView(r, viewer), replies: [] });
  const roots: CommunityCommentView[] = [];
  for (const r of sorted) {
    const node = byId.get(r.id)!;
    const parent = r.parentId ? byId.get(r.parentId) : undefined;
    if (parent && parent !== node) parent.replies.push(node); else roots.push(node);
  }
  return roots;
}

/** Depth for a reply under `parent` (null = top level); null when the thread is already as deep as allowed. */
export function replyDepth(parent: { depth: number } | null): number | null {
  if (!parent) return 0;
  const d = parent.depth + 1;
  return d > COMMENT_MAX_DEPTH ? null : d;
}
