// technician-tips-guard.ts — G4 Split Tips follow-up (Nov 5 2026, guide §34 "no fabricated customer confirmation").
//
// The customer display's per-technician tip cards were guarded at the DISPLAY's Pay (a CONFIRMED, current selection is
// required and locked). The FRONT DESK pay paths (cash / card / gift card / split / rewards) did not look: a cashier could
// charge while the customer's split was still a DRAFT, and the payroll split would claim a confirmation that never
// happened. Now, before a new tender starts:
//   • no selection, SUPERSEDED (the front desk changed the total) or LOCKED (the customer's own Pay froze it) → unchanged;
//   • the ticket's performers changed since the customer chose (recipients key differs) → TECH_TIPS_STALE: the customer
//     chooses again (a staff confirmation cannot vouch for a split that no longer matches the ticket);
//   • CONFIRMED and current → proceed;
//   • DRAFT → TECH_TIPS_NOT_CONFIRMED, unless the cashier explicitly records the split ON THE CUSTOMER'S BEHALF
//     (`staffTipConfirmation: { reason }`): the selection becomes CONFIRMED with source 'staff', its tip rows say 'staff',
//     and the history row names the staff member and the reason. Never silent, never attributed to the customer.
import { sql, type Kysely } from 'kysely';
import { canMoveToSql } from '@aipowersalon/database';
import { CHECKOUT_TIP_SELECTION } from './checkout-lifecycles';
import { tipRecipients, recipientsKey, type TipLineInput } from './technician-tips';

const N = (v: unknown) => Number(v ?? 0) || 0;

export async function loadTipLines(db: Kysely<any>, tenantId: string, ticketId: string): Promise<{ lines: TipLineInput[]; discountCents: number; avatars: Record<string, string | null>; paid: boolean }> {
  const t = (await sql<any>`select discount_cents, status from tickets where tenant_id = ${tenantId} and id = ${ticketId}`.execute(db)).rows[0];
  if (!t) return { lines: [], discountCents: 0, avatars: {}, paid: false };
  const rows = (await sql<any>`select l.id, l.technician_id, l.service_name_snapshot, coalesce(l.line_total_cents, 0) as total, (l.product_id is not null or coalesce(l.line_kind, '') in ('product', 'retail')) as is_product,
      te.full_name as tech_name,
      (select coalesce(json_agg(json_build_object('technicianId', a.technician_id, 'shareBps', a.share_bps, 'name', ta.full_name) order by a.created_at), '[]'::json)
        from ticket_service_line_allocations a left join technicians ta on ta.id = a.technician_id and ta.tenant_id = a.tenant_id where a.tenant_id = l.tenant_id and a.line_id = l.id) as shares
    from ticket_service_lines l left join technicians te on te.id = l.technician_id and te.tenant_id = l.tenant_id
    where l.tenant_id = ${tenantId} and l.ticket_id = ${ticketId} and l.removed_at is null and coalesce(l.status, '') not in ('cancelled', 'canceled', 'voided', 'removed')
    order by l.created_at, l.id`.execute(db)).rows;
  const lines: TipLineInput[] = rows.map((r: any) => ({ lineId: String(r.id), technicianId: r.technician_id ? String(r.technician_id) : null, technicianName: r.tech_name ?? null, serviceName: String(r.service_name_snapshot ?? 'Service'),
    lineTotalCents: N(r.total), isProduct: !!r.is_product, shares: (Array.isArray(r.shares) ? r.shares : []).map((s: any) => ({ technicianId: String(s.technicianId), shareBps: N(s.shareBps), name: s.name ?? null })) }));
  const ids = [...new Set(lines.flatMap((l) => [l.technicianId, ...(l.shares ?? []).map((s) => s.technicianId)]).filter((x): x is string => !!x))];
  const avatars: Record<string, string | null> = {};
  if (ids.length) for (const r of (await sql<any>`select id, avatar_url from technicians where tenant_id = ${tenantId} and id = any(${ids}::uuid[])`.execute(db)).rows) avatars[String(r.id)] = r.avatar_url ?? null;
  return { lines, discountCents: N(t.discount_cents), avatars, paid: t.status === 'paid' };
}

export class TechTipsGuardError extends Error {
  constructor(readonly code: 'TECH_TIPS_NOT_CONFIRMED' | 'TECH_TIPS_STALE' | 'TECH_TIPS_REQUIRED', message: string) { super(message); this.name = 'TechTipsGuardError'; }
}
export interface StaffTipConfirmation { reason?: string | null }
export type TipGuardOutcome = 'no_selection' | 'superseded' | 'locked' | 'confirmed' | 'staff_confirmed';

