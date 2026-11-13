// customer-merge.ts — THE canonical customer merge (Functional Decision 29, Oct 1 2026), as one in-transaction function.
//
// Extracted Nov 2 2026 (Duplicate Review guide §12/§15) so that BOTH the original `/pos/customers/duplicates/:id/merge`
// route and the Duplicate Review workspace run exactly the same merge — and so the workspace can record its own
// operation / group state INSIDE the same transaction (the merge and its bookkeeping commit together or not at all).
//
// What it does (unchanged from the Oct 1 behaviour):
//   • everything a customer owns moves to the survivor (tickets, appointments, reviews, gift cards, memberships, saved
//     payment-method REFERENCES, wallet ledger, loyalty earnings / redemptions, showcase photos + consent, preferences);
//   • loyalty points move as a pair of `merge` ledger entries (out of the source's history, into the survivor's) under
//     the per-customer loyalty lock — the ledger stays the truth, nothing is summed off-ledger;
//   • tags the survivor already has are dropped from the source, the rest move;
//   • sources are ARCHIVED (never deleted), one customer_merge_logs row per source, ONE customer.merged outbox event.
// What it never does: move money, refund, cancel a membership, reschedule a booking, send a message, or copy consent
// from the source to the survivor (the survivor's own opt-ins stay exactly as they were).
import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent } from '@aipowersalon/events';
import { applyLoyaltyEntry, lockLoyaltyCustomer } from '../loyalty/loyalty-ledger.service';

export interface MergeActor { tenantId: string; branchId?: string | null; userId?: string | null }
export interface MergeResult { moved: Record<string, number>; mergeLogIds: Record<string, string> }

/** tables whose customer_id moves to the survivor (each is tenant-scoped) */
export const MERGE_REASSIGN_TABLES = ['tickets', 'pos_tech_appointments', 'reviews', 'review_requests', 'gift_cards', 'gift_card_recipients',
  'customer_memberships', 'membership_payments', 'membership_activity', 'membership_audit', 'customer_payment_methods',
  'customer_wallet_ledger', 'loyalty_point_earnings', 'loyalty_redemptions', 'nail_showcase_photos',
  'nail_showcase_posts', 'nail_photo_consent', 'customer_preferences'] as const;

const uuidOrNull = (v: unknown) => (/^[0-9a-f-]{36}$/i.test(String(v ?? '')) ? String(v) : null);

export class CustomerMergeError extends Error { constructor(message: string, readonly code: string) { super(message); } }

/**
 * Merge `sourceIds` into `survivorId` inside `trx`. The caller owns the transaction and has already validated that every
 * id is a live customer of `actor.tenantId` (this re-checks and throws rather than half-merging).
 */
