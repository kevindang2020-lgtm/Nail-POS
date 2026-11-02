// settlements-actions.service.ts — controlled write-actions for Settlements & Deposits. Every action is
// SuperAdminGuard-gated (controller), server-derives tenant/branch from the settlement row (never trusts the client),
// preserves ORIGINAL processor/bank amounts (gross/fees/refunds/chargebacks are never mutated here), and is audit
// logged. Notes are append-only. Exports return MASKED funding only and are formula-injection-guarded.
import { sql, type Kysely } from 'kysely';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { SettlementsService, AdminCtx } from './settlements.service';
import type { SettlementsRepository } from './settlements.repository';
import { reconciliationDiffCents, netDepositCents, maskAccount } from './settlements-core';

interface Tickets { createTicket(ctx: any, raw: any): Promise<{ ok: boolean; error?: string; ticket?: { id?: string } }> }
const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
// eslint-disable-next-line no-control-regex -- intentionally stripping control chars from user-supplied note text
const clean = (v: unknown, max = 4000): string => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, max);
const guard = (v: unknown): string => { const s = v == null ? '' : String(v); return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; };

interface Scope { tenantId: string; branchId: string | null; expectedNetCents: number; actualDepositCents: number | null }

export class SettlementsActionsService {
  constructor(private readonly db: Kysely<any> | null, private readonly tickets: Tickets, private readonly svc: SettlementsService, private readonly repo: SettlementsRepository) {}

  /** Server-derive the settlement's tenant/branch + current amounts. Returns null if not found (or out of scope). */
  private async scopeOf(id: string): Promise<Scope | null> {
    if (!this.db || !isUuid(id)) return null;
    const r = await sql<any>`SELECT tenant_id, branch_id, gross_cents, fee_cents, refunds_cents, chargebacks_cents, adjustments_cents, expected_net_cents, actual_deposit_cents FROM payment_settlements WHERE id = ${id} LIMIT 1`.execute(this.db);
    const row = r.rows[0];
    if (!row) return null;
    const expected = row.expected_net_cents != null ? Number(row.expected_net_cents)
      : netDepositCents({ grossCents: Number(row.gross_cents), refundsCents: Number(row.refunds_cents), chargebacksCents: Number(row.chargebacks_cents), feesCents: Number(row.fee_cents), adjustmentsCents: Number(row.adjustments_cents) });
    return { tenantId: String(row.tenant_id), branchId: row.branch_id ? String(row.branch_id) : null, expectedNetCents: expected, actualDepositCents: row.actual_deposit_cents == null ? null : Number(row.actual_deposit_cents) };
  }

  private async audit(ctx: AdminCtx, action: string, s: { tenantId: string; branchId: string | null } | null, entityId: string | null, meta: Record<string, unknown>): Promise<void> {
    if (!this.db) return;
    try {
      await sql`INSERT INTO audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
                VALUES (${s?.tenantId ?? null}, ${s?.branchId ?? null}, ${ctx.userId ?? null}, 'super_admin', ${action}, 'settlement', ${entityId}, ${JSON.stringify(meta)}::jsonb)`.execute(this.db);
    } catch { /* best-effort; never block the primary effect */ }
  }

  /** Append an internal reconciliation note (append-only). Tenant is server-derived from the settlement. */
  async addNote(ctx: AdminCtx, settlementId: string, input: { category?: string; body?: string; supportCaseId?: string | null }) {
    const scope = await this.scopeOf(settlementId);
    if (!scope) return { ok: false as const, error: 'settlement_not_found' };
    const body = clean(input.body);
    if (!body) return { ok: false as const, error: 'body_required' };
    const category = clean(input.category || 'general', 40).toLowerCase().replace(/[\s-]+/g, '_');
    const note = await this.repo.insertNote({ settlementId, tenantId: scope.tenantId, branchId: scope.branchId, category, body, authorUserId: ctx.userId ?? null, authorRole: 'super_admin', supportCaseId: isUuid(input.supportCaseId) ? input.supportCaseId! : null });
    await this.audit(ctx, 'settlement.note.create', scope, settlementId, { category, supportCaseId: isUuid(input.supportCaseId) ? input.supportCaseId : null });
    return { ok: true as const, note };
  }

