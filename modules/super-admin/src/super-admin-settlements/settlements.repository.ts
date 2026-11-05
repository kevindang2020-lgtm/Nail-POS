// settlements.repository.ts — real SQL over the existing payment_settlements batch spine (migration 038 + 175),
// joined to tenants/branches. Tenant/branch scope is applied here; the Super Admin platform path is gated by
// SuperAdminGuard at the controller. Money stays INTEGER CENTS. Funding accounts are returned masked-suffix only.
import { sql, type Kysely } from 'kysely';

export interface RawSettlement {
  id: string; batchRef: string | null; tenantId: string; tenantName: string | null; branchId: string | null; branchName: string | null;
  processor: string | null; grossCents: number; feeCents: number; refundsCents: number; chargebacksCents: number; adjustmentsCents: number;
  netCents: number; expectedNetCents: number | null; actualDepositCents: number | null; transactionCount: number;
  expectedDepositDate: string | null; actualDepositDate: string | null; fundingLast4: string | null;
  status: string; reconciliationStatus: string; signedDifferenceCents: number | null; currency: string;
  settledAtMs: number | null; createdAtMs: number;
}

export interface SettlementFilters {
  tenantId?: string; branchId?: string; processor?: string; settlementStatus?: string; reconciliationStatus?: string;
  fundingLast4?: string; search?: string; startDate?: string; endDate?: string;
  page: number; pageSize: number; sort?: string; direction?: 'asc' | 'desc';
  scope?: unknown; selectedId?: string;
}

export interface RawSettlementData { aggItems: RawSettlement[]; pageItems: RawSettlement[]; pageTotal: number; selected: RawSettlement | null }

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const nn = (v: unknown): number | null => (v == null ? null : n(v));
const ms = (v: unknown): number | null => (v == null ? null : new Date(v as string).getTime());
const dstr = (v: unknown): string | null => (v == null ? null : String(v).slice(0, 10));

type Row = Record<string, unknown>;
const mapRow = (r: Row): RawSettlement => ({
  id: String(r.id), batchRef: (r.settlement_id as string) ?? null, tenantId: String(r.tenant_id), tenantName: (r.tenant_name as string) ?? null,
  branchId: (r.branch_id as string) ?? null, branchName: (r.branch_name as string) ?? null, processor: (r.processor_type as string) ?? null,
  grossCents: n(r.gross_cents), feeCents: n(r.fee_cents), refundsCents: n(r.refunds_cents), chargebacksCents: n(r.chargebacks_cents),
  adjustmentsCents: n(r.adjustments_cents), netCents: n(r.net_cents), expectedNetCents: nn(r.expected_net_cents), actualDepositCents: nn(r.actual_deposit_cents),
  transactionCount: n(r.transaction_count), expectedDepositDate: dstr(r.expected_deposit_date), actualDepositDate: dstr(r.actual_deposit_date),
  fundingLast4: (r.funding_account_last4 as string) ?? null, status: String(r.status ?? 'unknown'), reconciliationStatus: String(r.reconciliation_status ?? 'not_started'),
  signedDifferenceCents: nn(r.signed_difference_cents), currency: String(r.currency ?? 'USD'), settledAtMs: ms(r.settled_at), createdAtMs: ms(r.created_at) ?? Date.now(),
});

const SELECT = sql`
  s.id, s.settlement_id, s.tenant_id, t.display_name as tenant_name, s.branch_id, b.name as branch_name,
  s.processor_type, s.gross_cents, s.fee_cents, s.refunds_cents, s.chargebacks_cents, s.adjustments_cents, s.net_cents,
  s.expected_net_cents, s.actual_deposit_cents, s.transaction_count, s.expected_deposit_date, s.actual_deposit_date,
  s.funding_account_last4, s.status, s.reconciliation_status, s.signed_difference_cents, s.currency, s.settled_at, s.created_at`;
const FROM = sql`
  from payment_settlements s
  left join tenants t on t.id = s.tenant_id
  left join branches b on b.id = s.branch_id`;

const SORT_COL: Record<string, string> = {
  batchRef: 's.settlement_id', tenant: 't.display_name', branch: 'b.name', processor: 's.processor_type',
  gross: 's.gross_cents', net: 's.net_cents', expected: 's.expected_deposit_date', actual: 's.actual_deposit_date',
  status: 's.status', difference: 's.signed_difference_cents', created: 's.created_at',
};

export class SettlementsRepository {
  constructor(private readonly db: Kysely<any> | null) {}