export async function mergeCustomersTx(trx: Kysely<any>, actor: MergeActor, survivorId: string, sourceIds: string[], meta: { groupId: string }, outbox: OutboxWriter | null): Promise<MergeResult> {
  const T = actor.tenantId;
  const others = [...new Set(sourceIds)].filter((id) => id !== survivorId);
  if (!others.length) throw new CustomerMergeError('Choose at least one other profile to merge.', 'DUPLICATE_MERGE_NOTHING_TO_MERGE');
  // the same per-customer loyalty lock adjustLoyaltyPoints takes — sorted, so two merges cannot deadlock
  for (const id of [survivorId, ...others].sort()) await lockLoyaltyCustomer(trx, T, id);
  // re-check under the locks: every member live and in this salon (a concurrent merge would have archived one)
  const live = (await sql<{ id: string }>`select id from customers where tenant_id = ${T} and id = any(${[survivorId, ...others]}::uuid[]) and archived_at is null for update`.execute(trx)).rows;
  if (live.length !== others.length + 1) throw new CustomerMergeError('One of these profiles was already merged or archived.', 'DUPLICATE_ALREADY_MERGED');

  // extras Customer 08 (Nov 13 2026): the reversible-merge record — what each source owned BEFORE it moves, and how each source
  // stood (status), so an unmerge can put back exactly these rows (customer_merge_snapshots, written at the end of this transaction)
  const srcStatus = Object.fromEntries((await sql<{ id: string; status: string | null }>`select id, status from customers where tenant_id = ${T} and id = any(${others}::uuid[])`.execute(trx)).rows.map((r) => [r.id, r.status ?? 'active']));
  const rowsBySource: Record<string, Record<string, string[]>> = {};
  const moved: Record<string, number> = {};
  for (const t of MERGE_REASSIGN_TABLES) {
    const owned = (await sql<{ id: string; customer_id: string }>`select id, customer_id from ${sql.table(t)} where tenant_id = ${T} and customer_id = any(${others}::uuid[])`.execute(trx)).rows;
    for (const o of owned) ((rowsBySource[t] ??= {})[o.customer_id] ??= []).push(o.id);
    const r: any = await sql`update ${sql.table(t)} set customer_id = ${survivorId} where tenant_id = ${T} and customer_id = any(${others}::uuid[])`.execute(trx);
    if (Number(r.numAffectedRows ?? 0)) moved[t] = Number(r.numAffectedRows);
  }
  const tagRows = (await sql<{ customer_id: string; tag: string; dup: boolean }>`select s.customer_id, s.tag,
      exists (select 1 from customer_tags p where p.tenant_id = ${T} and p.customer_id = ${survivorId} and p.tag = s.tag) as dup
    from customer_tags s where s.tenant_id = ${T} and s.customer_id = any(${others}::uuid[])`.execute(trx)).rows;
  // tags are unique per (tenant, customer, tag): drop the ones the survivor already has, move the rest
  await sql`delete from customer_tags s where s.tenant_id = ${T} and s.customer_id = any(${others}::uuid[])
    and exists (select 1 from customer_tags p where p.tenant_id = ${T} and p.customer_id = ${survivorId} and p.tag = s.tag)`.execute(trx);
  const tg: any = await sql`update customer_tags set customer_id = ${survivorId} where tenant_id = ${T} and customer_id = any(${others}::uuid[])`.execute(trx);
  if (Number(tg.numAffectedRows ?? 0)) moved.customer_tags = Number(tg.numAffectedRows);

  // loyalty (Phase 10): the ledger is the truth, so points move as a pair of `merge` entries
  const logIds = new Map(others.map((src) => [src, randomUUID()] as const));
  const profs: any[] = (await sql<any>`select id, customer_id, branch_id, loyalty_tier, points_balance, total_earned_points, total_redeemed_points from customer_loyalty_profiles
    where tenant_id = ${T} and customer_id = any(${others}::uuid[])`.execute(trx)).rows;
  const survivorHadProfile = (await sql`select 1 from customer_loyalty_profiles where tenant_id = ${T} and customer_id = ${survivorId}`.execute(trx)).rows.length > 0;
  let movedPoints = 0;
  for (const p of profs) {
    const b = Number(p.points_balance || 0); const src = String(p.customer_id);
    if (b !== 0) {
      await applyLoyaltyEntry(trx, { tenantId: T, branchId: p.branch_id, customerId: src, entryType: 'merge', delta: -b, allowNegative: true,
        reason: `merged into customer ${survivorId}`, sourceTable: 'customers', sourceId: src, actorUserId: actor.userId ?? null, legacyType: 'merge_out', legacySource: 'pos' });
      await applyLoyaltyEntry(trx, { tenantId: T, branchId: actor.branchId || p.branch_id, customerId: survivorId, entryType: 'merge', delta: b, allowNegative: true,
        reason: `merged from customer ${src}`, sourceTable: 'customer_merge_logs', sourceId: logIds.get(src)!, actorUserId: actor.userId ?? null, legacyType: 'merge_in', legacySource: 'pos' });
    }
    movedPoints += b;
  }
  if (profs.length) {
    const add = (k: string) => profs.reduce((n, p) => n + Number(p[k] || 0), 0);
    const has = (await sql`select 1 from customer_loyalty_profiles where tenant_id = ${T} and customer_id = ${survivorId}`.execute(trx)).rows.length > 0;
    if (!has) await sql`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, points_balance, total_earned_points, total_redeemed_points)
      values (${T}, ${profs[0].branch_id}, ${survivorId}, 0, 0, 0)`.execute(trx);
    await sql`update customer_loyalty_profiles set total_earned_points = total_earned_points + ${add('total_earned_points')},
      total_redeemed_points = total_redeemed_points + ${add('total_redeemed_points')}, updated_at = now() where tenant_id = ${T} and customer_id = ${survivorId}`.execute(trx);
    await sql`delete from customer_loyalty_profiles where tenant_id = ${T} and id = any(${profs.map((p) => p.id)}::uuid[])`.execute(trx);
    moved.loyalty_points = movedPoints;
  }
  // customers are tenant-wide (Retention CR-02): archive by tenant + id, and prove every source was archived
  const arch: any = await sql`update customers set status = 'archived', archived_at = now(), updated_at = now()
    where tenant_id = ${T} and id = any(${others}::uuid[]) and archived_at is null`.execute(trx);
  if (Number(arch.numAffectedRows ?? 0) !== others.length) throw new CustomerMergeError('A profile changed while merging; nothing was merged.', 'DUPLICATE_MERGE_CONFLICT');
  const prim = (await sql<{ branch_id: string | null }>`select branch_id from customers where tenant_id = ${T} and id = ${survivorId}`.execute(trx)).rows[0];
  for (const src of others) {
    await sql`insert into customer_merge_logs (id, tenant_id, branch_id, source_customer_id, target_customer_id, merged_by_user_id, merge_summary_json)
      values (${logIds.get(src)}, ${T}, ${prim?.branch_id ?? uuidOrNull(actor.branchId)}, ${src}, ${survivorId}, ${uuidOrNull(actor.userId)}, ${JSON.stringify({ groupId: meta.groupId, moved })}::jsonb)`.execute(trx);
  }
  // extras Customer 08: fingerprint every moved row AS THIS MERGE LEFT IT (md5 of the whole row) — an unmerge proceeds only while
  // every fingerprint still matches, i.e. nothing touched those rows since
  const fingerprints: Record<string, Record<string, string>> = {};
  for (const [t, bySrc] of Object.entries(rowsBySource)) {
    const ids = Object.values(bySrc).flat();
    const fp = (await sql<{ id: string; h: string }>`select x.id, md5(row_to_json(x)::text) as h from ${sql.table(t)} x where x.tenant_id = ${T} and x.id = any(${ids}::uuid[])`.execute(trx)).rows;
    fingerprints[t] = Object.fromEntries(fp.map((r) => [r.id, r.h]));
  }
  const snapshot = {
    v: 1, rowsBySource, fingerprints, sourceStatus: srcStatus, survivorHadProfile,
    tags: others.map((src) => ({ customerId: src, moved: tagRows.filter((x) => x.customer_id === src && !x.dup).map((x) => x.tag), dropped: tagRows.filter((x) => x.customer_id === src && x.dup).map((x) => x.tag) })),
    loyaltyProfiles: profs.map((p) => ({ id: String(p.id), customerId: String(p.customer_id), branchId: p.branch_id, tier: p.loyalty_tier ?? null, points: Number(p.points_balance || 0), earned: Number(p.total_earned_points || 0), redeemed: Number(p.total_redeemed_points || 0) })),
  };
  await sql`insert into customer_merge_snapshots (tenant_id, branch_id, group_id, survivor_customer_id, source_customer_ids, merge_log_ids, snapshot, merged_by_user_id)
    values (${T}, ${prim?.branch_id ?? uuidOrNull(actor.branchId)}, ${meta.groupId}, ${survivorId}, ${others}::uuid[], ${JSON.stringify(Object.fromEntries(logIds))}::jsonb, ${JSON.stringify(snapshot)}::jsonb, ${uuidOrNull(actor.userId)})`.execute(trx);
  // BUILD_PLAN Phase 15: ONE customer.merged per merge, committed with the merge or not at all. Ids only (§95).
  if (outbox) {
    const mergedIds = [...others].sort();
    await outbox.write(trx, createDomainEvent({
      eventType: DOMAIN_EVENTS.CUSTOMER_MERGED, tenantId: T, branchId: actor.branchId || prim?.branch_id || undefined,
      aggregateType: 'customer', aggregateId: survivorId, actorId: actor.userId ?? undefined, actorType: 'user',
      correlationId: `customer:${survivorId}`,
      payload: { customerId: survivorId, mergedCustomerIds: mergedIds, mergeLogIds: mergedIds.map((id) => logIds.get(id)!) },
    }));
  }
  return { moved, mergeLogIds: Object.fromEntries(logIds) };
}
