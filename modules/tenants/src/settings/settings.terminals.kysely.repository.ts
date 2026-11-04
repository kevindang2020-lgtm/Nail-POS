// settings.terminals.kysely.repository.ts — production TerminalPairingRepositoryPort over Postgres (Kysely), persisting
// to `pos_payment_terminals` (the table migration 017 created to back this adapter). Scope is ALWAYS (tenant_id,
// branch_id) derived from ctx server-side: EVERY query is filtered by tenant_id (and branch_id when present), so a
// terminal paired by one tenant can never be listed, tested, unpaired, or overwritten by another — the cross-tenant
// isolation guarantee. id is the app-assigned 'term_<code>'; the PK is (tenant_id, id), so the same id under a different
// tenant is a different row and never collides.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { SettingsContext } from './settings.dto';
import type { Terminal, TerminalPairingRepositoryPort, TerminalRegistryEdit } from './settings.integrations';
import { terminalOperationalStatus, TERMINAL_STATUS_LABEL } from '@aipowersalon/api-contracts';   // wave 3 PAYI §12 / §50

const iso = (v: any): string => (v ? new Date(v).toISOString() : '');

/** Phase 14 (live IDOR run): another salon's terminal id (or a stale one) is a 404 client error — the exposed-client-error
 *  convention the platform filter answers as what it is (packages/observability isExposedClientError), never a 500. */
function terminalConflict(code: string, message: string, details?: Record<string, unknown>): Error {
  return Object.assign(new Error(message), { expose: true, status: 409, code, ...(details ? { details } : {}) });
}
function terminalNotFound(): Error {
  return Object.assign(new Error('terminal not found'), { expose: true, status: 404, code: 'TERMINAL_NOT_FOUND' });
}

/** Exactly the columns the terminal view needs (check:response-exposure — never a whole row). */
const TERMINAL_VIEW_COLUMNS = ['id', 'label', 'station_id', 'status', 'paired_at', 'hsn', 'provider', 'terminal_type', 'serial_number', 'connection_type',
  'merchant_account_id', 'last_seen_at', 'last_transaction_at', 'last_ping_at', 'last_ping_ok', 'disabled_at', 'disabled_reason'] as const;