  async settlementData(f: SettlementFilters): Promise<RawSettlementData> {
    if (!this.db) return { aggItems: [], pageItems: [], pageTotal: 0, selected: null };
    const conds: ReturnType<typeof sql>[] = [];
    const scopeTenant = (f.scope as any)?.tenantId as string | undefined;
    const tenantId = f.tenantId ?? scopeTenant;
    if (tenantId) conds.push(sql`s.tenant_id = ${tenantId}`);
    if (f.branchId) conds.push(sql`s.branch_id = ${f.branchId}`);
    if (f.processor) conds.push(sql`s.processor_type = ${f.processor}`);
    if (f.settlementStatus) conds.push(sql`s.status = ${f.settlementStatus}`);
    if (f.reconciliationStatus) conds.push(sql`s.reconciliation_status = ${f.reconciliationStatus}`);
    if (f.fundingLast4) conds.push(sql`s.funding_account_last4 = ${f.fundingLast4}`);
    if (f.startDate) conds.push(sql`s.created_at >= ${f.startDate}::timestamptz`);
    if (f.endDate) conds.push(sql`s.created_at < (${f.endDate}::date + interval '1 day')`);
    if (f.search) {
      const like = `%${f.search.trim()}%`;
      // Search safe fields only — never full bank/routing numbers.
      conds.push(sql`(s.settlement_id ilike ${like} or t.display_name ilike ${like} or b.name ilike ${like} or s.processor_type ilike ${like})`);
    }
    const where = conds.length ? sql`where ${sql.join(conds, sql` and `)}` : sql``;

    const sortCol = SORT_COL[f.sort ?? 'created'] ?? 's.created_at';
    const dir = f.direction === 'asc' ? 'asc' : 'desc';
    const offset = (f.page - 1) * f.pageSize;

    const aggP = sql<Row>`select ${SELECT} ${FROM} ${where} order by s.created_at desc nulls last limit 5000`.execute(this.db);
    const pageP = sql<Row>`select ${SELECT} ${FROM} ${where} order by ${sql.raw(sortCol)} ${sql.raw(dir)} nulls last limit ${f.pageSize} offset ${offset}`.execute(this.db);
    const countP = sql<{ c: number }>`select count(*)::int c ${FROM} ${where}`.execute(this.db);
    const selP = f.selectedId
      ? sql<Row>`select ${SELECT} ${FROM} where s.id = ${f.selectedId}${tenantId ? sql` and s.tenant_id = ${tenantId}` : sql``} limit 1`.execute(this.db)
      : Promise.resolve({ rows: [] as Row[] });

    const [agg, page, count, sel] = await Promise.all([aggP, pageP, countP, selP]);
    return { aggItems: agg.rows.map(mapRow), pageItems: page.rows.map(mapRow), pageTotal: n(count.rows[0]?.c), selected: sel.rows[0] ? mapRow(sel.rows[0]) : null };
  }

  /** Append-only note insert. Never stores bank/processor secrets. */
  async insertNote(input: { settlementId: string; tenantId: string; branchId: string | null; category: string; body: string; authorUserId: string | null; authorRole: string; supportCaseId: string | null }): Promise<{ id: string; createdAt: string } | null> {
    if (!this.db) return null;
    const r = await sql<{ id: string; created_at: string }>`
      INSERT INTO settlement_notes (settlement_id, tenant_id, branch_id, category, body, author_user_id, author_role, support_case_id)
      VALUES (${input.settlementId}, ${input.tenantId}, ${input.branchId}, ${input.category}, ${input.body}, ${input.authorUserId}, ${input.authorRole}, ${input.supportCaseId})
      RETURNING id, created_at`.execute(this.db);
    const row = r.rows[0];
    return row ? { id: row.id, createdAt: new Date(row.created_at).toISOString() } : null;
  }

  /** Latest notes for a settlement (newest first). */
  async notesFor(settlementId: string, tenantId: string | null, limit = 20): Promise<{ id: string; category: string; body: string; authorRole: string | null; createdAt: string }[]> {
    if (!this.db) return [];
    const r = await sql<Row>`
      SELECT id, category, body, author_role, created_at FROM settlement_notes
      WHERE settlement_id = ${settlementId}${tenantId ? sql` and tenant_id = ${tenantId}` : sql``}
      ORDER BY created_at DESC LIMIT ${limit}`.execute(this.db).catch(() => ({ rows: [] as Row[] }));
    return r.rows.map((x) => ({ id: String(x.id), category: String(x.category), body: String(x.body), authorRole: (x.author_role as string) ?? null, createdAt: new Date(x.created_at as string).toISOString() }));
  }
}
