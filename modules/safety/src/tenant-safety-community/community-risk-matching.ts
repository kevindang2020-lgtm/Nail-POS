// community-risk-matching.ts — privacy-preserving "possible related reports" matcher.
//
// DISABLED BY DEFAULT. The spec is unambiguous: this feature "may be built only if it follows strict controls"
// and "requires an approved platform legal and privacy policy before activation". So the flag defaults to OFF
// and the gate is a hard precondition, not a config nicety: with no approved policy recorded, every entry point
// refuses. Building the interfaces now (as the spec instructs) means the architecture is right if it is ever
// switched on — it does not mean it is on.
//
// What this is FOR: telling a salon "two other salons reported a similar pattern" so they take care. What it
// must never become: a way to look a person up. Every control below exists to keep that line:
//
//   * Identifiers are SALTED ONE-WAY HASHES. The raw phone/email is never stored, never logged, never returned.
//     The salt is per-platform and secret; without it a hash cannot be reversed or rainbow-tabled, and a tenant
//     cannot compute the hash of an arbitrary person to probe for them (they'd need the salt).
//   * A single match NEVER surfaces. >= 2 reliable indicators are required (reused from the existing
//     relatedReportsDisposition guard) — one coincidence is not a signal.
//   * The result is a COUNT and a label — "possible related reports". Never "known scammer", never an identity,
//     never which salon reported it.
//   * NO BROWSING. There is no list/search endpoint over fingerprints by design; you can only ask "does this
//     specific case I'm already handling have related reports?" — you cannot enumerate.
//   * NEVER DENIES SERVICE. The result carries `mayDenyService: false` and a mandatory staff-review note.
//   * EXPIRY + FALSE-POSITIVE RETIREMENT. Expired or retired fingerprints are excluded from every lookup.
//   * EVERY LOOKUP IS AUDITED by the caller (the service records it), and lookups are rate-limited.
import { createHmac } from 'crypto';
import { relatedReportsDisposition } from './community-permissions';

export type IndicatorKind = 'phone' | 'email' | 'device' | 'booking_pattern' | 'processor_token';

/** Activation gate. Both must be true — a deploy flag alone is not enough; the legal/privacy policy approval is
 *  recorded explicitly so no one can enable this by flipping an env var. */
export interface RiskMatchingPolicy {
  featureEnabled: boolean;              // deploy flag (default false)
  legalPrivacyPolicyApproved: boolean;  // recorded platform approval (default false)
  approvedPolicyRef?: string | null;    // e.g. the policy document id/version
}
export const DISABLED_BY_DEFAULT: RiskMatchingPolicy = { featureEnabled: false, legalPrivacyPolicyApproved: false, approvedPolicyRef: null };

export function isActivated(p: RiskMatchingPolicy): boolean {
  return !!p.featureEnabled && !!p.legalPrivacyPolicyApproved && !!p.approvedPolicyRef;
}

export class RiskMatchingDisabled extends Error {
  constructor(public reason: 'feature_disabled' | 'policy_not_approved') {
    super(reason === 'policy_not_approved'
      ? 'Risk matching requires an approved platform privacy and legal policy before it can be activated.'
      : 'Risk matching is disabled.');
    this.name = 'RiskMatchingDisabled';
  }
}
export function assertActivated(p: RiskMatchingPolicy): void {
  if (!p.legalPrivacyPolicyApproved || !p.approvedPolicyRef) throw new RiskMatchingDisabled('policy_not_approved');
  if (!p.featureEnabled) throw new RiskMatchingDisabled('feature_disabled');
}

/** Normalize then salt-hash. The raw value never leaves this function. */
export function fingerprint(kind: IndicatorKind, rawValue: string, salt: string): string {
  if (!salt || salt.length < 16) throw new Error('RISK_SALT_MISSING_OR_WEAK');   // never hash with a weak/absent salt
  const norm = normalize(kind, rawValue);
  if (!norm) return '';
  return createHmac('sha256', salt).update(`${kind}:${norm}`).digest('hex');
}
function normalize(kind: IndicatorKind, v: string): string {
  const s = (v || '').trim().toLowerCase();
  if (!s) return '';
  if (kind === 'phone') return s.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');   // digits only, strip US country code
  if (kind === 'email') return s.replace(/\s/g, '');
  return s.replace(/\s+/g, ' ');
}

export interface FingerprintHit { indicatorKind: IndicatorKind; reliability: 'weak' | 'reliable'; postId: string; }

export interface RelatedReportsResult {
  surfaced: boolean;
  label: string;                    // "possible related reports" — never "known scammer"
  matchingReports: number;          // a COUNT only
  reliableIndicators: number;
  mayDenyService: false;            // structurally false — a match can never deny service
  staffReviewRequired: true;        // a human must judge
  reportingTenants: never[];        // deliberately empty: never expose who reported
  guidance: string;
}

/**
 * Decide what (if anything) to show. Requires >= 2 reliable indicators; returns a count and a cautious label,
 * never an identity, never the reporting salons, and never a service-denial instruction.
 */
