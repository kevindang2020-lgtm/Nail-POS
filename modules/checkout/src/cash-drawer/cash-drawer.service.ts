// cash-drawer.service.ts — orchestration + auth scoping + realtime for front-desk drawer reconciliation.
// The drawer belongs to the front desk's branch (derived from the session), never a client-supplied branch.
import { RealtimeEmitter, EVENTS, type EventName } from '@aipowersalon/realtime-contracts';
import { CashDrawerRepository, DrawerCtx } from './cash-drawer.repository';
import { hasPermission } from '@aipowersalon/permissions';
import { DrawerState, DRAWER_EVENTS, OwnerDrawerSummary, MovementList, CashDrawerError, normDate, isUuid } from './cash-drawer.dto';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English
import { utcDate } from '@aipowersalon/date-time';

/** D15 gaps (Nov 5 2026): a count off by more than this (either way) is marked for a manager's review */
export const DRAWER_REVIEW_LIMIT_CENTS = 2000;
/** US bills and coins, in cents */
export const DRAWER_DENOMINATIONS = [10000, 5000, 2000, 1000, 500, 200, 100, 50, 25, 10, 5, 1] as const;
/** the breakdown a counter entered: known values only, whole counts, and its total must be the counted cash */
export function cleanDenominations(raw: unknown, countedCents: number): Record<string, number> | null {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw withCode(new CashDrawerError('bad_denominations', 'The bill and coin breakdown is not valid.', 400), 'DRAWER_DENOMINATIONS_MISMATCH');
  const out: Record<string, number> = {}; let total = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const value = Number(k), n = Number(v);
    if (!(DRAWER_DENOMINATIONS as readonly number[]).includes(value) || !Number.isInteger(n) || n < 0) throw withCode(new CashDrawerError('bad_denominations', 'The bill and coin breakdown is not valid.', 400), 'DRAWER_DENOMINATIONS_MISMATCH');
    if (n > 0) { out[String(value)] = n; total += value * n; }
  }
  if (total !== countedCents) throw withCode(new CashDrawerError('bad_denominations', 'The bills and coins do not add up to the counted cash.', 400), 'DRAWER_DENOMINATIONS_MISMATCH');
  return out;
}

export class CashDrawerService {
  constructor(private readonly repo: CashDrawerRepository, private readonly realtime?: RealtimeEmitter) {}

  private toTenant(ctx: DrawerCtx, event: EventName, payload: any) { try { this.realtime?.toTenant({ tenantId: ctx.tenantId, branchId: ctx.branchId ?? undefined } as any, event, payload); } catch { /* bus must not break actions */ } }
  /** Constitution 9: an owner alert ROW was written — owner clients must refetch alerts/dashboard. `owner_alert_updated`
   *  was already emitted on status change; the CREATE side was silent, so a new cash alert never reached an open Owner App. */
  private ownerAlert(ctx: DrawerCtx, code: string): void { try { this.realtime?.toOwner(ctx.tenantId, EVENTS.ownerAlertCreated, { code }); } catch { /* best-effort */ } }
  // BUILD_PLAN Phase 9 (Constitution 2 audit bug 6): no OWNER / SUPER_ADMIN shortcut. An owner's session carries every
  // tenant capability, so the permission alone admits them — and a DENY on the owner-level template now means something.
  // (Super Admin never reaches a /pos or /tech route: its session is refused outside the platform realm.)
  private has(ctx: DrawerCtx, perm: string) { return hasPermission(ctx as any, perm); }
  private canView(ctx: DrawerCtx) { return this.has(ctx, 'pos.reports.view') || this.has(ctx, 'pos.checkout.take_payment') || (!!ctx.tenantId && !!ctx.userId); }
  /** Today at the branch (the salon, for the owner's salon-wide view) — the date a drawer defaults to. */
  private async today(ctx: DrawerCtx): Promise<string | undefined> { try { return await this.repo.today?.(ctx); } catch { return undefined; } }
  private branchOf(ctx: DrawerCtx): string {
    if (!isUuid(ctx.branchId)) throw withCode(new CashDrawerError('no_branch', 'No register branch is set for this session.', 400), 'REGISTER_BRANCH_REQUIRED');
    return ctx.branchId as string;
  }
  private amount(body: any, field = 'countedCents'): number {
    const v = Math.round(Number(body?.[field]));
    if (!Number.isFinite(v) || v < 0) throw withCode(new CashDrawerError('bad_amount', `Enter ${field === 'openingFloatCents' ? 'the opening float' : 'the counted cash'} in cents (0 or more).`, 400), 'DRAWER_AMOUNT_INVALID');
    return v;
  }

