// technician-tips.store.ts — Individual Technician Tipping at Checkout (Split Tips guide, Nov 5 2026, G4, migration 817):
// the persistence behind the customer display's per-technician tip cards. Raw SQL on the session's tenant (server-derived
// from the display token — never the body).
//
//   lines     the ticket's live service lines, who performed them (ticket_service_lines.technician_id, shared lines via
//             ticket_service_line_allocations share_bps), names / photos, and the ticket discount → the pure
//             tipRecipients() in @aipowersalon/checkout computes each technician's basis
//   save      ONE transaction: lock the selection row, check the version (a stale screen → TIP_SELECTION_STALE), write
//             the selection (DRAFT or CONFIRMED), replace the ticket's tip allocations with the customer-directed rows
//             (source 'customer_display' — the compensation engine's explicit split, never re-split 50/50), set the
//             ticket's total tip, and append the history row. A paid ticket is never touched.
//   lock      the customer started payment: CONFIRMED → LOCKED (the frozen snapshot the payment uses)
import { sql, type Kysely } from 'kysely';
import { CHECKOUT_TIP_SELECTION, type TipLineInput, type TechTipResult } from '@aipowersalon/checkout';
import { canMoveToSql } from '@aipowersalon/database';

export class TipSelectionStale extends Error { constructor(readonly currentVersion: number) { super('The tips changed on another screen. Showing the latest.'); } }
export class TipSelectionLocked extends Error { constructor() { super('Payment has started, so the tips can no longer be changed here.'); } }
export interface TipSelectionRow { version: number; state: 'DRAFT' | 'CONFIRMED' | 'LOCKED' | 'SUPERSEDED'; recipientsKey: string; selections: TechTipResult[]; totalTipCents: number }

const N = (v: unknown) => Number(v ?? 0) || 0;

export class TechnicianTipStore {
  constructor(private readonly db: Kysely<any>) {}

  async lines(tenantId: string, ticketId: string): Promise<{ lines: TipLineInput[]; discountCents: number; avatars: Record<string, string | null>; paid: boolean }> {
    const t = (await sql<any>`select discount_cents, status from tickets where tenant_id = ${tenantId} and id = ${ticketId}`.execute(this.db)).rows[0];
    if (!t) return { lines: [], discountCents: 0, avatars: {}, paid: false };
    const rows = (await sql<any>`select l.id, l.technician_id, l.service_name_snapshot, coalesce(l.line_total_cents, 0) as total, (l.product_id is not null or coalesce(l.line_kind, '') in ('product', 'retail')) as is_product,
        te.full_name as tech_name,
        (select coalesce(json_agg(json_build_object('technicianId', a.technician_id, 'shareBps', a.share_bps, 'name', ta.full_name) order by a.created_at), '[]'::json)
          from ticket_service_line_allocations a left join technicians ta on ta.id = a.technician_id and ta.tenant_id = a.tenant_id where a.tenant_id = l.tenant_id and a.line_id = l.id) as shares
      from ticket_service_lines l left join technicians te on te.id = l.technician_id and te.tenant_id = l.tenant_id
      where l.tenant_id = ${tenantId} and l.ticket_id = ${ticketId} and l.removed_at is null and coalesce(l.status, '') not in ('cancelled', 'canceled', 'voided', 'removed')
      order by l.created_at, l.id`.execute(this.db)).rows;
    const lines: TipLineInput[] = rows.map((r: any) => ({ lineId: String(r.id), technicianId: r.technician_id ? String(r.technician_id) : null, technicianName: r.tech_name ?? null, serviceName: String(r.service_name_snapshot ?? 'Service'),
      lineTotalCents: N(r.total), isProduct: !!r.is_product, shares: (Array.isArray(r.shares) ? r.shares : []).map((s: any) => ({ technicianId: String(s.technicianId), shareBps: N(s.shareBps), name: s.name ?? null })) }));
    const ids = [...new Set(lines.flatMap((l) => [l.technicianId, ...(l.shares ?? []).map((s) => s.technicianId)]).filter((x): x is string => !!x))];
    const avatars: Record<string, string | null> = {};
    if (ids.length) for (const r of (await sql<any>`select id, avatar_url from technicians where tenant_id = ${tenantId} and id = any(${ids}::uuid[])`.execute(this.db)).rows) avatars[String(r.id)] = r.avatar_url ?? null;
    return { lines, discountCents: N(t.discount_cents), avatars, paid: t.status === 'paid' };
  }

  async selection(tenantId: string, ticketId: string): Promise<TipSelectionRow | null> {
    const r = (await sql<any>`select version, state, recipients_key, selections, total_tip_cents from checkout_tip_selections where tenant_id = ${tenantId} and ticket_id = ${ticketId}`.execute(this.db)).rows[0];
    return r ? { version: N(r.version), state: r.state, recipientsKey: String(r.recipients_key), selections: Array.isArray(r.selections) ? r.selections : [], totalTipCents: N(r.total_tip_cents) } : null;
  }