  /** Mark a discrepancy resolved. ONLY reconciliation_status changes — original gross/expected/actual/difference are
   *  preserved. Requires a resolution category + reason; records a resolution note; audits previous→new state. */
  async resolveDiscrepancy(ctx: AdminCtx, settlementId: string, input: { resolutionCategory?: string; reason?: string }) {
    const scope = await this.scopeOf(settlementId);
    if (!scope) return { ok: false as const, error: 'settlement_not_found' };
    const reason = clean(input.reason);
    if (!reason) return { ok: false as const, error: 'reason_required' };
    const category = clean(input.resolutionCategory || 'other', 40).toLowerCase().replace(/[\s-]+/g, '_');
    if (!this.db) return { ok: false as const, error: 'unavailable' };
    const prior = await sql<any>`SELECT reconciliation_status FROM payment_settlements WHERE id = ${settlementId} LIMIT 1`.execute(this.db);
    const prev = String(prior.rows[0]?.reconciliation_status ?? 'not_started');
    // NOTE: amounts are intentionally NOT in this UPDATE — resolving never rewrites processor/bank data.
    await sql`UPDATE payment_settlements SET reconciliation_status = 'resolved' WHERE id = ${settlementId}`.execute(this.db);
    await this.repo.insertNote({ settlementId, tenantId: scope.tenantId, branchId: scope.branchId, category: 'resolution', body: `Resolved (${category}): ${reason}`, authorUserId: ctx.userId ?? null, authorRole: 'super_admin', supportCaseId: null });
    await this.audit(ctx, 'settlement.discrepancy.resolve', scope, settlementId, { category, previousReconStatus: prev, newReconStatus: 'resolved', preservedExpectedCents: scope.expectedNetCents, preservedActualCents: scope.actualDepositCents });
    return { ok: true as const, previousReconStatus: prev, newReconStatus: 'resolved' };
  }