  /** Owner read-only salon-wide summary (tenant-scoped server-side; branch param is irrelevant for owners). */
  async ownerList(ctx: DrawerCtx, date?: string): Promise<OwnerDrawerSummary> {
    if (!this.canView(ctx)) throw withCode(new CashDrawerError('forbidden', 'Not allowed.', 403), 'PERMISSION_DENIED');
    return this.repo.ownerList(ctx, normDate(date, await this.today({ ...ctx, branchId: null })));
  }

  /** D15 (Nov 4 2026): the registers this location keeps a drawer for (its stations + 'main' for cash with no station). */
  async registers(ctx: DrawerCtx): Promise<{ registers: Array<{ registerId: string; name: string }> }> {
    if (!this.canView(ctx)) throw withCode(new CashDrawerError('forbidden', 'Not allowed.', 403), 'PERMISSION_DENIED');
    return { registers: await this.repo.registers(ctx, this.branchOf(ctx)) };
  }

  /** D15 (Nov 4 2026): a drawer is 'main' or one of this location's registers — never another location's station. */
  private async registerOf(ctx: DrawerCtx, branchId: string, raw: unknown): Promise<string> {
    const id = typeof raw === 'string' && raw ? raw : 'main';
    if (id === 'main') return id;
    const known = await this.repo.registers(ctx, branchId);
    if (!known.some((r) => r.registerId === id)) throw withCode(new CashDrawerError('bad_request', 'That register is not at this location.', 400), 'REGISTER_NOT_IN_BRANCH');
    return id;
  }

  async getDrawer(ctx: DrawerCtx, date?: string, registerId = 'main'): Promise<DrawerState> {
    if (!this.canView(ctx)) throw withCode(new CashDrawerError('forbidden', 'Not allowed.', 403), 'PERMISSION_DENIED');
    const branchId = this.branchOf(ctx);
    return this.repo.state(ctx, branchId, await this.registerOf(ctx, branchId, registerId), normDate(date, await this.today(ctx)));
  }

  async openDrawer(ctx: DrawerCtx, body: any): Promise<DrawerState> {
    if (!this.has(ctx, 'pos.checkout.take_payment')) throw withCode(new CashDrawerError('forbidden', 'You do not have permission to manage the drawer.', 403), 'DRAWER_PERMISSION_DENIED');
    const branchId = this.branchOf(ctx);
    const registerId = await this.registerOf(ctx, branchId, body?.registerId);
    const d = normDate(body?.date, await this.today(ctx));
    const floatCents = this.amount(body, 'openingFloatCents');
    await this.repo.open(ctx, branchId, registerId, d, floatCents);
    await this.repo.audit(ctx, 'cash_drawer_opened', branchId, { businessDate: d, openingFloatCents: floatCents, registerId });
    // §343: the repository recorded this in the drawer's transaction; the projection delivers it when the publisher is on
    if (!this.repo.emitsDomainEvents?.()) this.toTenant(ctx, DRAWER_EVENTS.opened, { branchId, registerId, businessDate: d, openingFloatCents: floatCents });
    return this.repo.state(ctx, branchId, registerId, d);
  }

