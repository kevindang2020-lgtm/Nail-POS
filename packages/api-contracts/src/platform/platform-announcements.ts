// platform-announcements.ts (platform realm) — Super Admin › Communications › Platform Announcements (POS top bar,
// Oct 22 2026). Server: modules/communications platform-announcements (/super-admin/communications/platform-announcements).
export type PlatformAnnouncementTypeAdmin = 'info' | 'update' | 'maintenance' | 'warning' | 'urgent';
export type PlatformAnnouncementPriorityAdmin = 'low' | 'normal' | 'high' | 'critical';
export type PlatformAnnouncementAudience = 'all_tenants' | 'selected_tenants' | 'selected_branches';
/** draft / paused / archived are stored; scheduled / active / expired are derived from the window on the server clock. */
export type PlatformAnnouncementStatus = 'draft' | 'scheduled' | 'active' | 'paused' | 'expired' | 'archived';

export interface PlatformAnnouncementTarget { tenantId: string; tenantName: string | null; branchId: string | null; branchName: string | null }
export interface PlatformAnnouncementRow {
  id: string; title: string | null; message: string; type: PlatformAnnouncementTypeAdmin; priority: PlatformAnnouncementPriorityAdmin;
  audience: PlatformAnnouncementAudience; status: PlatformAnnouncementStatus; startsAt: string | null; endsAt: string | null;
  dismissible: boolean; requiresAcknowledgement: boolean; surfaces: string[]; version: number; contentVersion: number;
  targetCount: number; createdBy: string | null;
  /** §60 (Oct 27 2026): the creator's display name (a platform user), for the list's Created by column. */
  createdByName: string | null; updatedBy: string | null; publishedBy: string | null; createdAt: string; updatedAt: string;
  publishedAt: string | null; pausedAt: string | null; archivedAt: string | null; duplicatedFrom: string | null;
  /** English + Vietnamese POS mandate WP-F (§56–§57): the optional Vietnamese version, who reviewed it, or the explicit
   *  English-only decision. `vietnamese` summarises it for the list: none / draft (not reviewed) / reviewed / english_only. */
  titleVi: string | null; messageVi: string | null; englishOnly: boolean; viReviewedBy: string | null; viReviewedAt: string | null;
  vietnamese: PlatformAnnouncementVietnameseState;
  /** maintenance / warning / urgent / critical priority — needs a reviewed Vietnamese version or English only to go live */
  critical: boolean;
}
export type PlatformAnnouncementVietnameseState = 'none' | 'unreviewed' | 'reviewed' | 'english_only';
export interface PlatformAnnouncementList { items: PlatformAnnouncementRow[]; total: number; page: number; pageSize: number; serverTime: string }
export interface PlatformAnnouncementRevision { version: number; action: string; actorId: string | null; at: string; snapshot: Record<string, unknown> }
export interface PlatformAnnouncementStats { delivered: number; dismissed: number; acknowledged: number; tenantsReached: number }
export interface PlatformAnnouncementDetail extends PlatformAnnouncementRow { targets: PlatformAnnouncementTarget[]; revisions: PlatformAnnouncementRevision[]; stats: PlatformAnnouncementStats }
export interface PlatformAnnouncementWriteRequest {
  title?: string | null; message: string; type: PlatformAnnouncementTypeAdmin; priority: PlatformAnnouncementPriorityAdmin;
  audience: PlatformAnnouncementAudience; tenantIds?: string[] | null; branchIds?: string[] | null;
  startsAt?: string | null; endsAt?: string | null; dismissible: boolean; requiresAcknowledgement: boolean; expectedVersion?: number | null;
  /** WP-F: optional Vietnamese version (empty = none); `viReviewed: true` records the signed-in Super Admin as reviewer of
   *  THIS wording (any later text change clears it); `englishOnly: true` = explicitly no Vietnamese version. */
  titleVi?: string | null; messageVi?: string | null; viReviewed?: boolean | null; englishOnly?: boolean | null;
}
export interface PlatformAnnouncementPublishRequest { expectedVersion?: number | null; publishNow?: boolean | null; startsAt?: string | null; confirm?: boolean | null }
export interface PlatformAnnouncementActionRequest { expectedVersion?: number | null }
export interface PlatformAnnouncementTenantOption { id: string; name: string; code: string | null; status: string; branches: number }
export interface PlatformAnnouncementTenantPage { items: PlatformAnnouncementTenantOption[]; total: number; page: number; pageSize: number }
export interface PlatformAnnouncementBranchOption { id: string; name: string; status: string }
