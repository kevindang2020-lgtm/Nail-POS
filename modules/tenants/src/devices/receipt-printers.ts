// receipt-printers.ts — batch 8 decision 2 (Nov 9 2026): add / edit / disable / retire the salon's receipt-printer
// RECORDS (receipt_printers, migration 844). The list, filters and history are the device fleet's (class 'receipt').
// Nothing here prints or claims a printer is reachable: there is no print bridge on the devices yet.
import { Body, Controller, HttpException, HttpStatus, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { S, type BodySchema } from '@aipowersalon/permissions';
import { withCode } from '@aipowersalon/api-contracts';
import type { ReceiptPrinter } from '@aipowersalon/api-contracts/tenant';
import { sql } from 'kysely';
import type { AuditSink } from '@aipowersalon/audit';

export const RECEIPT_PRINTERS = 'ReceiptPrinters';
const CONNECTIONS = ['network', 'usb', 'bluetooth', 'cloud'] as const;
const fields = {
  name: S.text(80, { minLength: 1 }), connection: S.enumOf([...CONNECTIONS]), address: S.nullable(S.text(120)),
  paperWidthMm: S.enumOf([58, 80]), posStationId: S.nullable(S.uuid()), branchId: S.nullable(S.uuid()),
};
export const PRINTER_CREATE_BODY: BodySchema = S.object(fields, ['name', 'connection']);
export const PRINTER_UPDATE_BODY: BodySchema = S.object({ ...fields, status: S.enumOf(['active', 'disabled']) });
export const PRINTER_RETIRE_BODY: BodySchema = S.object({});

export class PrinterError extends Error { constructor(readonly status: number, message: string) { super(message); } }
export interface PrinterCtx { tenantId: string; branchId: string; userId: string | null; role?: string }
type Input = { name?: string; connection?: string; address?: string | null; paperWidthMm?: number; posStationId?: string | null; branchId?: string | null; status?: string };

// the columns a printer response needs — never a whole-row read
const COLS = sql.raw('id, name, connection, address, paper_width_mm, status, branch_id, pos_station_id, created_at, updated_at');
const toApi = (r: any): ReceiptPrinter => ({ id: String(r.id), name: String(r.name), connection: r.connection, address: r.address ?? null, paperWidthMm: Number(r.paper_width_mm),
  status: r.status, branchId: r.branch_id ? String(r.branch_id) : null, posStationId: r.pos_station_id ? String(r.pos_station_id) : null,
  createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString() });

export class ReceiptPrinters {
  constructor(private readonly db: any, private readonly audit: AuditSink | null = null) {}

  /** a register / branch must be this salon's own (never another tenant's id from the client) */
  private async place(ctx: PrinterCtx, i: Input, trx: any): Promise<{ branchId: string | null; stationId: string | null }> {
    let branchId = i.branchId === undefined ? (ctx.branchId || null) : i.branchId;
    const stationId = i.posStationId ?? null;
    if (stationId) {
      const st = (await sql<{ branch_id: string | null }>`SELECT branch_id FROM pos_stations WHERE id = ${stationId}::uuid AND tenant_id = ${ctx.tenantId}::uuid AND retired_at IS NULL`.execute(trx)).rows[0];
      if (!st) throw withCode(new PrinterError(404, 'That register is not one of this salon’s.'), 'RESOURCE_NOT_FOUND');
      branchId = st.branch_id ? String(st.branch_id) : branchId;
    }
    if (branchId) {
      const b = (await sql`SELECT 1 FROM branches WHERE id = ${branchId}::uuid AND tenant_id = ${ctx.tenantId}::uuid AND deleted_at IS NULL`.execute(trx)).rows[0];
      if (!b) throw withCode(new PrinterError(404, 'That location is not one of this salon’s.'), 'RESOURCE_NOT_FOUND');
    }
    return { branchId, stationId };
  }
  /** the canonical audit (AuditService → audit_events), after the change is committed */
  private async record(ctx: PrinterCtx, action: string, p: ReceiptPrinter, meta: Record<string, unknown>) {
    await this.audit?.record({ tenantId: ctx.tenantId, branchId: ctx.branchId || null, userId: ctx.userId, role: ctx.role ?? null,
      module: 'devices', action, resourceType: 'receipt_printer', resourceId: p.id, summary: p.name, metadata: meta });
  }

  async create(ctx: PrinterCtx, i: Input): Promise<ReceiptPrinter> {
    const out: ReceiptPrinter = await this.db.transaction().execute(async (trx: any) => {
      const pl = await this.place(ctx, i, trx);
      const r = (await sql<any>`INSERT INTO receipt_printers (tenant_id, branch_id, pos_station_id, name, connection, address, paper_width_mm, updated_by)
          VALUES (${ctx.tenantId}::uuid, ${pl.branchId}, ${pl.stationId}, ${String(i.name).trim()}, ${i.connection}, ${i.address ?? null}, ${i.paperWidthMm ?? 80}, ${ctx.userId})
          RETURNING ${COLS}`.execute(trx)).rows[0];
      return toApi(r);
    });
    await this.record(ctx, 'receipt_printer_added', out, { connection: out.connection, stationId: out.posStationId });
    return out;
  }

  async update(ctx: PrinterCtx, id: string, i: Input): Promise<ReceiptPrinter> {
    const out: ReceiptPrinter = await this.db.transaction().execute(async (trx: any) => {
      const cur = (await sql<any>`SELECT ${COLS} FROM receipt_printers WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid FOR UPDATE`.execute(trx)).rows[0];
      if (!cur) throw withCode(new PrinterError(404, 'That printer is not one of this salon’s.'), 'RESOURCE_NOT_FOUND');
      if (cur.status === 'retired') throw withCode(new PrinterError(409, 'A retired printer cannot be changed.'), 'PRINTER_RETIRED');
      const pl = i.posStationId !== undefined || i.branchId !== undefined ? await this.place(ctx, { posStationId: i.posStationId ?? null, branchId: i.branchId ?? cur.branch_id }, trx)
        : { branchId: cur.branch_id, stationId: cur.pos_station_id };
      const r = (await sql<any>`UPDATE receipt_printers SET name = ${i.name !== undefined ? String(i.name).trim() : cur.name}, connection = ${i.connection ?? cur.connection},
          address = ${i.address !== undefined ? i.address : cur.address}, paper_width_mm = ${i.paperWidthMm ?? cur.paper_width_mm}, status = ${i.status ?? cur.status},
          branch_id = ${pl.branchId}, pos_station_id = ${pl.stationId}, updated_at = now(), updated_by = ${ctx.userId}
        WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid RETURNING ${COLS}`.execute(trx)).rows[0];
      return toApi(r);
    });
    await this.record(ctx, 'receipt_printer_updated', out, { changed: Object.keys(i) });
    return out;
  }

  async retire(ctx: PrinterCtx, id: string): Promise<ReceiptPrinter> {
    const out: ReceiptPrinter = await this.db.transaction().execute(async (trx: any) => {
      const r = (await sql<any>`UPDATE receipt_printers SET status = 'retired', retired_at = now(), pos_station_id = NULL, updated_at = now(), updated_by = ${ctx.userId}
          WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid AND status <> 'retired' RETURNING ${COLS}`.execute(trx)).rows[0];
      if (!r) throw withCode(new PrinterError(404, 'That printer is not one of this salon’s, or it is already retired.'), 'RESOURCE_NOT_FOUND');
      return toApi(r);
    });
    await this.record(ctx, 'receipt_printer_retired', out, {});
    return out;
  }
}

function ctxFrom(req: any): PrinterCtx { const c = req?.ctx || {}; return { tenantId: String(c.tenantId || ''), branchId: String(c.branchId || ''), userId: c.userId ?? null, role: c.role }; }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) { if (e instanceof PrinterError) throw new HttpException({ code: (e as PrinterError & { apiCode?: string }).apiCode, message: e.message }, e.status); throw e; }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/receipt-printers')
export class ReceiptPrintersController {
  constructor(@Inject(RECEIPT_PRINTERS) private readonly p: ReceiptPrinters | null) {}
  private svc(): ReceiptPrinters { if (!this.p) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Printers need the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.p; }

  @Post('') @RequirePermission('pos.devices.manage')
  create(@Req() r: any, @Body(ValidatedBody(PRINTER_CREATE_BODY, { strict: true })) b: Input): Promise<ReceiptPrinter> { return run(() => this.svc().create(ctxFrom(r), b)); }

  @Patch(':id') @RequirePermission('pos.devices.manage')
  update(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PRINTER_UPDATE_BODY, { strict: true })) b: Input): Promise<ReceiptPrinter> { return run(() => this.svc().update(ctxFrom(r), id, b)); }

  @Post(':id/retire') @RequirePermission('pos.devices.manage')
  retire(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PRINTER_RETIRE_BODY, { strict: true })) _b: Record<string, never>): Promise<ReceiptPrinter> { return run(() => this.svc().retire(ctxFrom(r), id)); }
}
