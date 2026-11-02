// live-queue-actions.service.ts — the WRITE side of the Live Queue Monitor (Super Admin oversight actions). It does NOT
// run salon queues (no reorder/assign/serve/complete) — it only creates the platform-support artifacts the monitor needs:
// support incidents, controlled-support sessions, audited exports, and branch-manager notifications. Every action is
// SuperAdminGuard-gated (controller), tenant/branch-scoped to the queue context, audit-logged to audit_logs, and reuses
// the EXISTING writers (SupportTicketsService / SupportSessionsService) — no duplicate ticketing system. Where real
// delivery infrastructure is not connected (mailer/cron) or no source exists (sync retry), the action is HONEST about
// it (delivered:false / retryable:false) rather than fabricating success.

import { maskQueuePii } from './queue-pii-mask';
import { type SupportTicketsService, type SupportSessionsService } from '@aipowersalon/support';
import { sql, type Kysely } from 'kysely';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { DB } from '@aipowersalon/database';
import type { LiveQueueService } from './live-queue.service';
import type { AdminCtx } from './super-admin-queue.service';

export interface IncidentInput {
  tenantId: string; branchId?: string; queueIds?: string[]; deviceIds?: string[];
  category?: string; severity?: string; description?: string; idempotencyKey?: string;
}
export interface NotifyInput { tenantId: string; branchId?: string; queueIds?: string[]; severity?: string; message?: string }
export interface SupportSessionInput { tenantId: string; branchId?: string; reason?: string; ticketId?: string }
export interface ExportInput { search?: string; status?: string; tenantId?: string; branchId?: string; sort?: string; direction?: 'asc' | 'desc'; /** resolved server-side by supportModeTenant — never from the client */ unmaskTenantId?: string | null }

const clampStr = (v: unknown, max = 2000): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

// CSV with spreadsheet formula-injection guard (server-side; mirrors the export discipline used across the platform).
export const csvCell = (v: unknown): string => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
};

export class LiveQueueActionsService {
  constructor(
    private readonly db: Kysely<DB> | null,
    private readonly tickets: SupportTicketsService,
    private readonly sessions: SupportSessionsService,
    private readonly live: LiveQueueService,
  ) {}

  /**
   * Support mode (Oct 12 2026 merge, workforce audit #63): may THIS admin see real customer names for `tenantId`?
   * Only through one of the platform's two controlled-support artifacts, both hers and both for that salon:
   *   • a LIVE Phase 14 `support_access_sessions` row (started, not ended, not expired — the same facts the
   *     support-session gate enforces on requests and streams; opened through the step-up-gated support-access flow).
   * Security Deep Scan §76 / §139 (Oct 28 2026 re-audit): a remote-support REQUEST she opened from this screen used to count
   * for 4 hours — with consent asserted by the platform, no step-up and nothing ever approving it — so any operator could
   * unmask any salon's customers. A request is a record only; it never unmasks.
   * Fail CLOSED (masked) on any error, without a database, or for anything that is not a salon id.
   */
  async supportModeTenant(ctx: AdminCtx, tenantId: unknown): Promise<string | null> {
    if (!this.db || !ctx.userId || !isUuid(tenantId)) return null;
    try {
      const r = await sql<{ id: string }>`
        select id from support_access_sessions
         where tenant_id = ${tenantId} and admin_user_id = ${ctx.userId}
           and started_at is not null and ended_at is null and (expires_at is null or expires_at > now())
        limit 1`.execute(this.db);
      return r.rows.length ? tenantId : null;
    } catch { return null; }
  }
  /** Every Super Admin queue READ is audited (who, filters, whether names were unmasked). The search text is never written. */
  async auditView(ctx: AdminCtx, view: string, filters: Record<string, unknown>, unmaskedTenantId: string | null): Promise<void> {
    await this.audit(ctx, 'queue.view', unmaskedTenantId, null, null, { view, unmaskedTenantId, filters: { status: filters?.status ?? null, search: filters?.search ? '[redacted]' : null, tenantId: filters?.tenantId ?? null, branchId: filters?.branchId ?? null } });
  }

  private async audit(ctx: AdminCtx, action: string, tenantId: string | null, branchId: string | null, entityId: string | null, meta: Record<string, unknown>): Promise<void> {
    if (!this.db) return;
    try {
      await sql`INSERT INTO audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
                VALUES (${tenantId}, ${branchId}, ${ctx.userId ?? null}, 'super_admin', ${action}, 'queue', ${entityId}, ${JSON.stringify(meta)}::jsonb)`.execute(this.db);
    } catch { /* audit is best-effort; never block the action's primary effect */ }
  }

