// tech-profile-core.ts — pure, fully unit-tested core for the technician profile system (tech-profile spec set).
// Slug generation, external-link safety, doc-exact profile completion weights, the balanced discovery ranking
// (a single 5★ review must NOT outrank 300 reviews at 4.8), and rating-average math.

// ── External links (all docs: http/https only, never javascript:, sanitized) ─────────────────────────
export const ALLOWED_LINK_KEYS = ['linkme', 'linktree', 'instagram', 'tiktok', 'facebook', 'youtube', 'pinterest', 'website'] as const;
export type LinkKey = typeof ALLOWED_LINK_KEYS[number];

// Per-platform allowed hosts. A link LABELED as a platform must actually point there — this stops a technician (or an
// attacker who compromised a session) from hiding a phishing URL behind the "Instagram" icon. Aggregators and personal
// sites (linkme/linktree/website) accept any valid https host by design.
const LINK_HOST_POLICY: Record<string, string[] | null> = {
  instagram: ['instagram.com'],
  tiktok: ['tiktok.com'],
  facebook: ['facebook.com', 'fb.com', 'fb.me'],
  youtube: ['youtube.com', 'youtu.be'],
  pinterest: ['pinterest.com', 'pin.it'],
  linktree: null, linkme: null, website: null,
};

/** hostname is exactly `allowed` or a subdomain of it (never a suffix trick like `evil-instagram.com`). */
function hostAllowed(hostname: string, allowed: string[] | null): boolean {
  if (allowed == null) return true;
  const h = hostname.toLowerCase().replace(/^www\./, '');
  return allowed.some((a) => h === a || h.endsWith('.' + a));
}

export function validateExternalUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v || v.length > 500) return null;
  let u: URL;
  try { u = new URL(v); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;   // kills javascript:, data:, file:, etc.
  if (!u.hostname || !u.hostname.includes('.')) return null;
  return u.toString();
}

export function sanitizeProfileLinks(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== 'object') return out;
  for (const key of ALLOWED_LINK_KEYS) {
    const ok = validateExternalUrl((input as any)[key]);
    if (!ok) continue;
    // Enforce the platform's host policy so the labeled icon can't point somewhere else.
    let host = ''; try { host = new URL(ok).hostname; } catch { continue; }
    if (!hostAllowed(host, LINK_HOST_POLICY[key] ?? null)) continue;
    out[key] = ok;
  }
  return out;
}

// ── Per-link visibility (epic Req §3): public to everyone · only to booked customers · hidden ───────────────
export const LINK_VISIBILITIES = ['public', 'booked_only', 'hidden'] as const;
export type LinkVisibility = typeof LINK_VISIBILITIES[number];
export const DEFAULT_LINK_VISIBILITY: LinkVisibility = 'public'; // missing key ⇒ public (preserves pre-§3 behavior)

export function sanitizeLinkVisibility(input: unknown): Record<string, LinkVisibility> {
  const out: Record<string, LinkVisibility> = {};
  if (!input || typeof input !== 'object') return out;
  for (const key of ALLOWED_LINK_KEYS) {
    const v = (input as any)[key];
    if (v === 'public' || v === 'booked_only' || v === 'hidden') out[key] = v;
  }
  return out;
}

/**
 * Filter a links map to what a given viewer may see.
 *   owner  → the technician themselves / their own preview: sees every link regardless of visibility.
 *   booked → a customer who has a booking with this technician: sees public + booked_only.
 *   public → anonymous / non-booked viewer: sees public only.
 * A link with no explicit visibility defaults to DEFAULT_LINK_VISIBILITY.
 */
export function visibleLinksFor(
  links: Record<string, string>,
  visibility: Record<string, LinkVisibility>,
  viewer: 'owner' | 'booked' | 'public',
): Record<string, string> {
  if (viewer === 'owner') return { ...links };
  const out: Record<string, string> = {};
  for (const [k, url] of Object.entries(links)) {
    const vis = visibility[k] ?? DEFAULT_LINK_VISIBILITY;
    if (vis === 'hidden') continue;
    if (vis === 'booked_only' && viewer !== 'booked') continue;
    out[k] = url;
  }
  return out;
}

