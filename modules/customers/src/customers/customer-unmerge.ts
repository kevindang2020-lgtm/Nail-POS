// customer-unmerge.ts — extras Customer 08 (Nov 13 2026): undo a completed customer merge, SAFELY.
//
// Every merge (customer-merge.ts mergeCustomersTx) leaves a customer_merge_snapshots row: which rows moved from which source,
// the tags moved / dropped, the loyalty profiles folded in, and a fingerprint (md5 of the row) of every moved row as the merge
// left it. An unmerge restores from that snapshot ONLY when nothing touched the merged data since:
//   • the snapshot is this salon's and still active (never undone twice);
//   • the survivor is still a live profile, and every source is still the archived copy THIS merge made (same archived_at);
//   • every moved row still exists, still belongs to the survivor and still has the fingerprint the merge recorded;
//   • every moved tag is still on the survivor;
//   • no loyalty entry was written for the survivor or a source after the merge.
// Otherwise it refuses with a coded reason and changes nothing. Assessment and restore run in ONE transaction under the same
// per-customer loyalty locks the merge takes. Rows created for the survivor AFTER the merge stay with the survivor.
// What it never does: move money, cancel / reschedule, send anything, delete a customer or touch the merge log (history stays).
import { sql, type Kysely } from 'kysely';
import { applyLoyaltyEntry, lockLoyaltyCustomer } from '../loyalty/loyalty-ledger.service';

export type UnmergeRefusal = 'CUSTOMER_UNMERGE_NOT_FOUND' | 'CUSTOMER_UNMERGE_ALREADY_UNDONE' | 'CUSTOMER_UNMERGE_SURVIVOR_CHANGED'
  | 'CUSTOMER_UNMERGE_SOURCE_CHANGED' | 'CUSTOMER_UNMERGE_ROWS_CHANGED' | 'CUSTOMER_UNMERGE_LOYALTY_CHANGED' | 'CUSTOMER_UNMERGE_UNSUPPORTED';

export class CustomerUnmergeError extends Error {
  constructor(message: string, readonly code: UnmergeRefusal, readonly details: Record<string, unknown> = {}) { super(message); }
}

interface SnapshotV1 {
  v: 1;
  rowsBySource: Record<string, Record<string, string[]>>;
  fingerprints: Record<string, Record<string, string>>;
  sourceStatus: Record<string, string>;
  survivorHadProfile: boolean;
  tags: { customerId: string; moved: string[]; dropped: string[] }[];
  loyaltyProfiles: { id: string; customerId: string; branchId: string | null; tier: string | null; points: number; earned: number; redeemed: number }[];
}
export interface MergeSnapshotRow {
  id: string; tenant_id: string; survivor_customer_id: string; source_customer_ids: string[]; merge_log_ids: Record<string, string>;
  snapshot: SnapshotV1; status: string; merged_at: unknown;
}
export interface UnmergeAssessment { ok: boolean; code: UnmergeRefusal | null; message: string | null; details: Record<string, unknown> }
export interface UnmergeResult { snapshotId: string; survivorId: string; restoredCustomerIds: string[]; restored: Record<string, number>; pointsRestored: number }

/** the tables an unmerge may write (the merge's own list) — the snapshot's table names are checked against it, never trusted */
const RESTORABLE = new Set(['tickets', 'pos_tech_appointments', 'reviews', 'review_requests', 'gift_cards', 'gift_card_recipients',
  'customer_memberships', 'membership_payments', 'membership_activity', 'membership_audit', 'customer_payment_methods',
  'customer_wallet_ledger', 'loyalty_point_earnings', 'loyalty_redemptions', 'nail_showcase_photos',
  'nail_showcase_posts', 'nail_photo_consent', 'customer_preferences']);

const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);

export async function loadMergeSnapshot(db: Kysely<any>, tenantId: string, id: string, forUpdate: boolean): Promise<MergeSnapshotRow | null> {
  const r = (await (forUpdate
    ? sql<any>`select id, tenant_id, survivor_customer_id, source_customer_ids, merge_log_ids, snapshot, status, merged_at from customer_merge_snapshots where tenant_id = ${tenantId} and id = ${id}::uuid for update`
    : sql<any>`select id, tenant_id, survivor_customer_id, source_customer_ids, merge_log_ids, snapshot, status, merged_at from customer_merge_snapshots where tenant_id = ${tenantId} and id = ${id}::uuid`).execute(db)).rows[0];
  if (!r) return null;
  return { ...r, merge_log_ids: parse(r.merge_log_ids) ?? {}, snapshot: parse(r.snapshot) };
}

const refuse = (code: UnmergeRefusal, message: string, details: Record<string, unknown> = {}): UnmergeAssessment => ({ ok: false, code, message, details });