export class KyselyTerminalPairingRepository implements TerminalPairingRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}

  async list(ctx: SettingsContext): Promise<Terminal[]> {
    let q = this.db.selectFrom('pos_payment_terminals').select(TERMINAL_VIEW_COLUMNS).where('tenant_id', '=', ctx.tenantId);
    if (ctx.branchId) q = q.where('branch_id', '=', ctx.branchId);
    const rows = await q.orderBy('paired_at', 'asc').execute().catch(() => [] as any[]);
    const names = await this.registerNames(ctx);
    const leases = await this.liveLeases(ctx);
    return rows.map((r) => this.view(r, names, leases));
  }

  /** wave 3 PAYI §12 / §50: the registry row + the live lease → the ONE normalized status (never a raw Bolt state). */
  private view(r: any, names: Map<string, string>, leases: Map<string, string>, now = new Date()): Terminal {
    const operationalStatus = terminalOperationalStatus({ paired: r.status === 'paired', disabledAt: r.disabled_at, lastSeenAt: r.last_seen_at, lastPingAt: r.last_ping_at, lastPingOk: r.last_ping_ok, leaseHolder: leases.get(String(r.id)) ?? null }, now);
    return {
      id: r.id, label: r.label, stationId: r.station_id || undefined, ...(r.station_id && names.get(String(r.station_id)) ? { registerName: names.get(String(r.station_id)) } : {}),
      status: r.status === 'paired' ? 'paired' : 'unpaired', pairedAt: iso(r.paired_at), ...(r.hsn ? { hsn: String(r.hsn) } : {}),
      provider: r.provider ?? null, terminalType: r.terminal_type ?? null, serialNumber: r.serial_number ?? null, connectionType: r.connection_type ?? null,
      merchantAccountId: r.merchant_account_id ? String(r.merchant_account_id) : null,
      operationalStatus, operationalLabel: TERMINAL_STATUS_LABEL[operationalStatus],
      lastSeenAt: r.last_seen_at ? iso(r.last_seen_at) : null, lastTransactionAt: r.last_transaction_at ? iso(r.last_transaction_at) : null,
      lastPingAt: r.last_ping_at ? iso(r.last_ping_at) : null, lastPingOk: r.last_ping_ok ?? null,
      disabledAt: r.disabled_at ? iso(r.disabled_at) : null, disabledReason: r.disabled_reason ?? null,
    };
  }
  /** terminal id → holder, for the leases that are live right now (migration 485). */
  private async liveLeases(ctx: SettingsContext): Promise<Map<string, string>> {
    const rows: any[] = await sql<any>`SELECT terminal_id, holder FROM payment_terminal_leases WHERE tenant_id = ${ctx.tenantId} AND expires_at > now()`.execute(this.db).then((r) => r.rows).catch(() => []);
    return new Map(rows.map((r) => [String(r.terminal_id), String(r.holder)]));
  }
  private async one(ctx: SettingsContext, id: string): Promise<Terminal | null> {
    let q = this.db.selectFrom('pos_payment_terminals').select(TERMINAL_VIEW_COLUMNS).where('tenant_id', '=', ctx.tenantId).where('id', '=', id);
    if (ctx.branchId) q = q.where('branch_id', '=', ctx.branchId);
    const r = await q.executeTakeFirst().catch(() => undefined);
    if (!r) return null;
    return this.view(r, await this.registerNames(ctx), await this.liveLeases(ctx));
  }
  async get(ctx: SettingsContext, id: string): Promise<Terminal | null> { return this.one(ctx, id); }

  /** wave 3 PAYI §52: rename + registry fields (type / serial / connection). Scoped by tenant (+ branch) like every write. */
  async update(ctx: SettingsContext, id: string, edit: TerminalRegistryEdit): Promise<Terminal> {
    const set: Record<string, unknown> = { updated_at: sql`now()`, updated_by: ctx.userId ?? null };
    if (edit.label !== undefined) set.label = edit.label;
    if (edit.terminalType !== undefined) set.terminal_type = edit.terminalType;
    if (edit.serialNumber !== undefined) set.serial_number = edit.serialNumber;
    if (edit.connectionType !== undefined) set.connection_type = edit.connectionType;
    let u = this.db.updateTable('pos_payment_terminals').set(set).where('tenant_id', '=', ctx.tenantId).where('id', '=', id);
    if (ctx.branchId) u = u.where('branch_id', '=', ctx.branchId);
    const res = await u.executeTakeFirst();
    if (!Number((res as any)?.numUpdatedRows ?? 0)) throw terminalNotFound();
    const t = await this.one(ctx, id); if (!t) throw terminalNotFound(); return t;
  }
  /** §52 / §12: disable keeps the row (its payment history keeps its device) and makes it DISABLED everywhere; enable clears it. */
  async setDisabled(ctx: SettingsContext, id: string, disabled: boolean, reason: string | null): Promise<Terminal> {
    const set = disabled ? { disabled_at: sql`now()`, disabled_by: ctx.userId ?? null, disabled_reason: reason, updated_at: sql`now()`, updated_by: ctx.userId ?? null }
                         : { disabled_at: null, disabled_by: null, disabled_reason: null, updated_at: sql`now()`, updated_by: ctx.userId ?? null };
    if (!disabled) {   // re-enabling must not make a second live terminal on its register
      const row: any = await this.db.selectFrom('pos_payment_terminals').select(['station_id', 'status']).where('tenant_id', '=', ctx.tenantId).where('id', '=', id).executeTakeFirst();
      if (row?.station_id && row.status === 'paired') await this.assertRegisterFree(this.db, ctx, String(row.station_id), id);
    }
    let u = this.db.updateTable('pos_payment_terminals').set(set as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', id);
    if (ctx.branchId) u = u.where('branch_id', '=', ctx.branchId);
    const res = await u.executeTakeFirst();
    if (!Number((res as any)?.numUpdatedRows ?? 0)) throw terminalNotFound();
    const t = await this.one(ctx, id); if (!t) throw terminalNotFound(); return t;
  }
  /** §50: the outcome of a readiness probe — a success is also "last seen". */
  async recordProbe(ctx: SettingsContext, id: string, ok: boolean): Promise<void> {
    await this.db.updateTable('pos_payment_terminals').set((ok ? { last_ping_at: sql`now()`, last_ping_ok: true, last_seen_at: sql`now()` } : { last_ping_at: sql`now()`, last_ping_ok: false }))
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', id).execute().catch(() => undefined);
  }

  async pair(ctx: SettingsContext, pairingCode: string, label: string, stationId?: string, hsn?: string): Promise<Terminal> {
    if (!/^\d{6}$/.test(pairingCode)) throw new Error('pairing code must be 6 digits');
    const id = 'term_' + pairingCode;
    // Payment Terminals guide (Nov 4 2026): pairing used to UPSERT — a code already paired (at this location or another one)
    // was silently taken over, its label, register and location overwritten. A paired terminal is unpaired first; an
    // unpaired one is paired again in place (its payment history keeps the same device id).
    await this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('pos_payment_terminals:' || ${ctx.tenantId}))`.execute(trx);
      const cur: any = await trx.selectFrom('pos_payment_terminals').select(['branch_id', 'status']).where('tenant_id', '=', ctx.tenantId).where('id', '=', id).executeTakeFirst();
      if (cur && cur.status === 'paired') throw terminalConflict('TERMINAL_ALREADY_PAIRED', cur.branch_id && ctx.branchId && String(cur.branch_id) !== ctx.branchId
        ? 'This terminal is paired at another location. Unpair it there first.' : 'This terminal is already paired. Unpair it first to pair it again.');
      if (stationId) await this.assertRegisterFree(trx, ctx, stationId, id);
      await trx.insertInto('pos_payment_terminals')
        .values({ id, tenant_id: ctx.tenantId, branch_id: ctx.branchId || null, label, station_id: stationId || null, status: 'paired', paired_at: sql`now()`, hsn: hsn || null })
        .onConflict((oc: any) => oc.columns(['tenant_id', 'id']).doUpdateSet({ label, station_id: stationId || null, branch_id: ctx.branchId || null, status: 'paired', paired_at: sql`now()`, hsn: hsn || null }).where('pos_payment_terminals.status', '<>', 'paired'))
        .execute();
    });
    return { id, label, stationId, status: 'paired', pairedAt: new Date().toISOString(), ...(hsn ? { hsn } : {}) };
  }
  /** one live terminal per register: a second one made the register's card charge pick a device at random */
  private async assertRegisterFree(exec: Kysely<DB>, ctx: SettingsContext, stationId: string, terminalId: string): Promise<void> {
    const other: any = await exec.selectFrom('pos_payment_terminals').select(['id', 'label']).where('tenant_id', '=', ctx.tenantId).where('station_id', '=', stationId)
      .where('status', '=', 'paired').where('disabled_at', 'is', null).where('id', '<>', terminalId).executeTakeFirst();
    if (other) throw terminalConflict('TERMINAL_REGISTER_TAKEN', `This register already uses terminal "${other.label ?? other.id}". Move or disable that one first.`, { terminalId: String(other.id) });
  }

  /** This location's live registers (pos_stations), id → name. */
  private async registerNames(ctx: SettingsContext): Promise<Map<string, string>> {
    if (!ctx.branchId) return new Map();
    const rows: any[] = await sql<any>`SELECT id::text AS id, name FROM pos_stations WHERE tenant_id = ${ctx.tenantId} AND branch_id = ${ctx.branchId} AND retired_at IS NULL`.execute(this.db).then((r) => r.rows).catch(() => []);
    return new Map(rows.map((r) => [String(r.id), String(r.name)]));
  }
  async registerName(ctx: SettingsContext, stationId: string): Promise<string | null> { return (await this.registerNames(ctx)).get(stationId) ?? null; }
  /** Oct 6 2026: tie a terminal to one of this location's registers (the register's card charges then use it). */
  async setRegister(ctx: SettingsContext, id: string, stationId: string | null): Promise<Terminal> {
    const res = await this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('pos_payment_terminals:' || ${ctx.tenantId}))`.execute(trx);
      if (stationId) await this.assertRegisterFree(trx, ctx, stationId, id);
      let u = trx.updateTable('pos_payment_terminals').set({ station_id: stationId }).where('tenant_id', '=', ctx.tenantId).where('id', '=', id);
      if (ctx.branchId) u = u.where('branch_id', '=', ctx.branchId);
      return u.executeTakeFirst();
    });
    if (!Number((res as any)?.numUpdatedRows ?? 0)) throw terminalNotFound();
    const t = (await this.list(ctx)).find((x) => x.id === id);
    if (!t) throw terminalNotFound();
    return t;
  }

  async unpair(ctx: SettingsContext, id: string): Promise<{ id: string; status: 'unpaired' }> {
    let u = this.db.updateTable('pos_payment_terminals').set({ status: 'unpaired' }).where('tenant_id', '=', ctx.tenantId).where('id', '=', id);
    if (ctx.branchId) u = u.where('branch_id', '=', ctx.branchId);
    const res = await u.executeTakeFirst();
    const affected = Number(res?.numUpdatedRows ?? 0);
    if (!affected) throw terminalNotFound();
    return { id, status: 'unpaired' };
  }

  /** The pairing-state check only. The REAL readiness probe (Bolt ping through the provider router) is the service's
   *  job with the TerminalProbePort apps/api supplies — this never claims "responding" on its own (§166). */
  async test(ctx: SettingsContext, id: string): Promise<{ id: string; reachable: boolean; detail: string }> {
    let s = this.db.selectFrom('pos_payment_terminals').select(['status', 'disabled_at']).where('tenant_id', '=', ctx.tenantId).where('id', '=', id);
    if (ctx.branchId) s = s.where('branch_id', '=', ctx.branchId);
    const row = await s.executeTakeFirst();
    if (!row) throw terminalNotFound();
    if (row.disabled_at) return { id, reachable: false, detail: 'terminal is disabled' };
    const paired = row.status === 'paired';
    return { id, reachable: false, detail: paired ? 'terminal paired — readiness not probed' : 'terminal not paired' };
  }
}