// ── Portfolio nail taxonomy (epic Req §4–6,10): typed, customer-filterable dimensions ─────────────────────────
export const NAIL_SHAPES = ['Round', 'Square', 'Squoval', 'Oval', 'Almond', 'Coffin', 'Ballerina', 'Stiletto', 'Lipstick', 'Flare', 'Custom'] as const;
export const NAIL_LENGTHS = ['Extra Short', 'Short', 'Medium', 'Long', 'Extra Long'] as const;
export const NAIL_COMPLEXITIES = ['Simple', 'Moderate', 'Detailed', 'Intricate'] as const;
const inEnum = (v: unknown, list: readonly string[]): string | null => (typeof v === 'string' && list.includes(v) ? v : null);

export interface PortfolioTaxonomy {
  nailShape: string | null; nailLength: string | null; designStyle: string | null;
  complexity: string | null; brand: string | null; colorName: string | null;
}
/** Validate enum dimensions (shape/length/complexity) and sanitize free-text dimensions (style/brand/color). */
export function sanitizePortfolioTaxonomy(input: any): PortfolioTaxonomy {
  return {
    nailShape: inEnum(input?.nailShape, NAIL_SHAPES),
    nailLength: inEnum(input?.nailLength, NAIL_LENGTHS),
    complexity: inEnum(input?.complexity, NAIL_COMPLEXITIES),
    designStyle: sanitizeText(input?.designStyle, 40),
    brand: sanitizeText(input?.brand, 40),
    colorName: sanitizeText(input?.colorName, 40),
  };
}

// ── Customer photo consent (epic Req §8): which public uses a customer approved for a service photo ───────────
export const CONSENT_PUBLIC_USES = ['portfolio', 'nailshowcase', 'salon_marketing', 'social_marketing'] as const;
export const CONSENT_USES = ['private_only', 'portfolio', 'nailshowcase', 'salon_marketing', 'social_marketing', 'all'] as const;

export function sanitizeConsentUses(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const allowed = new Set(CONSENT_USES as readonly string[]);
  return Array.from(new Set(input.filter((x): x is string => typeof x === 'string' && allowed.has(x))));
}

/** May a photo with this consent be shown publicly? Withdrawn ⇒ no; otherwise needs 'all' or any specific public use. */
export function consentAllowsPublic(approvedUses: string[], revoked: boolean): boolean {
  if (revoked) return false;
  if (approvedUses.includes('all')) return true;
  return (CONSENT_PUBLIC_USES as readonly string[]).some((u) => approvedUses.includes(u));
}

// ── Slug ────────────────────────────────────────────────────────────────────────────────────────────────────
export function slugify(name: string, suffix?: string): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'tech';
  return suffix ? `${base}-${suffix}` : base;
}

// ── Text sanitation (bio/review) ───────────────────────────────────────────────────────────────────────────
export function sanitizeText(raw: unknown, max = 1000): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  return v || null;
}

// ── Profile completion (doc-exact weights) ─────────────────────────────────────────────────────────────────
// avatar 20 · bio 20 · ≥3 portfolio photos 25 · services selected 20 · specialties 10 · external link 5
export function profileCompletionPercent(p: { avatarUrl?: string | null; bio?: string | null; portfolioPhotoCount: number; servicesCount: number; specialtiesCount: number; linksCount: number }): number {
  let pct = 0;
  if (p.avatarUrl) pct += 20;
  if (p.bio && p.bio.trim().length >= 10) pct += 20;
  if (p.portfolioPhotoCount >= 3) pct += 25;
  if (p.servicesCount > 0) pct += 20;
  if (p.specialtiesCount > 0) pct += 10;
  if (p.linksCount > 0) pct += 5;
  return pct;
}

