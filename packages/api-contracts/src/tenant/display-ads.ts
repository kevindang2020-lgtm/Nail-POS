// display-ads.ts — POS → Marketing & Growth → Customer Display Advertising, as it appears on the wire (23-inch dual-screen
// spec §48–§78, §108–§111). Realm: tenant. The display's own view of the same ads is the customer-realm
// CustomerDisplayAdPlaylist (customer/display-ads.ts) — a strict subset with no names, statuses or targeting.
import type { DisplayAdFitMode, DisplayAdQrKind } from '../display-ads-rules';

/** §64 — derived from the stored status and the clock, in the salon's time zone. */
export type DisplayAdStatus = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'ARCHIVED';
export type DisplayAdStoredStatus = 'draft' | 'published' | 'paused' | 'archived';
export type DisplayAdAction = 'publish' | 'pause' | 'archive' | 'restore';

export interface DisplayAdImageRef { url: string; width: number; height: number }
export interface DisplayAdMediaView {
  id: string; mimeType: string; width: number; height: number; bytes: number; totalBytes: number;
  thumb: DisplayAdImageRef; medium: DisplayAdImageRef; large: DisplayAdImageRef;
  /** smart_crop's point of interest, 0–1 from the left/top. */
  suggestedFocalX: number; suggestedFocalY: number;
  createdAt: string;
}

export interface DisplayAdView {
  id: string; version: number; name: string;
  status: DisplayAdStatus; storedStatus: DisplayAdStoredStatus;
  /** On the display right now (published, in its dates, on today's weekday, inside its daily hours). */
  showingNow: boolean;
  media: DisplayAdMediaView | null; fullscreenMedia: DisplayAdMediaView | null;
  headline: string | null; subheadline: string | null; description: string | null; ctaText: string | null;
  qr: { kind: DisplayAdQrKind; url: string } | null;
  fitMode: DisplayAdFitMode; focalX: number; focalY: number;
  /** Salon calendar dates 'YYYY-MM-DD' (inclusive); null = open-ended. */
  startDate: string | null; endDate: string | null;
  /** 0 = Sunday … 6 = Saturday; null = every day. */
  daysOfWeek: number[] | null;
  /** 'HH:MM' wall clock in the branch's time zone; both or neither. */
  dailyStartTime: string | null; dailyEndTime: string | null;
  /** null = the salon's default duration. */
  displayDurationSeconds: number | null; effectiveDurationSeconds: number;
  priority: number;
  allBranches: boolean; branchIds: string[];
  /** The signed-in user may edit / publish / pause / archive this ad (owners: any; branch managers: their branch only). */
  canManage: boolean;
  publishedAt: string | null; pausedAt: string | null; archivedAt: string | null; createdAt: string; updatedAt: string;
}

/** Create = every field optional except name; update = the fields to change plus expectedVersion. */
export interface DisplayAdInput {
  name?: string; mediaId?: string | null; fullscreenMediaId?: string | null;
  headline?: string | null; subheadline?: string | null; description?: string | null; ctaText?: string | null;
  qr?: { kind: DisplayAdQrKind; url: string } | null;
  fitMode?: DisplayAdFitMode; focalX?: number; focalY?: number;
  startDate?: string | null; endDate?: string | null; daysOfWeek?: number[] | null;
  dailyStartTime?: string | null; dailyEndTime?: string | null;
  displayDurationSeconds?: number | null; priority?: number;
  allBranches?: boolean; branchIds?: string[];
}
export interface DisplayAdUpdateInput extends DisplayAdInput { expectedVersion: number }

export interface DisplayAdsTenantSettings {
  enabled: boolean; defaultDurationSeconds: number; fullScreenIdleAdsEnabled: boolean; fullScreenIdleAfterSeconds: number;
}
/** A branch can only switch things OFF for itself (false); null follows the salon. */
export interface DisplayAdsBranchOverride { enabled: boolean | null; fullScreenIdleAdsEnabled: boolean | null }
/** PATCH …/settings (salon-wide, owner) or PATCH …/branches/:branchId/settings (one branch: enabled and
 *  fullScreenIdleAdsEnabled only, each false = off for this branch or null = follow the salon). The branch is a PATH
 *  parameter: the API strips tenantId/branchId from every request body and query string (the session decides them). */
export interface DisplayAdsSettingsInput {
  enabled?: boolean | null; defaultDurationSeconds?: number; fullScreenIdleAdsEnabled?: boolean | null; fullScreenIdleAfterSeconds?: number;
}

/** §111 Platform Availability → Tenant Plan: why the feature is (not) usable. */
export interface DisplayAdsAvailability { active: boolean; reason: string | null; detail: string | null }
export interface DisplayAdsLimits {
  maxAds: number; maxFileBytes: number; storageLimitBytes: number; allowedMimeTypes: string[]; fullScreenIdleAllowed: boolean;
}
export interface DisplayAdsDevice {
  id: string; name: string; branchId: string | null; adsEnabled: boolean; lastSeenAt: string | null; lastAdShownAt: string | null;
}
export interface DisplayAdsBranch { id: string; name: string; timeZone: string }

export interface DisplayAdsState {
  /** The salon's own name — the preview's check-in header and the branded fallback panel (§13, §114). */
  salonName: string;
  availability: DisplayAdsAvailability;
  limits: DisplayAdsLimits;
  usage: { adCount: number; storageBytes: number };
  canManageAllBranches: boolean;
  /** Branches this user may target and configure (owners: all; branch managers: their own). */
  authorizedBranchIds: string[];
  branches: DisplayAdsBranch[];
  settings: { tenant: DisplayAdsTenantSettings; branches: Record<string, DisplayAdsBranchOverride>; canEditTenant: boolean };
  ads: DisplayAdView[];
  devices: DisplayAdsDevice[];
  /** The time zone statuses were evaluated in (the signed-in branch's). */
  timeZone: string;
  now: string;
}

export interface DisplayAdsAnalytics {
  days: number; since: string; branchId: string | null;
  totals: {
    active: number; scheduled: number; expired: number; paused: number; drafts: number;
    /** Times an ad was put on screen — not views (§108). */
    displayCount: number; displaySeconds: number;
    devicesShowingNow: number; displaysRegistered: number;
  };
  byAd: { adId: string; name: string; displayCount: number; displaySeconds: number; lastShownAt: string | null }[];
  byBranch: { branchId: string; name: string; displayCount: number; displaySeconds: number; displays: number; devicesShowingNow: number }[];
}