  /** Open a real support incident with queue/branch/device context. Reuses SupportTicketsService.createTicket
   *  (idempotent), scoped to the affected tenant — never a parallel ticket store. */
  async openIncident(ctx: AdminCtx, input: IncidentInput) {
    if (!isUuid(input.tenantId)) return { ok: false as const, error: 'tenant_required' };
    const queueIds = (input.queueIds ?? []).filter((s) => typeof s === 'string').slice(0, 50);
    const deviceIds = (input.deviceIds ?? []).filter((s) => typeof s === 'string').slice(0, 50);
    const severity = clampStr(input.severity, 20) || 'normal';
    const desc = clampStr(input.description, 4000);
    const contextLines = [
      queueIds.length ? `Queue IDs: ${queueIds.join(', ')}` : null,
      deviceIds.length ? `Device IDs: ${deviceIds.join(', ')}` : null,
      input.branchId ? `Branch: ${input.branchId}` : null,
      `Reported from: Live Queue Monitor (Super Admin)`,
    ].filter(Boolean).join('\n');
    const helpCtx = { tenantId: input.tenantId, branchId: input.branchId ?? '', userId: ctx.userId, role: 'super_admin', permissions: [] as string[] };
    const res = await this.tickets.createTicket(helpCtx, {
      subject: `Queue incident — ${severity}`,
      description: [desc, contextLines].filter(Boolean).join('\n\n'),
      category: clampStr(input.category, 40) || 'queue',
      priority: severity === 'critical' ? 'urgent' : severity === 'high' ? 'high' : 'normal',
      affectedModule: 'live-queue-monitor',
      idempotencyKey: clampStr(input.idempotencyKey, 120) || undefined,
    });
    if (!res.ok || !res.ticket) return { ok: false as const, error: res.error ?? 'create_failed' };
    await this.audit(ctx, 'queue.incident.create', input.tenantId, input.branchId ?? null, res.ticket.id, { ticketNumber: res.ticket.ticketNumber, severity, queueIds, deviceIds });
    return { ok: true as const, ticketId: res.ticket.id, ticketNumber: res.ticket.ticketNumber, status: res.ticket.status };
  }

  /** Enter controlled support mode for a tenant/branch. Requires an explicit reason (and ideally an incident ref).
   *  Reuses SupportSessionsService — time-limited, consent-recorded, audited; never silent impersonation. */
  async openSupportSession(ctx: AdminCtx, input: SupportSessionInput) {
    if (!isUuid(input.tenantId)) return { ok: false as const, error: 'tenant_required' };
    const reason = clampStr(input.reason, 500);
    if (!reason) return { ok: false as const, error: 'reason_required' };
    const helpCtx = { tenantId: input.tenantId, branchId: input.branchId ?? '', userId: ctx.userId, role: 'super_admin', permissions: [] as string[] };
    const res = await this.sessions.createSessionRequest(helpCtx, { kind: 'remote_support', topic: reason, ticketId: input.ticketId, consentGranted: true, consentText: `Opened by a Super Admin (step-up) from the Live Queue Monitor — ${reason}. Not the salon's consent: names stay masked until a support-access session is started.` });
    if (!res.ok || !res.request) return { ok: false as const, error: res.error ?? 'create_failed' };
    await this.audit(ctx, 'queue.support_session.open', input.tenantId, input.branchId ?? null, res.request.id, { reason, ticketId: input.ticketId ?? null });
    // a request never unmasks customer names (§76): the screen is told so, and where the real path is
    return { ok: true as const, sessionId: res.request.id, status: res.request.status, unmasksNames: false, unmaskVia: 'support_access_session' as const };
  }

  /** Notify a branch manager. Delivery (email/SMS) depends on the mailer/cron infrastructure, which is NOT connected in
   *  this environment — so the intent is recorded + audited and returned with delivered:false rather than faking a send. */
  async notifyBranch(ctx: AdminCtx, input: NotifyInput) {
    if (!isUuid(input.tenantId)) return { ok: false as const, error: 'tenant_required' };
    const message = clampStr(input.message, 1000);
    const severity = clampStr(input.severity, 20) || 'normal';
    const queueIds = (input.queueIds ?? []).slice(0, 50);
    await this.audit(ctx, 'queue.branch.notify', input.tenantId, input.branchId ?? null, input.branchId ?? null, { severity, message, queueIds });
    // Honest: no mailer/cron connected → recorded as requested, not delivered.
    return { ok: true as const, delivered: false as const, reason: 'Notification recorded and audited. Delivery (email/SMS) activates when the mailer/cron service is connected.' };
  }