export function evaluateRelatedReports(hits: FingerprintHit[]): RelatedReportsResult {
  const distinctPosts = new Set(hits.map((h) => h.postId));
  const reliable = new Set(hits.filter((h) => h.reliability === 'reliable').map((h) => h.indicatorKind));
  const d = relatedReportsDisposition(distinctPosts.size, reliable.size);
  return {
    surfaced: d.surface,
    label: d.surface ? 'possible related reports' : 'insufficient_indicators',
    matchingReports: d.surface ? distinctPosts.size : 0,
    reliableIndicators: reliable.size,
    mayDenyService: false,
    staffReviewRequired: true,
    reportingTenants: [],
    guidance: d.surface
      ? 'Other salons have reported a similar pattern. Treat this as a prompt for staff caution and verification — not as proof about any person, and not a reason to refuse service.'
      : 'No sufficiently corroborated related reports. Proceed normally.',
  };
}

// ── Store port (no browse/enumerate method exists, by design) ──
export interface RiskFingerprintStore {
  /** Look up ONLY by supplied fingerprints; excludes expired and retired rows. */
  findHits(fingerprints: string[]): Promise<FingerprintHit[]>;
  record(postId: string, kind: IndicatorKind, fp: string, reliability: 'weak' | 'reliable'): Promise<void>;
  /** False-positive correction: retire a fingerprint rather than keep a wrong signal. */
  retire(fp: string, reason: string): Promise<void>;
}

// ── BUILD_PLAN Phase 8 (agent C): the store behind the platform flag ───────────────────────────────────────────────
// Active ONLY when all three hold: the platform setting `community.risk_matching_enabled` is true (Super Admin, default
// off), an approved legal/privacy policy is referenced (COMMUNITY_RISK_POLICY_REF) and a strong salt is configured
// (COMMUNITY_RISK_SALT). Off → nothing is hashed, nothing is written, nothing is looked up. The raw text is read only to
// pull indicators out of it and is never stored or returned; a lookup surfaces only through evaluateRelatedReports
// (relatedReportsDisposition: ≥ 2 reports AND ≥ 2 reliable indicators, a count and a cautious label).
export const RISK_MATCHING_FLAG = 'community.risk_matching_enabled';

export interface RiskIndicator { kind: IndicatorKind; value: string; reliability: 'weak' | 'reliable' }
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** Phone numbers and email addresses in a (raw, private) incident text. */
export function extractIndicators(text: string): RiskIndicator[] {
  const out: RiskIndicator[] = [];
  const seen = new Set<string>();
  for (const m of String(text || '').match(PHONE_RE) ?? []) { const k = `phone:${m.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')}`; if (!seen.has(k)) { seen.add(k); out.push({ kind: 'phone', value: m, reliability: 'reliable' }); } }
  for (const m of String(text || '').match(EMAIL_RE) ?? []) { const k = `email:${m.toLowerCase()}`; if (!seen.has(k)) { seen.add(k); out.push({ kind: 'email', value: m, reliability: 'reliable' }); } }
  return out;
}

export class RiskMatchingService {
  constructor(
    private readonly store: RiskFingerprintStore,
    private readonly flags: { platformFlag(key: string): Promise<boolean> },
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async policy(): Promise<RiskMatchingPolicy & { salt: string | null }> {
    const featureEnabled = await this.flags.platformFlag(RISK_MATCHING_FLAG).catch(() => false);
    const ref = (this.env.COMMUNITY_RISK_POLICY_REF || '').trim() || null;
    const salt = (this.env.COMMUNITY_RISK_SALT || '').length >= 16 ? String(this.env.COMMUNITY_RISK_SALT) : null;
    return { featureEnabled, legalPrivacyPolicyApproved: !!ref && !!salt, approvedPolicyRef: ref, salt };
  }

  /** Write salted fingerprints for an advisory's private source text — only when activated. */
  async recordFromText(postId: string, rawText: string): Promise<{ recorded: number; reason?: string }> {
    const p = await this.policy();
    if (!isActivated(p) || !p.salt) return { recorded: 0, reason: 'disabled' };
    let recorded = 0;
    for (const ind of extractIndicators(rawText)) {
      const fp = fingerprint(ind.kind, ind.value, p.salt);
      if (!fp) continue;
      await this.store.record(postId, ind.kind, fp, ind.reliability);
      recorded++;
    }
    return { recorded };
  }

  /** "Possible related reports" for a case already in hand — null while disabled. Excludes the post's own fingerprints. */
  async relatedReports(postId: string, rawText: string): Promise<RelatedReportsResult | null> {
    const p = await this.policy();
    if (!isActivated(p) || !p.salt) return null;
    const fps = extractIndicators(rawText).map((i) => fingerprint(i.kind, i.value, p.salt!)).filter(Boolean);
    const hits = (await this.store.findHits(fps)).filter((h) => h.postId !== postId);
    return evaluateRelatedReports(hits);
  }
}