  /** Controlled deposit match: records the OBSERVED actual deposit against the batch and recomputes the SIGNED
   *  difference (actual − expected). Idempotent (same actual → no-op). Never mutates gross/fees/refunds/chargebacks. */
  async matchDeposit(ctx: AdminCtx, settlementId: string, input: { actualCents?: number; actualDate?: string; depositRef?: string }) {
    const scope = await this.scopeOf(settlementId);
    if (!scope) return { ok: false as const, error: 'settlement_not_found' };
    const actual = Math.trunc(Number(input.actualCents));
    if (!Number.isFinite(actual)) return { ok: false as const, error: 'actual_required' };
    if (scope.actualDepositCents === actual) return { ok: true as const, idempotent: true, differenceCents: reconciliationDiffCents(actual, scope.expectedNetCents) };
    const diff = reconciliationDiffCents(actual, scope.expectedNetCents)!;
    const recon = diff === 0 ? 'reconciled' : 'in_review';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(input.actualDate)) ? input.actualDate! : null;
    if (!this.db) return { ok: false as const, error: 'unavailable' };
    await sql`UPDATE payment_settlements SET actual_deposit_cents = ${actual}, actual_deposit_date = ${date}, signed_difference_cents = ${diff}, reconciliation_status = ${recon} WHERE id = ${settlementId} AND tenant_id = ${scope.tenantId}`.execute(this.db);
    await this.audit(ctx, 'settlement.deposit.match', scope, settlementId, { depositRef: clean(input.depositRef, 80) || null, expectedCents: scope.expectedNetCents, actualCents: actual, differenceCents: diff, newReconStatus: recon });
    return { ok: true as const, idempotent: false, differenceCents: diff, reconciliationStatus: recon };
  }

  /** Open a processor-support case. Reuses the existing SupportTickets writer with settlement context. */
  async openProcessorCase(ctx: AdminCtx, settlementId: string, input: { category?: string; severity?: string; description?: string }) {
    const scope = await this.scopeOf(settlementId);
    if (!scope) return { ok: false as const, error: 'settlement_not_found' };
    const category = clean(input.category || 'settlement_issue', 40);
    const res = await this.tickets.createTicket(
      { userId: ctx.userId, tenantId: scope.tenantId, role: 'super_admin' },
      { subject: `Processor-support case — ${category}`, body: clean(input.description) || `Settlement ${settlementId} requires processor investigation.`, category: 'billing', priority: clean(input.severity || 'high', 20), idempotencyKey: `settlement-case:${settlementId}` },
    );
    if (!res.ok) return { ok: false as const, error: res.error };
    await this.audit(ctx, 'settlement.processor_case.open', scope, settlementId, { category, ticketId: res.ticket?.id ?? null });
    return { ok: true as const, caseId: res.ticket?.id ?? null };
  }

  // --- exports (masked funding only, formula-injection-guarded, audited) ---
  private async rowsFor(ctx: AdminCtx, q: Record<string, unknown>) {
    const filters = this.svc.parseFilters({ ...q, page: 1, pageSize: 1000 });
    const o = await this.svc.getOverview(ctx, filters);
    return { rows: o.batches.rows, filters };
  }
  private cols(): { h: string; f: (r: any) => string | number }[] {
    return [
      { h: 'Batch ID', f: (r) => r.batchRef ?? '' }, { h: 'Tenant', f: (r) => r.tenantName ?? '' }, { h: 'Branch', f: (r) => r.branchName ?? '' },
      { h: 'Processor', f: (r) => r.processor ?? '' }, { h: 'Gross', f: (r) => r.grossCents }, { h: 'Refunds', f: (r) => r.refundsCents },
      { h: 'Chargebacks', f: (r) => r.chargebacksCents }, { h: 'Fees', f: (r) => r.feesCents }, { h: 'Net', f: (r) => r.netCents },
      { h: 'Expected Date', f: (r) => r.expectedDepositDate ?? '' }, { h: 'Actual Date', f: (r) => r.actualDepositDate ?? '' },
      { h: 'Funding', f: (r) => maskAccount(r.fundingMasked?.replace?.(/\D/g, '') ?? null) ?? (r.fundingMasked ?? '') }, // already masked; never a full number
      { h: 'Status', f: (r) => r.settlementStatus }, { h: 'Difference', f: (r) => (r.differenceCents ?? 0) },
    ];
  }

  async exportCsv(ctx: AdminCtx, q: Record<string, unknown>) {
    const { rows } = await this.rowsFor(ctx, q);
    const cols = this.cols();
    const csvCell = (v: unknown) => { const s = guard(String(v ?? '')); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [cols.map((c) => csvCell(c.h)).join(',')];
    for (const r of rows) lines.push(cols.map((c) => csvCell(c.f(r))).join(','));
    await this.audit(ctx, 'settlement.export', null, null, { format: 'csv', rows: rows.length });
    return { filename: `settlements-${new Date().toISOString().slice(0, 10)}.csv`, contentType: 'text/csv;charset=utf-8', body: lines.join('\n') };
  }

  async exportXlsx(ctx: AdminCtx, q: Record<string, unknown>) {
    const { rows } = await this.rowsFor(ctx, q);
    const cols = this.cols();
    const wb = new ExcelJS.Workbook(); wb.creator = 'AI PowerSalon — Settlements & Deposits'; wb.created = new Date();
    const ws = wb.addWorksheet('Settlements', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = cols.map((c) => ({ header: c.h, key: c.h, width: 16 }));
    ws.getRow(1).font = { bold: true };
    for (const r of rows) ws.addRow(cols.map((c) => (typeof c.f(r) === 'number' ? c.f(r) : guard(String(c.f(r))))));
    const buffer = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    await this.audit(ctx, 'settlement.export', null, null, { format: 'xlsx', rows: rows.length });
    return { filename: `settlements-${new Date().toISOString().slice(0, 10)}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer };
  }

  async exportPdf(ctx: AdminCtx, q: Record<string, unknown>) {
    const { rows } = await this.rowsFor(ctx, q);
    const cut = (v: unknown, n: number) => { const s = clean(v, n + 4); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
    const chunks: Buffer[] = []; doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
    doc.fontSize(15).font('Helvetica-Bold').text('Settlements & Deposits — Export');
    doc.moveDown(0.2).fontSize(8.5).font('Helvetica').fillColor('#666').text(`Generated ${new Date().toISOString()} · ${rows.length} row(s) · funding accounts masked`);
    doc.moveDown(0.6).fillColor('#000');
    const cols = [
      { h: 'Batch ID', w: 78, f: (r: any) => cut(r.batchRef, 16) }, { h: 'Tenant', w: 92, f: (r: any) => cut(r.tenantName, 20) }, { h: 'Branch', w: 72, f: (r: any) => cut(r.branchName, 15) },
      { h: 'Proc', w: 56, f: (r: any) => cut(r.processor, 10) }, { h: 'Gross', w: 78, f: (r: any) => '$' + (r.grossCents / 100).toFixed(2) }, { h: 'Net', w: 78, f: (r: any) => '$' + (r.netCents / 100).toFixed(2) },
      { h: 'Funding', w: 66, f: (r: any) => cut(r.fundingMasked, 12) }, { h: 'Status', w: 66, f: (r: any) => cut(r.settlementStatus, 12) }, { h: 'Diff', w: 66, f: (r: any) => '$' + ((r.differenceCents ?? 0) / 100).toFixed(2) },
    ];
    const x0 = doc.page.margins.left, rowH = 15, bottom = doc.page.height - doc.page.margins.bottom;
    const header = (y: number) => { doc.fontSize(8).font('Helvetica-Bold'); let x = x0; for (const c of cols) { doc.text(c.h, x + 2, y + 3, { width: c.w - 4, ellipsis: true }); x += c.w; } doc.moveTo(x0, y + rowH).lineTo(x0 + cols.reduce((a, c) => a + c.w, 0), y + rowH).strokeColor('#ccc').stroke(); return y + rowH; };
    let y = header(doc.y); doc.font('Helvetica').fontSize(8);
    for (const r of rows) {
      if (y + rowH > bottom) { doc.addPage({ size: 'A4', layout: 'landscape', margin: 36 }); y = header(doc.page.margins.top); doc.font('Helvetica').fontSize(8); }
      let x = x0; for (const c of cols) { doc.fillColor('#000').text(String(c.f(r)), x + 2, y + 3, { width: c.w - 4, ellipsis: true }); x += c.w; } y += rowH;
    }
    if (rows.length === 0) doc.fillColor('#666').text('No settlement batches match the current filters.', x0, y + 4);
    doc.end();
    const buffer = await done;
    await this.audit(ctx, 'settlement.export', null, null, { format: 'pdf', rows: rows.length });
    return { filename: `settlements-${new Date().toISOString().slice(0, 10)}.pdf`, contentType: 'application/pdf', buffer };
  }
}
