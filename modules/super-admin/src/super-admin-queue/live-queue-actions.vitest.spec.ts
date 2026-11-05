import { describe, it, expect, vi } from 'vitest';
import { LiveQueueActionsService, csvCell } from './live-queue-actions.service';

const TENANT = '11111111-1111-1111-1111-111111111111';

function make(over: { ticketOk?: boolean; sessionOk?: boolean; rows?: any[] } = {}) {
  const createTicket = vi.fn(async () => over.ticketOk === false
    ? { ok: false, error: 'subject_required' }
    : { ok: true, ticket: { id: 'tk-1', ticketNumber: 'TK-ABC123', status: 'submitted' } });
  const createSessionRequest = vi.fn(async () => over.sessionOk === false
    ? { ok: false, error: 'unavailable' }
    : { ok: true, request: { id: 'sess-1', status: 'pending' } });
  const live = {
    parseFilters: (q: any) => ({ ...q, page: 1, pageSize: 1000, search: q.search ?? '', status: q.status ?? '', sort: 'wait', direction: 'desc' }),
    getOverview: vi.fn(async () => ({ queues: { rows: over.rows ?? [{ queueId: 'q1', customer: '=cmd()', tenantName: 'Glamour', branchName: 'Downtown', status: 'waiting', waitMin: 18, technicianName: null, service: 'Hair Cut', deviceStatus: 'unknown', syncStatus: 'unknown', thresholdFlag: 'none', stuck: false }] } })),
  };
  const svc = new LiveQueueActionsService(null, { createTicket } as any, { createSessionRequest } as any, live as any);
  return { svc, createTicket, createSessionRequest, live };
}

describe('LiveQueueActionsService', () => {
  it('opens a real incident by reusing createTicket with queue context', async () => {
    const { svc, createTicket } = make();
    const res = await svc.openIncident({ userId: 'admin-1' }, { tenantId: TENANT, branchId: '22222222-2222-2222-2222-222222222222', queueIds: ['q-1', 'q-2'], severity: 'critical', description: 'devices offline' });
    expect(res.ok).toBe(true);
    expect((res as any).ticketNumber).toBe('TK-ABC123');
    expect(createTicket).toHaveBeenCalledOnce();
    const [ctx, input] = createTicket.mock.calls[0];
    expect(ctx.tenantId).toBe(TENANT);
    expect(input.priority).toBe('urgent'); // critical → urgent
    expect(input.description).toContain('Queue IDs: q-1, q-2');
    expect(input.affectedModule).toBe('live-queue-monitor');
  });

  it('rejects an incident without a valid tenant', async () => {
    const { svc, createTicket } = make();
    const res = await svc.openIncident({ userId: 'a' }, { tenantId: 'not-a-uuid' });
    expect(res.ok).toBe(false);
    expect(createTicket).not.toHaveBeenCalled();
  });

  it('opens a controlled support session and requires a reason', async () => {
    const { svc, createSessionRequest } = make();
    const missing = await svc.openSupportSession({ userId: 'a' }, { tenantId: TENANT });
    expect(missing.ok).toBe(false);
    expect((missing as any).error).toBe('reason_required');
    const ok = await svc.openSupportSession({ userId: 'a' }, { tenantId: TENANT, reason: 'investigate stuck sync', ticketId: 'tk-1' });
    expect(ok.ok).toBe(true);
    expect((ok as any).sessionId).toBe('sess-1');
    expect(createSessionRequest).toHaveBeenCalledOnce();
  });

  it('notify branch is honest about delivery (no mailer connected)', async () => {
    const { svc } = make();
    const res = await svc.notifyBranch({ userId: 'a' }, { tenantId: TENANT, branchId: '22222222-2222-2222-2222-222222222222', severity: 'high', message: 'queue congested' });
    expect(res.ok).toBe(true);
    expect((res as any).delivered).toBe(false);
    expect((res as any).reason).toMatch(/mailer|cron/i);
  });

  it('sync retry is honestly non-retryable (no source)', async () => {
    const { svc } = make();
    const res = await svc.retrySync({ userId: 'a' }, 'q-1');
    expect(res.ok).toBe(false);
    expect((res as any).retryable).toBe(false);
    expect((res as any).reason).toMatch(/no synchronization source/i);
  });

  it('exports CSV with a formula-injection guard', async () => {
    const { svc } = make();
    const out = await svc.exportCsv({ userId: 'a' }, { status: 'waiting' });
    expect(out.contentType).toMatch(/text\/csv/);
    expect(out.filename).toMatch(/^live-queue-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(out.body.split('\n')[0]).toBe('Queue ID,Customer,Tenant,Branch,Status,Wait (min),Technician,Service,Device,Sync,Threshold,Stuck');
    // Re-pinned Oct 12 2026 (merge, workforce audit #63): customer names are MASKED in Super Admin exports, so the cell is
    // "=••••" — the formula guard must still neutralize the leading "=" of the masked value, and the raw value never leaves.
    expect(out.body).toContain("'=••••"); // dangerous leading = is neutralized with a leading quote
    expect(out.body).not.toContain('=cmd()');
  });

  it('exports a real .xlsx workbook (valid zip) with the formula-injection guard applied', async () => {
    const { svc } = make();
    const out = await svc.exportXlsx({ userId: 'a' }, { status: 'waiting' });
    expect(out.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(out.filename).toMatch(/^live-queue-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(Buffer.isBuffer(out.buffer)).toBe(true);
    // .xlsx is a zip → must start with the PK magic bytes
    expect(out.buffer[0]).toBe(0x50);
    expect(out.buffer[1]).toBe(0x4b);
    // re-open it and confirm it's a valid workbook with the header + guarded cell
    const wb = new (await import('exceljs')).default.Workbook();
    await wb.xlsx.load(out.buffer as any);
    const ws = wb.getWorksheet('Live Queues')!;
    expect(ws.getRow(1).getCell(1).value).toBe('Queue ID');
    expect(ws.getRow(2).getCell(1).value).toBe('q1');
    expect(String(ws.getRow(2).getCell(2).value)).toBe("'=••••"); // masked customer column (audit #63) — guard still applied
  });

  it('exports a real PDF (valid %PDF header) audited with format=pdf', async () => {
    const { svc } = make();
    const out = await svc.exportPdf({ userId: 'a' }, { status: 'waiting' });
    expect(out.contentType).toBe('application/pdf');
    expect(out.filename).toMatch(/^live-queue-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(Buffer.isBuffer(out.buffer)).toBe(true);
    expect(out.buffer.length).toBeGreaterThan(400);
    expect(out.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-'); // PDF magic
    expect(out.buffer.subarray(-6).toString('latin1')).toContain('EOF'); // proper trailer
  });

  it('csvCell neutralizes formula-trigger characters', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@x')).toBe("'@x");
    expect(csvCell('safe')).toBe('safe');
    expect(csvCell('a,b')).toBe('"a,b"');
  });
});
