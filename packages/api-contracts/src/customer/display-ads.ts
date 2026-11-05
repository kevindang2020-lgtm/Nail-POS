// display-ads.ts — what a registered customer display receives for its advertising panel (23-inch dual-screen spec
// §47, §58–§60, §72–§74, §108). Realm: customer — the display app may import only this realm (§14, §361).
// Contains ONLY what the screen renders: no ad names, statuses, schedules, targeting or anything about other branches.

export interface CustomerDisplayAdImage { url: string; width: number; height: number }

export interface CustomerDisplayAd {
  id: string;
  /** Bumps on every edit — part of the cache key for downloaded images and the rendered slide. */
  version: number;
  /** The right-panel creative (long edge ≤ 1080 px) and a larger copy (≤ 1920 px) for big or high-density screens. */
  image: CustomerDisplayAdImage;
  imageLarge: CustomerDisplayAdImage;
  /** §56: the optional landscape creative for full-screen idle mode (≤ 1920 px). */
  fullscreenImage: CustomerDisplayAdImage | null;
  /** §54: cover | contain | smart_crop (= cover around focalX/focalY, already resolved by the server). Never distorted. */
  fit: 'cover' | 'contain' | 'smart_crop';
  focalX: number; focalY: number;
  headline: string | null; subheadline: string | null; description: string | null; ctaText: string | null;
  /** §78: render as a QR code with this caption. */
  qr: { label: string; url: string } | null;
  durationSeconds: number;
}

/** Why the panel shows the salon's branded fallback instead of ads (§114). */
export type CustomerDisplayAdsOffReason = 'not_available' | 'disabled_by_salon' | 'disabled_for_branch' | 'disabled_for_display';

export interface CustomerDisplayAdPlaylist {
  enabled: boolean;
  offReason: CustomerDisplayAdsOffReason | null;
  /** In rotation order (priority, then oldest-published first). Empty → the branded fallback. */
  ads: CustomerDisplayAd[];
  /** §7: optional full-screen advertising after inactivity — off unless the salon turned it on. */
  fullScreenIdle: { enabled: boolean; afterSeconds: number };
  /** Changes whenever anything the display would render changes — an unchanged version needs no re-render. */
  playlistVersion: string;
  generatedAt: string;
  /** Ask again after this many seconds even without a realtime nudge: the next moment a schedule starts or ends. */
  refreshAfterSeconds: number;
  /**
   * §72 / §114: until when this list is right without asking again — the next moment any ad's schedule starts or ends
   * (ISO), or null when no ad has a schedule (it changes only when the salon edits it). A display that cannot reach the
   * server keeps playing its saved list until then; after it, it shows the salon's branded panel instead.
   */
  validUntil: string | null;
}

/** §108: what the display reports — that an ad was ON SCREEN, for how long. Batched; batchId makes a resend a no-op. */
export interface CustomerDisplayAdDisplayReport {
  batchId: string;
  displays: { adId: string; shownAt: string; durationMs: number }[];
}
