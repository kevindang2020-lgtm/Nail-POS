// registration-model.ts — PM-03 / PM-04 (Four-Module Completion Guide §7, Oct 30 2026): the PURE rules for a salon's
// carrier registration, from the provider snapshots the sync stores (tenant_messaging_registration_snapshots, 725).
//
// No false green:
//   • a registration SUBMITTED from Super Admin (tenant_a2p_registrations) is not approval: "approved" needs a snapshot
//     in which the provider itself said so (`verified`), and only while that read is fresh;
//   • a provider outage → "Unknown — not verified", with the time of the last SUCCESSFUL read (never the old green);
//   • 10DLC brand, A2P campaign, Messaging Service and the number association are separate items;
//   • a toll-free sender follows its own verification (10DLC does not apply) — the app never submits or resubmits.
export type ItemKind = 'brand' | 'campaign' | 'messaging_service' | 'number_association' | 'tollfree_verification';
export type RegItemState = 'approved' | 'pending' | 'rejected' | 'suspended' | 'not_started' | 'unknown' | 'not_applicable';

/** a provider-confirmed state older than this no longer counts (documented in docs/handoff/PHONE_MESSAGING_ROUND2_2026-10-30.md) */
export const REGISTRATION_STALE_AFTER_MS = 72 * 3600 * 1000;
/** one manual "Refresh Status" per salon per this window (bounded provider traffic) */
export const REGISTRATION_REFRESH_MIN_INTERVAL_MS = 60_000;
/** the scheduled refresh cadence for a salon whose last read succeeded */
export const REGISTRATION_SCHEDULED_EVERY_MS = 12 * 3600 * 1000;

/** retry backoff after consecutive failed reads: 5 min × 2^(n-1), capped at 6 h */
export function retryAfterMs(consecutiveFailures: number): number {
  return Math.min(6 * 3600 * 1000, 5 * 60_000 * 2 ** Math.max(0, consecutiveFailures - 1));
}

export function normalizeBrand(status: string | null): RegItemState {
  const s = String(status ?? '').toUpperCase();
  if (s === 'APPROVED' || s === 'VERIFIED' || s === 'REGISTERED') return 'approved';
  if (s === 'PENDING' || s === 'IN_REVIEW' || s === 'IN_PROGRESS') return 'pending';
  if (s === 'FAILED' || s === 'REJECTED') return 'rejected';
  if (s === 'SUSPENDED') return 'suspended';
  if (s === 'DELETED') return 'not_started';
  return 'unknown';
}
export function normalizeCampaign(status: string | null): RegItemState {
  const s = String(status ?? '').toUpperCase();
  if (s === 'VERIFIED' || s === 'APPROVED' || s === 'ACTIVE') return 'approved';
  if (s === 'PENDING' || s === 'IN_PROGRESS' || s === 'IN_REVIEW') return 'pending';
  if (s === 'FAILED' || s === 'REJECTED') return 'rejected';
  if (s === 'SUSPENDED' || s === 'EXPIRED') return 'suspended';
  return 'unknown';
}
/** Twilio toll-free verification: PENDING_REVIEW / IN_REVIEW / TWILIO_APPROVED / TWILIO_REJECTED */
export function normalizeTollfree(status: string | null, found: boolean): RegItemState {
  if (!found) return 'not_started';
  const s = String(status ?? '').toUpperCase();
  if (s === 'TWILIO_APPROVED') return 'approved';
  if (s === 'PENDING_REVIEW' || s === 'IN_REVIEW') return 'pending';
  if (s === 'TWILIO_REJECTED') return 'rejected';
  return 'unknown';
}

export type TollfreeNextAction = 'SUBMIT_IN_TWILIO_CONSOLE' | 'WAIT_FOR_REVIEW' | 'EDIT_AND_RESUBMIT_IN_TWILIO_CONSOLE' | 'CONTACT_TWILIO_SUPPORT' | 'REFRESH_STATUS' | null;
/** what the OWNER does next — the app shows it; it never submits or resubmits (chargeable / legal steps) */
export function tollfreeNextAction(state: RegItemState, editAllowed: boolean | null): TollfreeNextAction {
  if (state === 'approved' || state === 'not_applicable') return null;
  if (state === 'not_started') return 'SUBMIT_IN_TWILIO_CONSOLE';
  if (state === 'pending') return 'WAIT_FOR_REVIEW';
  if (state === 'rejected') return editAllowed === false ? 'CONTACT_TWILIO_SUPPORT' : 'EDIT_AND_RESUBMIT_IN_TWILIO_CONSOLE';
  return 'REFRESH_STATUS';
}

