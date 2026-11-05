import { describe, it, expect } from 'vitest';
import { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { SuperAdminSettlementsController } from './super-admin-settlements.controller';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { SettlementsActionsService } from './settlements-actions.service';

function routesOf(ctrl: any) {
  const proto = ctrl.prototype;
  const method = (m: number) => RequestMethod[m] ?? String(m);
  return Object.getOwnPropertyNames(proto)
    .filter((nm) => nm !== 'constructor' && typeof proto[nm] === 'function' && Reflect.getMetadata(PATH_METADATA, proto[nm]) !== undefined)
    .map((nm) => ({ name: nm, path: String(Reflect.getMetadata(PATH_METADATA, proto[nm])), method: method(Reflect.getMetadata(METHOD_METADATA, proto[nm])) }));
}

// Routes must never mutate ORIGINAL processor/bank amounts — no charge/capture/void/refund/fee/gross/adjust endpoints.
const FORBIDDEN = [/charge/i, /capture/i, /\bvoid\b/i, /refund/i, /\bfee/i, /gross/i, /adjust/i, /checkout/i, /delete/i, /amount/i];

describe('Settlements & Deposits — backend boundary', () => {
  const routes = routesOf(SuperAdminSettlementsController);

  it('is SuperAdminGuard-gated', () => {
    expect((Reflect.getMetadata(GUARDS_METADATA, SuperAdminSettlementsController) ?? [])).toContain(SuperAdminGuard);
  });

  it('exposes only overview + oversight actions — no amount-mutation routes', () => {
    const expected = new Set(['overview', ':id/notes', ':id/match-deposit', ':id/resolve', ':id/processor-case', 'export', 'export-xlsx', 'export-pdf']);
    expect(new Set(routes.map((r) => r.path))).toEqual(expected);
    for (const r of routes) for (const pat of FORBIDDEN) expect(`${r.name} ${r.path}`).not.toMatch(pat);
  });

  it('reads are GET; write-actions are POST', () => {
    const byPath = Object.fromEntries(routes.map((r) => [r.path, r.method]));
    for (const p of ['overview', 'export', 'export-xlsx', 'export-pdf']) expect(byPath[p]).toBe('GET');
    for (const p of [':id/notes', ':id/match-deposit', ':id/resolve', ':id/processor-case']) expect(byPath[p]).toBe('POST');
  });
});

// export tests via a fake service (no DB) — assert masked funding, real binaries, formula guard, audit-skip when db null
const fakeRows = [
  { id: 'x1', batchRef: 'BCH-1', tenantName: 'Glamour Studio', branchName: 'Downtown', processor: 'fiserv', grossCents: 2681235, refundsCents: 102540, chargebacksCents: 24500, feesCents: 56215, adjustmentsCents: 0, netCents: 2497980, expectedNetCents: 2497980, actualDepositCents: 2497980, expectedDepositDate: '2026-05-06', actualDepositDate: '2026-05-06', fundingMasked: '•••• 7890', settlementStatus: 'settled', reconciliationStatus: 'reconciled', differenceCents: 0, transactionCount: 412, tenantId: 't', branchId: 'b' },
  { id: 'x2', batchRef: '=cmd()', tenantName: 'Luxe', branchName: 'Main', processor: 'clover', grossCents: 100, refundsCents: 0, chargebacksCents: 0, feesCents: 0, adjustmentsCents: 0, netCents: 100, expectedNetCents: 100, actualDepositCents: null, expectedDepositDate: null, actualDepositDate: null, fundingMasked: '•••• 4567', settlementStatus: 'pending', reconciliationStatus: 'pending', differenceCents: null, transactionCount: 1, tenantId: 't', branchId: 'b' },
];
const fakeSvc = { parseFilters: (q: any) => q, getOverview: async () => ({ batches: { rows: fakeRows } }) } as any;
const actions = () => new SettlementsActionsService(null, { createTicket: async () => ({ ok: true }) } as any, fakeSvc, {} as any);

describe('Settlements exports', () => {
  it('CSV masks funding, guards formulas, includes all rows', async () => {
    const out = await actions().exportCsv({ userId: 'u' }, {});
    expect(out.contentType).toContain('text/csv');
    expect(out.body).toContain('•••• 7890');
    expect(out.body).toContain("'=cmd()");           // formula-injection neutralized
    expect(out.body).not.toMatch(/\b\d{8,}\b/);       // never a full account number
  });
  it('XLSX is a real workbook (PK magic)', async () => {
    const out = await actions().exportXlsx({ userId: 'u' }, {});
    expect(out.buffer[0]).toBe(0x50); expect(out.buffer[1]).toBe(0x4b);
    expect(out.contentType).toContain('spreadsheetml.sheet');
  });
  it('PDF is a real document (%PDF magic)', async () => {
    const out = await actions().exportPdf({ userId: 'u' }, {});
    expect(out.buffer.slice(0, 4).toString('latin1')).toBe('%PDF');
    expect(out.contentType).toBe('application/pdf');
  });
});