  async save(a: { tenantId: string; branchId: string | null; ticketId: string; sessionId: string; expectedVersion: number | null; recipientsKey: string; items: TechTipResult[]; totalCents: number; confirm: boolean; tipMeta: { tipType: 'none' | 'percent' | 'custom'; tipPercent: number | null } }): Promise<number> {
    return this.db.transaction().execute(async (trx) => {
      const tk = (await sql<any>`select status from tickets where tenant_id = ${a.tenantId} and id = ${a.ticketId} for update`.execute(trx)).rows[0];
      if (!tk || tk.status === 'paid') throw new TipSelectionLocked();
      const cur = (await sql<any>`select version, state from checkout_tip_selections where tenant_id = ${a.tenantId} and ticket_id = ${a.ticketId} for update`.execute(trx)).rows[0];
      if (cur?.state === 'LOCKED') throw new TipSelectionLocked();
      const curV = N(cur?.version);
      if (a.expectedVersion != null && a.expectedVersion !== curV) throw new TipSelectionStale(curV);
      const version = curV + 1; const state = a.confirm ? 'CONFIRMED' : 'DRAFT';
      await sql`insert into checkout_tip_selections (tenant_id, branch_id, ticket_id, version, state, recipients_key, selections, total_tip_cents, source, session_id, confirmed_at, superseded_reason, updated_at)
        values (${a.tenantId}, ${a.branchId}, ${a.ticketId}, ${version}, ${state}, ${a.recipientsKey}, ${JSON.stringify(a.items)}::jsonb, ${a.totalCents}, 'customer_display', ${a.sessionId}, ${a.confirm ? sql`now()` : null}, null, now())
        on conflict (tenant_id, ticket_id) do update set version = excluded.version, state = excluded.state, recipients_key = excluded.recipients_key, selections = excluded.selections,
          total_tip_cents = excluded.total_tip_cents, session_id = excluded.session_id, confirmed_at = excluded.confirmed_at, superseded_reason = null, locked_at = null, updated_at = now()
        where ${canMoveToSql(CHECKOUT_TIP_SELECTION, state, 'checkout_tip_selections')}`.execute(trx);
      // the ONE tip store: the customer-directed split replaces whatever split was on file for this unpaid ticket
      await sql`delete from ticket_tip_allocations where tenant_id = ${a.tenantId} and ticket_id = ${a.ticketId}`.execute(trx);
      for (const i of a.items) await sql`insert into ticket_tip_allocations (tenant_id, branch_id, ticket_id, technician_id, tip_cents, source, selection_version)
        values (${a.tenantId}, ${a.branchId}, ${a.ticketId}, ${i.technicianId}, ${i.tipCents}, 'customer_display', ${version})`.execute(trx);
      await sql`update tickets set tip_cents = ${a.totalCents}, tip_type = ${a.tipMeta.tipType}, tip_percent = ${a.tipMeta.tipPercent}, locked_total_cents = null, updated_at = now()
        where tenant_id = ${a.tenantId} and id = ${a.ticketId}`.execute(trx);
      await sql`insert into checkout_tip_selection_events (tenant_id, ticket_id, version, action, detail, session_id)
        values (${a.tenantId}, ${a.ticketId}, ${version}, ${a.confirm ? 'CONFIRMED' : 'DRAFT_SAVED'}, ${JSON.stringify({ items: a.items, totalCents: a.totalCents })}::jsonb, ${a.sessionId})`.execute(trx);
      return version;
    });
  }

  /** payment started from the display: the confirmed selection is frozen (returns false when it is not confirmed) */
  async lock(tenantId: string, ticketId: string, sessionId: string): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const r = (await sql<any>`update checkout_tip_selections set state = 'LOCKED', locked_at = coalesce(locked_at, now()), updated_at = now() where tenant_id = ${tenantId} and ticket_id = ${ticketId} and state in ('CONFIRMED', 'LOCKED') and ${canMoveToSql(CHECKOUT_TIP_SELECTION, 'LOCKED')} returning version`.execute(trx)).rows[0];
      if (!r) return false;
      await sql`insert into checkout_tip_selection_events (tenant_id, ticket_id, version, action, detail, session_id) values (${tenantId}, ${ticketId}, ${r.version}, 'LOCKED', '{}'::jsonb, ${sessionId})`.execute(trx);
      return true;
    });
  }
  /** a failed / declined payment releases the lock so the customer can try again (the same choices stay) */
  async unlock(tenantId: string, ticketId: string): Promise<void> {
    await sql`update checkout_tip_selections set state = 'CONFIRMED', locked_at = null, updated_at = now() where tenant_id = ${tenantId} and ticket_id = ${ticketId} and state = 'LOCKED' and ${canMoveToSql(CHECKOUT_TIP_SELECTION, 'CONFIRMED')}`.execute(this.db);
  }
}