  async addMovement(ctx: DrawerCtx, body: any): Promise<DrawerState> {
    if (!this.has(ctx, 'pos.checkout.take_payment')) throw withCode(new CashDrawerError('forbidden', 'You do not have permission to adjust the drawer.', 403), 'DRAWER_PERMISSION_DENIED');
    const branchId = this.branchOf(ctx);
    const d = normDate(body?.date, await this.today(ctx));
    const direction = body?.direction === 'in' ? 'in' : body?.direction === 'out' ? 'out' : null;
    if (!direction) throw withCode(new CashDrawerError('bad_direction', 'Specify cash in or cash out.', 400), 'DRAWER_DIRECTION_REQUIRED');
    const amount = Math.round(Number(body?.amountCents));
    if (!Number.isFinite(amount) || amount <= 0) throw withCode(new CashDrawerError('bad_amount', 'Enter an amount greater than zero (in cents).', 400), 'AMOUNT_MUST_BE_POSITIVE');
    const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 80) : null;
    const note = typeof body?.note === 'string' ? body.note.slice(0, 300) : null;
    const registerId = await this.registerOf(ctx, branchId, body?.registerId);
    try { await this.repo.addMovement(ctx, branchId, registerId, d, direction, amount, reason, note); }
    catch (e: any) { if (e?.drawerCode === 'DRAWER_ALREADY_COUNTED') throw withCode(new CashDrawerError('already_counted', e.message, 409), 'DRAWER_ALREADY_COUNTED'); throw e; }
    await this.repo.audit(ctx, 'cash_drawer_movement', branchId, { businessDate: d, direction, amountCents: amount, reason, registerId });
    // §343: the repository recorded this in the drawer's transaction; the projection delivers it when the publisher is on
    if (!this.repo.emitsDomainEvents?.()) this.toTenant(ctx, DRAWER_EVENTS.movement, { branchId, registerId, businessDate: d, direction, amountCents: amount });
    return this.repo.state(ctx, branchId, registerId, d);
  }

  async voidMovement(ctx: DrawerCtx, body: any): Promise<DrawerState> {
    if (!this.has(ctx, 'pos.checkout.take_payment')) throw withCode(new CashDrawerError('forbidden', 'You do not have permission to adjust the drawer.', 403), 'DRAWER_PERMISSION_DENIED');
    const branchId = this.branchOf(ctx);
    const id = typeof body?.movementId === 'string' ? body.movementId : '';
    if (!id) throw withCode(new CashDrawerError('bad_request', 'Specify the movement to void.', 400), 'DRAWER_MOVEMENT_REQUIRED');
    const d = normDate(body?.date, await this.today(ctx));
    const registerId = await this.registerOf(ctx, branchId, body?.registerId);
    const ok = await this.repo.voidMovement(ctx, id);
    if (ok) {
      await this.repo.audit(ctx, 'cash_drawer_movement_void', branchId, { movementId: id, businessDate: d, registerId });
      // §343: the repository recorded this in the drawer's transaction; the projection delivers it when the publisher is on
      if (!this.repo.emitsDomainEvents?.()) this.toTenant(ctx, DRAWER_EVENTS.movement, { branchId, registerId, businessDate: d, voidedMovementId: id });
    }
    return this.repo.state(ctx, branchId, registerId, d);
  }

  async listMovements(ctx: DrawerCtx, date?: string, registerId = 'main'): Promise<MovementList> {
    if (!this.canView(ctx)) throw withCode(new CashDrawerError('forbidden', 'Not allowed.', 403), 'PERMISSION_DENIED');
    const branchId = this.branchOf(ctx);
    const d = normDate(date, await this.today(ctx));
    return { businessDate: d, movements: await this.repo.listMovements(ctx, branchId, await this.registerOf(ctx, branchId, registerId), d) };
  }

  async reconcileDrawer(ctx: DrawerCtx, body: any): Promise<DrawerState> {
    if (!this.has(ctx, 'pos.checkout.take_payment')) throw withCode(new CashDrawerError('forbidden', 'You do not have permission to reconcile the drawer.', 403), 'DRAWER_PERMISSION_DENIED');
    const branchId = this.branchOf(ctx);
    const registerId = await this.registerOf(ctx, branchId, body?.registerId);
    const d = normDate(body?.date, await this.today(ctx));
    const counted = this.amount(body, 'countedCents');
    const notes = typeof body?.notes === 'string' ? body.notes.slice(0, 500) : null;
    const denominations = cleanDenominations(body?.denominations, counted);
    const seen = body?.expectedCashCents == null || body.expectedCashCents === '' ? null : Math.round(Number(body.expectedCashCents));
    const r = await this.repo.reconcile(ctx, branchId, registerId, d, counted, notes, { seenExpectedCents: Number.isFinite(seen as number) ? seen : null, denominations, reviewLimitCents: DRAWER_REVIEW_LIMIT_CENTS });
    if (r.changed) throw withCode(new CashDrawerError('changed', 'The expected cash changed since you started counting (a sale, refund or cash in/out). Check the new figure and count again.', 409), 'DRAWER_CHANGED_SINCE_SHOWN');
    await this.repo.audit(ctx, 'cash_drawer_reconciled', branchId, { businessDate: d, registerId, expectedCashCents: r.expectedCashCents, countedCents: counted, varianceCents: r.varianceCents, status: r.status, denominations: denominations ?? null, approvalRequired: !!r.approvalRequired });
    // §343: the repository recorded this in the drawer's transaction; the projection delivers it when the publisher is on
    if (!this.repo.emitsDomainEvents?.()) this.toTenant(ctx, r.status === 'discrepancy' ? DRAWER_EVENTS.discrepancy : DRAWER_EVENTS.reconciled, { branchId, registerId, businessDate: d, expectedCashCents: r.expectedCashCents, countedCents: counted, varianceCents: r.varianceCents, status: r.status });
    if (!r.applied) throw withCode(new CashDrawerError('not_allowed', 'This drawer cannot be counted in its current state.', 409), 'DRAWER_COUNT_NOT_ALLOWED');
    if (r.status === 'discrepancy') {
      const usd = (n: number) => '$' + (Math.abs(n) / 100).toFixed(2);
      await this.repo.alert(ctx, 'warning', 'Cash drawer discrepancy',
        `Register ${registerId} drawer is ${r.varianceCents > 0 ? 'over' : 'short'} ${usd(r.varianceCents)} — counted ${usd(counted)} vs ${usd(r.expectedCashCents)} expected (float ${usd(r.openingFloatCents)} + sales ${usd(r.salesCents)} − refunds ${usd(r.refundsCents)}) on ${d}.`,
        branchId, { branchId, registerId, businessDate: d, expectedCashCents: r.expectedCashCents, countedCents: counted, varianceCents: r.varianceCents });
    this.ownerAlert(ctx, 'Cash drawer discrepancy');
    }
    return this.repo.state(ctx, branchId, registerId, d);
  }

  /** D15 gaps (Nov 5 2026): a manager signs off a counted drawer that is off by more than the review limit */
  async approveCount(ctx: DrawerCtx, body: any): Promise<DrawerState> {
    if (!this.has(ctx, 'checkout.manage_overrides')) throw withCode(new CashDrawerError('forbidden', 'A manager signs off a drawer count.', 403), 'DRAWER_PERMISSION_DENIED');
    const branchId = this.branchOf(ctx);
    const registerId = await this.registerOf(ctx, branchId, body?.registerId);
    const d = normDate(body?.date, await this.today(ctx));
    const note = String(body?.note ?? '').trim().slice(0, 500);
    if (note.length < 3) throw withCode(new CashDrawerError('bad_request', 'Add a note for the sign-off.', 400), 'DRAWER_APPROVAL_NOTE_REQUIRED');
    if (!(await this.repo.approve(ctx, branchId, registerId, d, note))) throw withCode(new CashDrawerError('not_needed', 'This drawer count has nothing waiting for sign-off.', 409), 'DRAWER_APPROVAL_NOT_NEEDED');
    await this.repo.audit(ctx, 'cash_drawer_count_approved', branchId, { businessDate: d, registerId, note });
    return this.repo.state(ctx, branchId, registerId, d);
  }

  /** D15 gaps (Nov 5 2026): the drawer history of this location (server-paged, filtered, searched) */
  async history(ctx: DrawerCtx, q: any) {
    if (!this.canView(ctx)) throw withCode(new CashDrawerError('forbidden', 'Not allowed.', 403), 'PERMISSION_DENIED');
    const branchId = this.branchOf(ctx);
    const ymd = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const registerId = typeof q?.registerId === 'string' && q.registerId ? await this.registerOf(ctx, branchId, q.registerId) : undefined;
    const pageSize = [10, 20, 50].includes(Number(q?.pageSize)) ? Number(q.pageSize) : 10;
    return this.repo.history(ctx, branchId, { from: ymd(q?.from), to: ymd(q?.to), registerId, status: typeof q?.status === 'string' ? q.status : undefined, q: typeof q?.q === 'string' ? q.q : undefined, page: Math.max(1, parseInt(q?.page, 10) || 1), pageSize });
  }

  /** Cash Drawer Activity (SUNMI addendum §08–§09): one register's cash events over a period of business days — the session
   *  day by default, or today / week / month / year / custom — searched by customer, phone, #ticket, employee or reason. */
  async activity(ctx: DrawerCtx, q: any) {
    if (!this.canView(ctx)) throw withCode(new CashDrawerError('forbidden', 'Not allowed.', 403), 'PERMISSION_DENIED');
    const branchId = this.branchOf(ctx);
    const registerId = await this.registerOf(ctx, branchId, typeof q?.registerId === 'string' && q.registerId ? q.registerId : 'main');
    const ymd = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const today = await this.repo.today(ctx);
    const preset = ['session', 'today', 'week', 'month', 'year', 'custom'].includes(String(q?.preset)) ? String(q.preset) : 'session';
    let from: string, to: string;
    if (preset === 'custom') {
      from = ymd(q?.from) ?? ''; to = ymd(q?.to) ?? from;
      if (!from || !to || to < from) throw withCode(new CashDrawerError('bad_request', 'The start date must be on or before the end date.', 400), 'DATE_RANGE_INVALID');
    } else if (preset === 'session') { from = to = ymd(q?.date) ?? today; }
    else {
      const [y, m, d] = today.split('-').map(Number); const base = new Date(Date.UTC(y, m - 1, d));
      const start = preset === 'today' ? base : preset === 'week' ? new Date(base.getTime() - ((base.getUTCDay() + 6) % 7) * 86400000)
        : preset === 'month' ? new Date(Date.UTC(y, m - 1, 1)) : new Date(Date.UTC(y, 0, 1));
      from = utcDate(start); to = today;   // `start` is a UTC-midnight calendar day built from the branch's day
    }
    const kinds = ['sale', 'refund', 'cash_in', 'cash_out', 'float'];
    const pageSize = [5, 6, 8, 10, 20, 50].includes(Number(q?.pageSize)) ? Number(q.pageSize) : 10;
    return { preset, ...(await this.repo.activity(ctx, branchId, registerId, { from, to, kind: kinds.includes(String(q?.kind)) ? String(q.kind) : null, q: typeof q?.q === 'string' ? q.q : '', page: Math.max(1, parseInt(q?.page, 10) || 1), pageSize })) };
  }
}