// ── Reviewer display privacy (all docs): "Jessica L." or "Anonymous Customer" ─────────────────────────────
export function reviewerDisplayName(fullName: string | null | undefined, anonymous = false): string {
  if (anonymous || !fullName || !fullName.trim()) return 'Anonymous Customer';
  const parts = fullName.trim().split(/\s+/);
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

// ── Rating math ────────────────────────────────────────────────────────────────────────────────────────────
export function nextAverage(currentAvg: number | null, currentCount: number, newScore: number): { avg: number; count: number } {
  const count = currentCount + 1;
  const avg = Math.round((((currentAvg ?? 0) * currentCount + newScore) / count) * 100) / 100;
  return { avg, count };
}

export const RATING_TAGS = ['Clean Work', 'Friendly', 'Fast', 'Beautiful Design', 'Great Design', 'Detail Oriented', 'On Time', 'Great Shape', 'Good Color Match', 'Would Book Again'] as const;
export function sanitizeRatingTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter((t): t is string => typeof t === 'string' && (RATING_TAGS as readonly string[]).includes(t)).slice(0, 6);
}

// ── Balanced discovery ranking (doc2/doc3 weighted; confidence-damped so 1×5★ ≠ winner) ───────────────────
export interface RankInputs {
  ratingAverage: number | null;       // 0..5
  ratingCount: number;
  verifiedCompletedServices: number;
  portfolioPhotoCount: number;
  hasAvatar: boolean; hasBio: boolean;
  distanceMiles: number | null;       // null when no origin
  nextAvailableMinutes: number | null; // minutes until next open slot; null unknown
}

export function techRankingScore(i: RankInputs): number {
  const confidence = Math.log10(i.ratingCount + 1) / Math.log10(101); // 0 at 0 reviews → 1 at 100+
  const ratingScore = ((i.ratingAverage ?? 0) / 5) * confidence;       // damped by volume
  const volumeScore = Math.min(Math.log10(i.ratingCount + 1) / 2, 1);
  const completedScore = Math.min(Math.log10(i.verifiedCompletedServices + 1) / 3, 1);
  const portfolioScore = Math.min(i.portfolioPhotoCount / 6, 1) * 0.7 + (i.hasAvatar ? 0.15 : 0) + (i.hasBio ? 0.15 : 0);
  const availabilityScore = i.nextAvailableMinutes == null ? 0.4 : i.nextAvailableMinutes <= 120 ? 1 : i.nextAvailableMinutes <= 24 * 60 ? 0.7 : 0.4;
  const distanceScore = i.distanceMiles == null ? 0.5 : Math.max(0, 1 - i.distanceMiles / 25);
  return Math.round((ratingScore * 40 + volumeScore * 15 + completedScore * 15 + availabilityScore * 10 + portfolioScore * 10 + distanceScore * 10) * 100) / 100;
}

// ── Upload safety (magic bytes, not client MIME; caps per the spec set) ───────────────────────────────────
export const AVATAR_MAX_BYTES = 10 * 1024 * 1024;   // Sep 2026 merge: the developer raised 5MB -> 20MB (phone photos); 10MB — the same as a portfolio photo, never larger
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

export function sniffImageType(buf: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export function validateImageUpload(buf: Buffer, kind: 'avatar' | 'photo'): { ok: true; ext: 'jpg' | 'png' | 'webp' } | { ok: false; message: string } {
  const cap = kind === 'avatar' ? AVATAR_MAX_BYTES : PHOTO_MAX_BYTES;
  if (!buf || buf.length === 0) return { ok: false, message: 'No image received.' };
  if (buf.length > cap) return { ok: false, message: `Image is too large — max ${Math.round(cap / 1024 / 1024)}MB.` };
  const ext = sniffImageType(buf);
  if (!ext) return { ok: false, message: 'Only JPG, PNG, or WebP images are allowed.' };
  return { ok: true, ext };
}

export const CONTENT_TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
