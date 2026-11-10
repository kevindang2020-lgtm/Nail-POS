// receipt-printers.pgtest — batch 8 decision 2 (Nov 9 2026) on the REAL schema: printer RECORDS (add / assign / disable /
// retire), audited, tenant-scoped; the fleet's receipt class lists them and never claims one is online.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ReceiptPrinters, PrinterError } from './receipt-printers';
import { DeviceFleetCenter } from './device-fleet-center';
import { RecordingAuditSink } from '@aipowersalon/audit';

const P = 'c8480000-0000-4000-8000-'; const id = (n: number) => P + String(n).padStart(12, '0');
const T = id(1), X = id(2), B = id(3), BX = id(4), S1 = id(5), SX = id(6), U = id(7);
const ctx = { tenantId: T, branchId: B, userId: U, role: 'OWNER' };
let db: any; let pr: ReceiptPrinters; let fc: DeviceFleetCenter; const sink = new RecordingAuditSink();
const q = async (s: any) => (await s.execute(db)).rows as any[];

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  pr = new ReceiptPrinters(db, sink); fc = new DeviceFleetCenter(db);
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'S', 'Pilot', 'rp-848', 'RP848', 'active'), (${X}, 'X', 'Other', 'rp-848x', 'RP848X', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name) values (${B}, ${T}, 'Main'), (${BX}, ${X}, 'Other')`);
  await q(sql`insert into pos_stations (id, tenant_id, branch_id, name) values (${S1}, ${T}, ${B}, 'Front Desk 1'), (${SX}, ${X}, ${BX}, 'Theirs')`);
});

describe('receipt printers', () => {
  it('adds a printer at a register, audited, and the fleet lists it as a record (never online)', async () => {
    const p = await pr.create(ctx, { name: 'Epson TM-m30', connection: 'network', address: '192.168.1.40', paperWidthMm: 80, posStationId: S1 });
    expect(p).toMatchObject({ name: 'Epson TM-m30', status: 'active', branchId: B, posStationId: S1 });
    expect(sink.entries.at(-1)).toMatchObject({ tenantId: T, module: 'devices', action: 'receipt_printer_added', resourceType: 'receipt_printer', resourceId: p.id });
    // the printer's own history reads the canonical audit_events
    await q(sql`insert into audit_events (tenant_id, branch_id, occurred_at, actor_user_id, actor_role, actor_name, module, action, resource_type, resource_id, status, severity, metadata)
      values (${T}, ${B}, now(), ${U}, 'OWNER', 'Kevin', 'devices', 'receipt_printer_added', 'receipt_printer', ${p.id}, 'success', 'info', '{}'::jsonb)`);
    const h = await fc.history({ ...ctx, permissions: [] } as any, { class: 'receipt', deviceId: p.id });
    expect(h.items.map((x) => x.event)).toEqual(['receipt_printer_added']);
    const list = await fc.list({ ...ctx, permissions: [] } as any, { class: 'receipt', page: 1, pageSize: 25 });
    expect(list.items.map((d) => [d.name, d.status, d.reason, d.station])).toEqual([['Epson TM-m30', 'unknown', 'NO_PRINT_BRIDGE', 'Front Desk 1']]);
    const s = await fc.summary({ ...ctx, permissions: [] } as any, 'receipt');
    expect(s.registered).toBe(1); expect(s.online).toBe(0); expect(s.extra.printerRegistry).toBe('records_only');
  });
  it('refuses another salon’s register', async () => {
    await expect(pr.create(ctx, { name: 'Bad', connection: 'usb', posStationId: SX })).rejects.toBeInstanceOf(PrinterError);
  });
  it('disables, retires, and then refuses changes', async () => {
    const p = await pr.create(ctx, { name: 'Back printer', connection: 'usb', paperWidthMm: 58 });
    expect((await pr.update(ctx, p.id, { status: 'disabled' })).status).toBe('disabled');
    expect((await pr.retire(ctx, p.id)).status).toBe('retired');
    await expect(pr.update(ctx, p.id, { name: 'x' })).rejects.toThrow(/retired/);
    await expect(pr.retire({ ...ctx, tenantId: X, branchId: BX }, p.id)).rejects.toBeInstanceOf(PrinterError);
  });
});
