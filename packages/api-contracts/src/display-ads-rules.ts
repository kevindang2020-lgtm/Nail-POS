// display-ads-rules.ts — 23-inch dual-screen spec §51–§72, §110: the ONE definition of the customer-display advertising
// rules. The server validates with these numbers, the POS editor shows and pre-checks them, and Super Admin's General
// Settings take their platform defaults from DISPLAY_AD_PLATFORM_SETTINGS — so the three can never disagree about what
// an ad may be. Realm-independent (enums and limits, like pagination bounds), browser-safe, dependency-free.

/** §69: the image formats an ad may be uploaded in. */
export const DISPLAY_AD_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type DisplayAdMimeType = typeof DISPLAY_AD_MIME_TYPES[number];

/** §54: how the creative fills the advertising panel — never distorted. smart_crop = cover around the image's own
 *  point of interest (computed when the image is uploaded) instead of a point the owner picks. */
export const DISPLAY_AD_FIT_MODES = ['cover', 'contain', 'smart_crop'] as const;
export type DisplayAdFitMode = typeof DISPLAY_AD_FIT_MODES[number];

/** §78: the QR destinations an ad may carry (the URL itself is the salon's, validated server-side). */
export const DISPLAY_AD_QR_KINDS = ['book_online', 'customer_app', 'gift_cards', 'instagram', 'membership'] as const;
export type DisplayAdQrKind = typeof DISPLAY_AD_QR_KINDS[number];
export const DISPLAY_AD_QR_LABELS: Readonly<Record<DisplayAdQrKind, string>> = {
  book_online: 'Book online', customer_app: 'Get our app', gift_cards: 'Gift cards', instagram: 'Follow us on Instagram', membership: 'Become a member',
};

export const DISPLAY_AD_RULES = {
  /** §59: how long one ad stays on screen. */
  durationSeconds: { min: 5, max: 30, default: 10 },
  priority: { min: 0, max: 100 },
  /** Characters, after whitespace is collapsed. */
  text: { name: 80, headline: 60, subheadline: 80, description: 200, ctaText: 40, qrUrl: 300 },
  /** §70: the uploaded original (oriented). */
  image: { minLongEdge: 600, minShortEdge: 300, maxEdge: 10_000, maxPixels: 50_000_000 },
  /** §71: the optimized copies the display downloads — long-edge bound and a byte cap each. */
  derivatives: {
    large: { longEdge: 1920, maxBytes: 4 * 1024 * 1024 },
    medium: { longEdge: 1080, maxBytes: 2 * 1024 * 1024 },
    thumb: { longEdge: 320, maxBytes: 300 * 1024 },
  },
  /** §55–§56: template guidance shown in the POS. The right panel is ~35% of a 16:9 screen — a 2:3 portrait. */
  recommended: { panel: { width: 1080, height: 1620 }, fullscreen: { width: 1920, height: 1080 } },
  /** §7: optional full-screen idle advertising starts after this much inactivity. */
  fullScreenIdleAfterSeconds: { min: 30, max: 120, default: 60 },
  /** The request ceiling (multipart). The platform's per-image limit below it is a Super Admin setting. */
  uploadHardMaxBytes: 25 * 1024 * 1024,
} as const;

export type DisplayAdPlatformSettingKey =
  | 'display_ads.max_ads_per_tenant' | 'display_ads.max_file_size_mb' | 'display_ads.storage_limit_mb'
  | 'display_ads.allowed_mime_types' | 'display_ads.fullscreen_idle_allowed';
export interface DisplayAdPlatformSettingDef {
  key: DisplayAdPlatformSettingKey; label: string; valueType: 'number' | 'string' | 'boolean';
  default: number | string | boolean; min?: number; max?: number;
}
/** §110 Super Admin controls. "Advertising Feature Enabled" is the platform feature registry entry
 *  'customer_display_ads' (Feature Registry, with per-plan and per-salon entitlement on top) — not a setting here.
 *  Out-of-range stored values are clamped to [min, max] when read. */
export const DISPLAY_AD_PLATFORM_SETTINGS: readonly DisplayAdPlatformSettingDef[] = [
  { key: 'display_ads.max_ads_per_tenant', label: 'Maximum Ads per Salon', valueType: 'number', default: 50, min: 1, max: 500 },
  { key: 'display_ads.max_file_size_mb', label: 'Max Image File Size (MB)', valueType: 'number', default: 8, min: 1, max: 25 },
  { key: 'display_ads.storage_limit_mb', label: 'Image Storage Limit per Salon (MB)', valueType: 'number', default: 500, min: 10, max: 10_240 },
  { key: 'display_ads.allowed_mime_types', label: 'Allowed File Types', valueType: 'string', default: 'image/jpeg,image/png,image/webp' },
  { key: 'display_ads.fullscreen_idle_allowed', label: 'Full-Screen Idle Ads Allowed', valueType: 'boolean', default: true },
];

/** The registry key of the feature (Super Admin → Feature Registry / plan features / tenant overrides). */
export const DISPLAY_ADS_FEATURE_KEY = 'customer_display_ads';
