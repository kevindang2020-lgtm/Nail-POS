// duplicate-review-core.ts — the pure rules of Duplicate Review (guides FULL + COMPLETE, Nov 1 2026). No I/O.
//
// Rule version dr-2026-11-02 (guide §04/§07 — "a confidence category is not a verdict"):
//   per field (phone · email · name) across the group's members:
//     match    — every member has a value and they are all the same
//     partial  — some members share the value, the others have NONE (a blank is "not provided", never a match)
//     conflict — two members have DIFFERENT non-empty values
//     missing  — no member has a value
//   exact    = phone match AND email match AND name match
//   strong   = (phone match OR email match) AND name match AND no phone/email conflict
//   possible = everything else — in particular a name-only match, and a shared phone/email with different names
//              (a family / household number), however many records share it.
//
// The pre-Nov-2 label (still reproduced by `legacyConfidence` so the health check can explain old labels) compared only
// the NON-EMPTY values: one "test" with a phone + one "test" without → one distinct phone → "same phone" → Strong. That is
// exactly the screenshot's "Strong / Similar name" on two records with zero shared contact. Fixed here.
import { createHash } from 'node:crypto';

export const DR_RULE_VERSION = 'dr-2026-11-02';
export const DR_STATUSES = ['pending', 'in_review', 'deferred', 'kept_separate', 'merged', 'failed', 'resolved'] as const;
export const DR_OPEN_STATUSES = ['pending', 'in_review', 'deferred', 'failed'] as const;
export const DR_STATUS_FILTERS = ['open', 'all', ...DR_STATUSES] as const;
export const DR_CONFIDENCES = ['exact', 'strong', 'possible'] as const;
export const DR_REASONS = ['phone', 'email', 'name'] as const;
export const DR_DATE_FIELDS = ['detected', 'updated', 'reviewed', 'merged', 'customer_created'] as const;
export const DR_PRESETS = ['all', 'today', 'yesterday', 'week', 'last_7', 'month', 'last_30', 'last_month', 'year', 'custom'] as const;
export const DR_SORTS = ['newest', 'oldest', 'confidence', 'members', 'updated'] as const;
export const DR_PAGE_SIZES = [10, 25, 50, 100] as const;
export const DR_EVENT_TYPES = ['detected', 'reopened', 'resolved', 'assigned', 'in_review', 'deferred', 'kept_separate', 'note_added',
  'merge_previewed', 'merged', 'merge_failed', 'evidence_requested'] as const;
export const DR_DECISIONS = ['in_review', 'defer', 'keep_separate', 'reopen', 'request_evidence'] as const;
/** a key shared by more profiles than this is not a person (the salon's own number, "walk in", …) — not grouped, counted */
export const DR_MAX_KEY_MEMBERS = 20;
export const DR_SCAN_MIN_GAP_SECONDS = 60;
export const DR_STALE_AFTER_MINUTES = 15;
export const DR_PREVIEW_TTL_MINUTES = 10;
export const DR_HEALTH_GAP_SECONDS = 30;

export type Confidence = (typeof DR_CONFIDENCES)[number];
export type FieldState = 'match' | 'partial' | 'conflict' | 'missing';
export interface MemberSignals { id: string; phone: string | null; email: string | null; nameKey: string | null; phoneVerified: boolean }
export interface Signal { field: 'phone' | 'email' | 'name'; state: FieldState; present: number; of: number; verified: boolean | null; source: 'customers' }
export interface Evidence { ruleVersion: string; signals: Signal[]; why: string[]; legacyLabel: Confidence }

const clean = (v: string | null | undefined) => { const s = (v ?? '').trim(); return s ? s : null; };

export function fieldState(values: (string | null | undefined)[]): { state: FieldState; present: number } {
  const present = values.map(clean).filter((v): v is string => v != null);
  if (!present.length) return { state: 'missing', present: 0 };
  if (new Set(present).size > 1) return { state: 'conflict', present: present.length };
  return { state: present.length === values.length ? 'match' : 'partial', present: present.length };
}