/** Read-only: can this merge be undone right now? (the same checks the unmerge itself runs, under its locks) */
export async function assessUnmerge(db: Kysely<any>, snap: MergeSnapshotRow): Promise<UnmergeAssessment> {
  const T = snap.tenant_id; const s = snap.snapshot;
  if (snap.status !== 'active') return refuse('CUSTOMER_UNMERGE_ALREADY_UNDONE', 'This merge was already undone.');
  if (!s || s.v !== 1) return refuse('CUSTOMER_UNMERGE_UNSUPPORTED', 'This merge has no restorable snapshot.');
  const sources = snap.source_customer_ids;
  const surv = (await sql<{ id: string }>`select id from customers where tenant_id = ${T} and id = ${snap.survivor_customer_id} and archived_at is null`.execute(db)).rows;
  if (!surv.length) return refuse('CUSTOMER_UNMERGE_SURVIVOR_CHANGED', 'The kept profile was archived or merged again since; this merge cannot be undone.');
  const src = (await sql<{ id: string }>`select c.id from customers c join customer_merge_snapshots m on m.id = ${snap.id}::uuid and m.tenant_id = c.tenant_id
      where c.tenant_id = ${T} and c.id = any(${sources}::uuid[]) and c.status = 'archived' and c.archived_at = m.merged_at`.execute(db)).rows;
  if (src.length !== sources.length) return refuse('CUSTOMER_UNMERGE_SOURCE_CHANGED', 'A merged profile was restored or changed since; this merge cannot be undone.', { changed: sources.filter((x) => !src.some((r) => r.id === x)) });
  const changed: Record<string, number> = {};
  for (const [t, fps] of Object.entries(s.fingerprints ?? {})) {
    if (!RESTORABLE.has(t)) return refuse('CUSTOMER_UNMERGE_UNSUPPORTED', 'This merge snapshot names a table an unmerge cannot restore.', { table: t });
    const ids = Object.keys(fps); if (!ids.length) continue;
    const now = (await sql<{ id: string; h: string }>`select x.id, md5(row_to_json(x)::text) as h from ${sql.table(t)} x where x.tenant_id = ${T} and x.id = any(${ids}::uuid[]) and x.customer_id = ${snap.survivor_customer_id}`.execute(db)).rows;
    const cur = new Map(now.map((r) => [r.id, r.h]));
    const n = ids.filter((id) => cur.get(id) !== fps[id]).length;
    if (n) changed[t] = n;
  }
  const movedTags = (s.tags ?? []).flatMap((x) => x.moved);
  if (movedTags.length) {
    const have = (await sql<{ tag: string }>`select tag from customer_tags where tenant_id = ${T} and customer_id = ${snap.survivor_customer_id} and tag = any(${movedTags}::text[])`.execute(db)).rows;
    const missing = movedTags.filter((tg) => !have.some((h) => h.tag === tg)).length;
    if (missing) changed.customer_tags = missing;
  }
  if (Object.keys(changed).length) return refuse('CUSTOMER_UNMERGE_ROWS_CHANGED', 'Records that moved in this merge were changed since (for example a visit, booking or gift card was updated); undoing it now would lose those changes.', { changed });
  const later = (await sql<{ n: number }>`select count(*)::int as n from loyalty_ledger l join customer_merge_snapshots m on m.id = ${snap.id}::uuid and m.tenant_id = l.tenant_id
      where l.tenant_id = ${T} and l.customer_id = any(${[snap.survivor_customer_id, ...sources]}::uuid[]) and l.created_at > m.merged_at`.execute(db)).rows[0];
  if (Number(later?.n ?? 0) > 0) return refuse('CUSTOMER_UNMERGE_LOYALTY_CHANGED', 'Loyalty points changed after this merge; undoing it now could give back points that were already used.', { laterEntries: Number(later?.n ?? 0) });
  return { ok: true, code: null, message: null, details: { rows: Object.fromEntries(Object.entries(s.rowsBySource ?? {}).map(([t, by]) => [t, Object.values(by).flat().length])), sources: sources.length } };
}