/** Run before a NEW front-desk tender (never before verifying an already-started charge). */
export async function assertCustomerTipsConfirmed(db: Kysely<any>, a: { tenantId: string; ticketId: string; userId: string | null; staffConfirmation?: StaffTipConfirmation | null }): Promise<TipGuardOutcome> {
  const sel = (await sql<any>`select version, state, recipients_key from checkout_tip_selections where tenant_id = ${a.tenantId} and ticket_id = ${a.ticketId}`.execute(db)).rows[0];
  if (!sel) return 'no_selection';
  if (sel.state === 'SUPERSEDED') return 'superseded';
  if (sel.state === 'LOCKED') return 'locked';
  const l = await loadTipLines(db, a.tenantId, a.ticketId);
  if (recipientsKey(tipRecipients(l.lines, l.discountCents)) !== String(sel.recipients_key)) {
    throw new TechTipsGuardError('TECH_TIPS_STALE', 'The technicians on this ticket changed. Please choose the tips again.');
  }
  if (sel.state === 'CONFIRMED') return 'confirmed';
  // DRAFT
  const reason = String(a.staffConfirmation?.reason ?? '').trim();
  if (!a.staffConfirmation) throw new TechTipsGuardError('TECH_TIPS_NOT_CONFIRMED', 'The customer has not confirmed the tips on the display yet. Ask them to confirm, or confirm on their behalf.');
  if (reason.length < 3) throw new TechTipsGuardError('TECH_TIPS_REQUIRED', 'Say why you are confirming the tips for the customer.');
  await db.transaction().execute(async (trx) => {
    const u = await sql`update checkout_tip_selections set state = 'CONFIRMED', source = 'staff', confirmed_at = now(), updated_by = ${a.userId}, updated_at = now()
      where tenant_id = ${a.tenantId} and ticket_id = ${a.ticketId} and state = 'DRAFT' and version = ${N(sel.version)} and ${canMoveToSql(CHECKOUT_TIP_SELECTION, 'CONFIRMED')}`.execute(trx);
    if (!Number(u.numAffectedRows ?? 0)) throw new TechTipsGuardError('TECH_TIPS_STALE', 'The tips changed on the display. Please review them again.');
    await sql`update ticket_tip_allocations set source = 'staff' where tenant_id = ${a.tenantId} and ticket_id = ${a.ticketId} and source = 'customer_display' and selection_version = ${N(sel.version)}`.execute(trx);
    await sql`insert into checkout_tip_selection_events (tenant_id, ticket_id, version, action, detail, actor_user_id)
      values (${a.tenantId}, ${a.ticketId}, ${N(sel.version)}, 'STAFF_CONFIRMED_ON_BEHALF', ${JSON.stringify({ reason: reason.slice(0, 300) })}::jsonb, ${a.userId})`.execute(trx);
  });
  return 'staff_confirmed';
}

/** G4 next step 2 (Nov 5 2026): what the customer chose on the display, for the POS checkout screen — live, with the
 *  state (Draft / Confirmed / Locked / Superseded), who entered it (customer or staff), and whether the ticket's
 *  performers changed since (stale). Names come from this salon's technicians only. Null when there is no selection. */
export interface CustomerTipSelectionView {
  state: 'DRAFT' | 'CONFIRMED' | 'LOCKED' | 'SUPERSEDED'; source: 'customer_display' | 'staff'; version: number; stale: boolean; totalTipCents: number;
  technicians: { technicianId: string; name: string; tipType: string; percent: number | null; tipCents: number }[]; updatedAt: string;
}
export async function customerTipSelection(db: Kysely<any>, tenantId: string, ticketId: string): Promise<CustomerTipSelectionView | null> {
  const sel = (await sql<any>`select version, state, source, recipients_key, selections, total_tip_cents, updated_at from checkout_tip_selections where tenant_id = ${tenantId} and ticket_id = ${ticketId}`.execute(db)).rows[0];
  if (!sel) return null;
  const items: { technicianId: string; tipType: string; percent: number | null; tipCents: number }[] = Array.isArray(sel.selections) ? sel.selections : (typeof sel.selections === 'string' ? JSON.parse(sel.selections) : []);
  const ids = items.map((i) => i.technicianId).filter(Boolean);
  const names = new Map<string, string>();
  if (ids.length) for (const r of (await sql<any>`select id, full_name from technicians where tenant_id = ${tenantId} and id = any(${ids}::uuid[])`.execute(db)).rows) names.set(String(r.id), String(r.full_name ?? ''));
  const l = await loadTipLines(db, tenantId, ticketId);
  const stale = sel.state !== 'SUPERSEDED' && recipientsKey(tipRecipients(l.lines, l.discountCents)) !== String(sel.recipients_key);
  return {
    state: sel.state, source: sel.source === 'staff' ? 'staff' : 'customer_display', version: N(sel.version), stale, totalTipCents: N(sel.total_tip_cents),
    technicians: items.map((i) => ({ technicianId: String(i.technicianId), name: names.get(String(i.technicianId)) || '—', tipType: String(i.tipType), percent: i.percent == null ? null : Number(i.percent), tipCents: N(i.tipCents) })),
    updatedAt: new Date(sel.updated_at).toISOString(),
  };
}