/** typed evidence for one group (guide §04 "candidate evidence payload") — states only, never the raw phone / email */
export function assessEvidence(members: MemberSignals[]): Evidence {
  const n = members.length;
  const ph = fieldState(members.map((m) => m.phone));
  const em = fieldState(members.map((m) => m.email));
  const nm = fieldState(members.map((m) => m.nameKey));
  const signals: Signal[] = [
    { field: 'phone', state: ph.state, present: ph.present, of: n, verified: ph.state === 'match' ? members.every((m) => m.phoneVerified) : null, source: 'customers' },
    { field: 'email', state: em.state, present: em.present, of: n, verified: null, source: 'customers' },
    { field: 'name', state: nm.state, present: nm.present, of: n, verified: null, source: 'customers' },
  ];
  const why: string[] = [];
  const contactMatch = ph.state === 'match' || em.state === 'match';
  if (!contactMatch && nm.state === 'match') why.push('name_only');
  if (contactMatch && nm.state === 'conflict') why.push('shared_contact_different_names');
  if (ph.state === 'conflict' || em.state === 'conflict') why.push('contact_conflict');
  if (ph.state === 'partial' || em.state === 'partial') why.push('contact_missing_on_some');
  if (ph.state === 'match' && signals[0].verified) why.push('verified_phone');
  return { ruleVersion: DR_RULE_VERSION, signals, why, legacyLabel: legacyConfidence(members) };
}

export function classifyConfidence(e: Pick<Evidence, 'signals'>): Confidence {
  const s = (f: Signal['field']) => e.signals.find((x) => x.field === f)?.state ?? 'missing';
  const phone = s('phone'), email = s('email'), name = s('name');
  if (phone === 'match' && email === 'match' && name === 'match') return 'exact';
  if ((phone === 'match' || email === 'match') && name === 'match' && phone !== 'conflict' && email !== 'conflict') return 'strong';
  return 'possible';
}

/** the pre-Nov-2 rule (ai-customer-profile duplicateConfidence as it was called) — for the health check's explanation only */
export function legacyConfidence(members: Pick<MemberSignals, 'phone' | 'email'>[]): Confidence {
  const one = (vals: (string | null)[]) => { const s = new Set(vals.map(clean).filter(Boolean)); return s.size === 1; };
  const samePhone = one(members.map((m) => m.phone)), sameEmail = one(members.map((m) => m.email));
  if (samePhone && sameEmail) return 'exact';
  if (samePhone || sameEmail) return 'strong';
  return 'possible';
}

export const groupKeyOf = (ids: string[]) => createHash('md5').update([...ids].sort().join('|')).digest('hex');
/** material evidence = the field states (not the timestamps): a change reopens a Keep Separate decision (guide §03) */
export const evidenceHashOf = (e: Pick<Evidence, 'signals'>) =>
  createHash('sha256').update(JSON.stringify(e.signals.map((s) => [s.field, s.state, s.present, s.of]))).digest('hex').slice(0, 32);
export const stableHash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

/** every pair of a group, ordered (customer_duplicate_decisions is keyed by the ordered pair) */
export function pairsOf(ids: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) out.push(ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]]);
  return out;
}

/** salon-local [from, to] for a preset, given the salon's today (YYYY-MM-DD); custom is validated by the caller */
export function presetRange(preset: string, today: string): { from: string; to: string } | null {
  const d = (s: string) => new Date(s + 'T00:00:00Z');
  const f = (x: Date) => x.toISOString().slice(0, 10);
  const add = (s: string, n: number) => { const x = d(s); x.setUTCDate(x.getUTCDate() + n); return f(x); };
  const t = d(today);
  switch (preset) {
    case 'today': return { from: today, to: today };
    case 'yesterday': { const y = add(today, -1); return { from: y, to: y }; }
    case 'week': { const dow = (t.getUTCDay() + 6) % 7; const s = add(today, -dow); return { from: s, to: add(s, 6) }; }   // Monday-start
    case 'last_7': return { from: add(today, -6), to: today };
    case 'month': { const s = `${today.slice(0, 7)}-01`; const e = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)); return { from: s, to: f(e) }; }
    case 'last_30': return { from: add(today, -29), to: today };
    case 'last_month': { const s = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1)); const e = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0)); return { from: f(s), to: f(e) }; }
    case 'year': return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    default: return null;
  }
}