  /** Honest sync retry. There is no per-queue synchronization source connected, so there is nothing to retry — this
   *  returns a clear non-retryable result instead of fabricating a job (spec §30: do not retry when no source exists). */
  async retrySync(ctx: AdminCtx, queueId: string) {
    await this.audit(ctx, 'queue.sync.retry_attempt', null, null, clampStr(queueId, 120) || null, { result: 'not_retryable' });
    return { ok: false as const, retryable: false as const, reason: 'No synchronization source is connected for queue items, so there is no sync job to retry.' };
  }

  /** Server-side audited CSV export of the current queue view. Authorization is enforced by the controller guard;
   *  the export is audit-logged and formula-injection-guarded. */
  async exportCsv(ctx: AdminCtx, input: ExportInput): Promise<{ filename: string; contentType: string; body: string }> {
    const filters = this.live.parseFilters({ ...input, page: 1, pageSize: 1000 });
    const overview = maskQueuePii(await this.live.getOverview(ctx, filters), input.unmaskTenantId ?? null);
    const headers = ['Queue ID', 'Customer', 'Tenant', 'Branch', 'Status', 'Wait (min)', 'Technician', 'Service', 'Device', 'Sync', 'Threshold', 'Stuck'];
    const lines = [headers.map(csvCell).join(',')];
    for (const r of overview.queues.rows) {
      lines.push([r.queueId, r.customer, r.tenantName, r.branchName, r.status, r.waitMin, r.technicianName ?? 'Unassigned', r.service ?? '', r.deviceStatus, r.syncStatus, r.thresholdFlag, r.stuck ? 'yes' : 'no'].map(csvCell).join(','));
    }
    const body = lines.join('\n');
    await this.audit(ctx, 'queue.export', input.tenantId ?? null, input.branchId ?? null, null, { rows: overview.queues.rows.length, filters: { status: input.status ?? null, search: input.search ? '[redacted]' : null }, unmaskedTenantId: input.unmaskTenantId ?? null });
    return { filename: `live-queue-${new Date().toISOString().slice(0, 10)}.csv`, contentType: 'text/csv;charset=utf-8', body };
  }