/** Undo the merge inside `trx` (the caller owns the transaction and writes the audit row in it). Throws CustomerUnmergeError. */
export async function unmergeCustomersTx(trx: Kysely<any>, actor: { tenantId: string; branchId?: string | null; userId?: string | null }, snapshotId: string, reason: string): Promise<UnmergeResult> {
  const T = actor.tenantId;
  const first = await loadMergeSnapshot(trx, T, snapshotId, false);
  if (!first) throw new CustomerUnmergeError('That merge was not found.', 'CUSTOMER_UNMERGE_NOT_FOUND');
  for (const id of [first.survivor_customer_id, ...first.source_customer_ids].sort()) await lockLoyaltyCustomer(trx, T, id);
  const snap = (await loadMergeSnapshot(trx, T, snapshotId, true))!;
  const a = await assessUnmerge(trx, snap);
  if (!a.ok) throw new CustomerUnmergeError(a.message ?? 'This merge cannot be undone.', a.code!, a.details);
  const s = snap.snapshot; const survivor = snap.survivor_customer_id; const sources = snap.source_customer_ids;

  // 1. the sources come back first (the tenant-consistency triggers check the customer a row points at)
  for (const src of sources) {
    await sql`update customers set status = ${s.sourceStatus?.[src] ?? 'active'}, archived_at = null, updated_at = now() where tenant_id = ${T} and id = ${src} and status = 'archived'`.execute(trx);
  }
  // 2. exactly the moved rows go back to the profile they came from
  const restored: Record<string, number> = {};
  for (const [t, bySrc] of Object.entries(s.rowsBySource ?? {})) {
    if (!RESTORABLE.has(t)) throw new CustomerUnmergeError('This merge snapshot names a table an unmerge cannot restore.', 'CUSTOMER_UNMERGE_UNSUPPORTED', { table: t });
    for (const [src, ids] of Object.entries(bySrc)) {
      if (!ids.length) continue;
      const r: any = await sql`update ${sql.table(t)} set customer_id = ${src} where tenant_id = ${T} and customer_id = ${survivor} and id = any(${ids}::uuid[])`.execute(trx);
      restored[t] = (restored[t] ?? 0) + Number(r.numAffectedRows ?? 0);
    }
  }
  // 3. tags: the moved ones go back, the ones the merge dropped (the survivor already had them) are re-added to the source
  for (const tg of s.tags ?? []) {
    if (tg.moved.length) await sql`update customer_tags set customer_id = ${tg.customerId} where tenant_id = ${T} and customer_id = ${survivor} and tag = any(${tg.moved}::text[])`.execute(trx);
    for (const tag of tg.dropped) await sql`insert into customer_tags (tenant_id, customer_id, tag, created_by_user_id) values (${T}, ${tg.customerId}, ${tag}, ${actor.userId && /^[0-9a-f-]{36}$/i.test(actor.userId) ? actor.userId : null}) on conflict do nothing`.execute(trx);
    if (tg.moved.length || tg.dropped.length) restored.customer_tags = (restored.customer_tags ?? 0) + tg.moved.length + tg.dropped.length;
  }
  // 4. loyalty: the folded-in profiles come back and the moved points move back as a pair of `merge` ledger entries
  let pointsRestored = 0;
  for (const p of s.loyaltyProfiles ?? []) {
    await sql`insert into customer_loyalty_profiles (id, tenant_id, branch_id, customer_id, loyalty_tier, points_balance, total_earned_points, total_redeemed_points)
      values (${p.id}, ${T}, ${p.branchId}, ${p.customerId}, ${p.tier ?? 'Regular'}, 0, ${p.earned}, ${p.redeemed})`.execute(trx);
    const logId = snap.merge_log_ids[p.customerId];
    if (p.points !== 0 && logId) {
      await applyLoyaltyEntry(trx, { tenantId: T, branchId: actor.branchId || p.branchId, customerId: survivor, entryType: 'merge', delta: -p.points, allowNegative: false,
        reason: `unmerge: back to customer ${p.customerId}`, sourceTable: 'customer_unmerges', sourceId: logId, actorUserId: actor.userId ?? null, legacyType: 'merge_out', legacySource: 'pos' });
      await applyLoyaltyEntry(trx, { tenantId: T, branchId: p.branchId, customerId: p.customerId, entryType: 'merge', delta: p.points, allowNegative: true,
        reason: `unmerge: restored from customer ${survivor}`, sourceTable: 'customer_unmerge_restores', sourceId: logId, actorUserId: actor.userId ?? null, legacyType: 'merge_in', legacySource: 'pos' });
    }
    pointsRestored += p.points;
  }
  if ((s.loyaltyProfiles ?? []).length) {
    const earned = s.loyaltyProfiles.reduce((n, p) => n + p.earned, 0); const redeemed = s.loyaltyProfiles.reduce((n, p) => n + p.redeemed, 0);
    await sql`update customer_loyalty_profiles set total_earned_points = greatest(0, total_earned_points - ${earned}), total_redeemed_points = greatest(0, total_redeemed_points - ${redeemed}), updated_at = now()
      where tenant_id = ${T} and customer_id = ${survivor}`.execute(trx);
    if (!s.survivorHadProfile) await sql`delete from customer_loyalty_profiles where tenant_id = ${T} and customer_id = ${survivor} and points_balance = 0 and total_earned_points = 0 and total_redeemed_points = 0`.execute(trx);
  }
  // 5. the snapshot is closed (the guard trigger allows exactly this one change)
  await sql`update customer_merge_snapshots set status = 'undone', undone_at = now(), undone_by_user_id = ${actor.userId && /^[0-9a-f-]{36}$/i.test(actor.userId) ? actor.userId : null}, undo_reason = ${reason.slice(0, 500)}
    where tenant_id = ${T} and id = ${snap.id}::uuid and status = 'active'`.execute(trx);
  return { snapshotId: snap.id, survivorId: survivor, restoredCustomerIds: sources, restored, pointsRestored };
}