export type NumberType = 'toll_free' | 'local_10dlc' | 'short_code' | 'unknown';
/** NANP toll-free prefixes (800/833/844/855/866/877/888); a provider-reported type wins when it is given */
export function numberTypeOf(n: string | null | undefined, providerType?: string | null): { type: NumberType; source: 'provider' | 'nanp_prefix' | 'none' } {
  const p = String(providerType ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (p === 'tollfree') return { type: 'toll_free', source: 'provider' };
  if (p === 'local' || p === 'mobile') return { type: 'local_10dlc', source: 'provider' };
  if (p === 'shortcode') return { type: 'short_code', source: 'provider' };
  const v = String(n ?? '');
  if (/^\+1(800|833|844|855|866|877|888)[0-9]{7}$/.test(v)) return { type: 'toll_free', source: 'nanp_prefix' };
  if (/^\+1[2-9][0-9]{9}$/.test(v)) return { type: 'local_10dlc', source: 'nanp_prefix' };
  if (/^[0-9]{5,6}$/.test(v)) return { type: 'short_code', source: 'nanp_prefix' };
  return { type: 'unknown', source: 'none' };
}

/** one stored snapshot row, as the readiness reads it */
export interface RegSnapshot {
  kind: ItemKind; state: RegItemState; verified: boolean; source: 'provider' | 'registration_record' | 'not_configured';
  providerId: string | null; providerStatus: string | null; errorClass: string | null; checkedAt: Date; lastSuccessAt: Date | null;
  retryCount: number; nextRetryAt: Date | null; details: Record<string, unknown>;
}
export interface RegItemView {
  kind: ItemKind; state: RegItemState; verified: boolean; source: RegSnapshot['source'] | 'none'; reasonCode: string | null;
  providerIdLast4: string | null; providerStatus: string | null; errorClass: string | null; checkedAt: string | null; lastSuccessAt: string | null;
  retryCount: number; nextRetryAt: string | null; stale: boolean;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * The state an item may SHOW: the provider's confirmed state while fresh; "unknown" after a failed read (with the last
 * successful read time) or once the confirmation is stale; without any provider read, the Super Admin record's state —
 * except that an "approved" there is only a claim → "unknown" (NOT_VERIFIED_WITH_PROVIDER).
 */
export function itemView(kind: ItemKind, snap: RegSnapshot | null, recordState: RegItemState | null, now: Date): RegItemView {
  const base = { kind, providerIdLast4: snap?.providerId ? snap.providerId.slice(-4) : null, providerStatus: snap?.providerStatus ?? null, errorClass: snap?.errorClass ?? null,
    checkedAt: iso(snap?.checkedAt), lastSuccessAt: iso(snap?.lastSuccessAt), retryCount: snap?.retryCount ?? 0, nextRetryAt: iso(snap?.nextRetryAt) };
  if (!snap) {
    if (recordState == null) return { ...base, state: 'not_started', verified: false, source: 'none', reasonCode: 'REGISTRATION_NOT_STARTED', stale: false };
    if (recordState === 'approved') return { ...base, state: 'unknown', verified: false, source: 'registration_record', reasonCode: 'NOT_VERIFIED_WITH_PROVIDER', stale: false };
    return { ...base, state: recordState, verified: false, source: 'registration_record', reasonCode: 'NOT_VERIFIED_WITH_PROVIDER', stale: false };
  }
  if (snap.errorClass) return { ...base, state: 'unknown', verified: false, source: snap.source, reasonCode: `PROVIDER_READ_${snap.errorClass.toUpperCase()}`, stale: false };
  const stale = snap.verified && now.getTime() - snap.checkedAt.getTime() > REGISTRATION_STALE_AFTER_MS;
  if (stale) return { ...base, state: 'unknown', verified: false, source: snap.source, reasonCode: 'PROVIDER_CHECK_STALE', stale: true };
  if (!snap.verified && snap.state === 'approved') return { ...base, state: 'unknown', verified: false, source: snap.source, reasonCode: 'NOT_VERIFIED_WITH_PROVIDER', stale: false };
  return { ...base, state: snap.state, verified: snap.verified, source: snap.source, reasonCode: snap.verified ? null : 'NOT_VERIFIED_WITH_PROVIDER', stale: false };
}

export interface TollfreeView extends RegItemView {
  applicable: boolean; numberType: NumberType; numberTypeSource: 'provider' | 'nanp_prefix' | 'none'; verificationSidLast4: string | null;
  submittedAt: string | null; rejectionCode: string | null; rejectionReason: string | null; nextAction: TollfreeNextAction;
}
export function tollfreeView(number: string | null, snap: RegSnapshot | null, now: Date): TollfreeView {
  const nt = numberTypeOf(number, (snap?.details?.providerNumberType as string | undefined) ?? null);
  const applicable = nt.type === 'toll_free';
  const v = itemView('tollfree_verification', snap, null, now);
  const d = snap?.details ?? {};
  const str = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : null);
  if (!applicable) return { ...v, state: 'not_applicable', reasonCode: null, applicable, numberType: nt.type, numberTypeSource: nt.source, verificationSidLast4: null, submittedAt: null, rejectionCode: null, rejectionReason: null, nextAction: null };
  // never read from the provider yet → "unknown", not "not started" (nothing was confirmed)
  const state: RegItemState = !snap ? 'unknown' : v.state;
  return { ...v, state, reasonCode: !snap ? 'TOLL_FREE_NOT_CHECKED' : v.reasonCode, applicable, numberType: nt.type, numberTypeSource: nt.source,
    verificationSidLast4: v.providerIdLast4, submittedAt: str('submittedAt'), rejectionCode: str('rejectionCode'), rejectionReason: str('rejectionReason'),
    nextAction: tollfreeNextAction(state, typeof d.editAllowed === 'boolean' ? (d.editAllowed as boolean) : null) };
}