  /** Server-side audited XLSX export of the current queue view via exceljs. Same scope/permission model as CSV
   *  (controller SuperAdminGuard). String cells that could be read as spreadsheet formulas are neutralised with a
   *  leading apostrophe — the same formula-injection guard used for CSV. Returns a real .xlsx binary buffer. */
  async exportXlsx(ctx: AdminCtx, input: ExportInput): Promise<{ filename: string; contentType: string; buffer: Buffer }> {
    const filters = this.live.parseFilters({ ...input, page: 1, pageSize: 1000 });
    const overview = maskQueuePii(await this.live.getOverview(ctx, filters), input.unmaskTenantId ?? null);
    const guard = (v: unknown): string => { const s = v == null ? '' : String(v); return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; };

    const wb = new ExcelJS.Workbook();
    wb.creator = 'AI PowerSalon — Live Queue Monitor';
    wb.created = new Date();
    const ws = wb.addWorksheet('Live Queues', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'Queue ID', key: 'q', width: 16 }, { header: 'Customer', key: 'c', width: 20 }, { header: 'Tenant', key: 't', width: 20 },
      { header: 'Branch', key: 'b', width: 16 }, { header: 'Status', key: 's', width: 12 }, { header: 'Wait (min)', key: 'w', width: 11 },
      { header: 'Technician', key: 'tech', width: 18 }, { header: 'Service', key: 'svc', width: 18 }, { header: 'Device', key: 'dev', width: 12 },
      { header: 'Sync', key: 'sync', width: 12 }, { header: 'Threshold', key: 'th', width: 12 }, { header: 'Stuck', key: 'stk', width: 8 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const r of overview.queues.rows) {
      ws.addRow({
        q: guard(r.queueId), c: guard(r.customer), t: guard(r.tenantName), b: guard(r.branchName), s: guard(r.status),
        w: r.waitMin, tech: guard(r.technicianName ?? 'Unassigned'), svc: guard(r.service ?? ''), dev: guard(r.deviceStatus),
        sync: guard(r.syncStatus), th: guard(r.thresholdFlag), stk: r.stuck ? 'yes' : 'no',
      });
    }
    const arr = await wb.xlsx.writeBuffer();
    const buffer = Buffer.from(arr as ArrayBuffer);
    await this.audit(ctx, 'queue.export', input.tenantId ?? null, input.branchId ?? null, null, { format: 'xlsx', rows: overview.queues.rows.length, filters: { status: input.status ?? null, search: input.search ? '[redacted]' : null }, unmaskedTenantId: input.unmaskTenantId ?? null });
    return { filename: `live-queue-${new Date().toISOString().slice(0, 10)}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer };
  }

  /** Server-side audited PDF export of the current queue view via pdfkit. Same scope/permission model as CSV/XLSX
   *  (controller SuperAdminGuard). Includes a header band (scope, generated-at, Super Admin identity) and a paginated
   *  table. Returns a real PDF binary buffer. */
  async exportPdf(ctx: AdminCtx, input: ExportInput): Promise<{ filename: string; contentType: string; buffer: Buffer }> {
    const filters = this.live.parseFilters({ ...input, page: 1, pageSize: 1000 });
    const overview = maskQueuePii(await this.live.getOverview(ctx, filters), input.unmaskTenantId ?? null);
    const rows = overview.queues.rows;
    const scopeLabel = input.tenantId ? `Tenant ${input.tenantId}` : 'All tenants (platform)';
    const generatedAt = new Date().toISOString();

    const buffer: Buffer = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const cols: { h: string; w: number; get: (r: (typeof rows)[number]) => string }[] = [
        { h: 'Queue ID', w: 70, get: (r) => r.queueId.slice(0, 12) }, { h: 'Customer', w: 95, get: (r) => r.customer ?? '' },
        { h: 'Tenant', w: 95, get: (r) => r.tenantName ?? '' }, { h: 'Branch', w: 80, get: (r) => r.branchName ?? '' },
        { h: 'Status', w: 62, get: (r) => r.status }, { h: 'Wait', w: 44, get: (r) => `${r.waitMin}m` },
        { h: 'Technician', w: 90, get: (r) => r.technicianName ?? 'Unassigned' }, { h: 'Service', w: 90, get: (r) => r.service ?? '' },
        { h: 'Device', w: 55, get: (r) => r.deviceStatus }, { h: 'Sync', w: 55, get: (r) => r.syncStatus },
        { h: 'Threshold', w: 60, get: (r) => r.thresholdFlag }, { h: 'Stuck', w: 40, get: (r) => (r.stuck ? 'yes' : 'no') },
      ];
      const clean = (s: string) => Array.from(s, (ch) => (ch.charCodeAt(0) < 32 ? ' ' : ch)).join('').slice(0, 40); // strip control chars, bound width

      doc.fillColor('#1c140a').fontSize(16).text('Live Queue Monitor — Queue Export', { continued: false });
      doc.moveDown(0.2).fillColor('#6b6b72').fontSize(8)
        .text(`Scope: ${scopeLabel}    Generated: ${generatedAt}    By: Super Admin ${ctx.userId ?? ''}    Rows: ${rows.length}`);
      doc.moveDown(0.6);

      const x0 = doc.page.margins.left;
      const drawHeader = (y: number) => {
        let x = x0; doc.fontSize(7.5).fillColor('#8a6d1f');
        for (const c of cols) { doc.text(c.h, x + 2, y, { width: c.w - 4, ellipsis: true }); x += c.w; }
        doc.moveTo(x0, y + 11).lineTo(x0 + cols.reduce((a, c) => a + c.w, 0), y + 11).strokeColor('#e7d6b8').stroke();
      };
      let y = doc.y; drawHeader(y); y += 15;
      doc.fontSize(7.5).fillColor('#26201a');
      for (const r of rows) {
        if (y > doc.page.height - doc.page.margins.bottom - 16) { doc.addPage(); y = doc.page.margins.top; drawHeader(y); y += 15; doc.fontSize(7.5).fillColor('#26201a'); }
        let x = x0;
        for (const c of cols) { doc.fillColor(c.h === 'Stuck' && r.stuck ? '#b85b4d' : '#26201a').text(clean(c.get(r)), x + 2, y, { width: c.w - 4, ellipsis: true }); x += c.w; }
        y += 12;
      }
      if (rows.length === 0) doc.fillColor('#6b6b72').text('No queue records match the current filters.', x0, y + 4);
      doc.end();
    });

    await this.audit(ctx, 'queue.export', input.tenantId ?? null, input.branchId ?? null, null, { format: 'pdf', rows: rows.length, filters: { status: input.status ?? null, search: input.search ? '[redacted]' : null }, unmaskedTenantId: input.unmaskTenantId ?? null });
    return { filename: `live-queue-${new Date().toISOString().slice(0, 10)}.pdf`, contentType: 'application/pdf', buffer };
  }
}
