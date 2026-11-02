// tech-cash-handoff.service.ts — orchestration + auth scoping + realtime for end-of-day cash hand-off.
import { RealtimeEmitter, EVENTS, type EventName } from '@aipowersalon/realtime-contracts';
import { TechCashHandoffRepository, TCHCtx } from './tech-cash-handoff.repository';
import { hasPermission } from '@aipowersalon/permissions';
import { CashHandoff, CashHandoffDetail, HandoffStatus, TCH_EVENTS, TechCashHandoffError, TechCashHandoffVersionConflict, normDate, isUuid } from './tech-cash-handoff.dto';

/** A count sheet: [{ denominationCents, quantity }] — whole cents, whole non-negative quantities, at most 20 lines. */
export function parseDenominations(v: unknown): Array<{ denominationCents: number; quantity: number }> | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  if (v.length > 20) throw withCode(new TechCashHandoffError('bad_request', 'Too many denominations.', 400), 'VALIDATION_FAILED');
  return v.map((x: any) => {
    const den = Math.round(Number(x?.denominationCents)), qty = Math.round(Number(x?.quantity));
    if (!Number.isFinite(den) || den <= 0 || !Number.isFinite(qty) || qty < 0 || qty > 100000) throw withCode(new TechCashHandoffError('bad_request', 'Enter whole denominations and quantities.', 400), 'VALIDATION_FAILED');
    return { denominationCents: den, quantity: qty };
  }).filter((x) => x.quantity > 0);
}
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export class TechCashHandoffService {
  constructor(private readonly repo: TechCashHandoffRepository, private readonly realtime?: RealtimeEmitter) {}
  /** Today at the branch — the date a hand-off defaults to. */
  private async today(ctx: TCHCtx): Promise<string | undefined> { try { return await this.repo.today?.(ctx); } catch { return undefined; } }

  private toTenant(ctx: TCHCtx, event: EventName, payload: any) { try { this.realtime?.toTenant({ tenantId: ctx.tenantId, branchId: ctx.branchId ?? undefined } as any, event, payload); } catch { /* bus must not break actions */ } }
  /** Constitution 9: an owner alert ROW was written — owner clients must refetch alerts/dashboard. `owner_alert_updated`
   *  was already emitted on status change; the CREATE side was silent, so a new cash alert never reached an open Owner App. */
  private ownerAlert(ctx: TCHCtx, code: string): void { try { this.realtime?.toOwner(ctx.tenantId, EVENTS.ownerAlertCreated, { code }); } catch { /* best-effort */ } }
  private toTech(id: string | null, event: EventName, payload: any) { try { if (id) this.realtime?.toTechnician(id, event, payload); } catch { /* */ } }
  // BUILD_PLAN Phase 9 (Constitution 2 audit bug 6): no OWNER / SUPER_ADMIN shortcut. An owner's session carries every
  // tenant capability, so the permission alone admits them — and a DENY on the owner-level template now means something.
  // (Super Admin never reaches a /pos or /tech route: its session is refused outside the platform realm.)
  private has(ctx: TCHCtx, perm: string) { return hasPermission(ctx as any, perm); }
  private canView(ctx: TCHCtx) { return this.has(ctx, 'pos.reports.view') || this.has(ctx, 'pos.checkout.take_payment') || (!!ctx.tenantId && !!ctx.userId); }

  // ---- technician app ----
  async techMyHandoff(ctx: TCHCtx, date?: string): Promise<CashHandoffDetail> {
    const techId = await this.repo.resolveTechnicianId(ctx);
    if (!techId) throw withCode(new TechCashHandoffError('not_a_technician', 'Not a technician account.', 403), 'NOT_TECHNICIAN_ACCOUNT');
    return this.repo.handoffForTech(ctx, techId, normDate(date, await this.today(ctx)));
  }
  async techSubmit(ctx: TCHCtx, date?: string): Promise<CashHandoffDetail> {
    const techId = await this.repo.resolveTechnicianId(ctx);
    if (!techId) throw withCode(new TechCashHandoffError('not_a_technician', 'Not a technician account.', 403), 'NOT_TECHNICIAN_ACCOUNT');
    const d = normDate(date, await this.today(ctx));
    const exp = await this.repo.expectedCashForTech(ctx, techId, d);
    if (exp.expectedCents <= 0) throw withCode(new TechCashHandoffError('no_cash', 'No cash to hand off for this day.', 400), 'NO_CASH_TO_HAND_OFF');
    await this.repo.submit(ctx, techId, d, exp);
    await this.repo.audit(ctx, 'tech_cash_handoff_submitted', techId, { businessDate: d, expectedCents: exp.expectedCents, paymentCount: exp.paymentCount });
    if (!this.repo.emitsDomainEvents?.()) this.toTenant(ctx, TCH_EVENTS.handoffSubmitted, { technicianId: techId, businessDate: d, expectedCents: exp.expectedCents, paymentCount: exp.paymentCount });   // §343: else the projection delivers the recorded fact
    return this.repo.handoffForTech(ctx, techId, d);
  }

  // ---- POS / front desk ----
  async posList(ctx: TCHCtx, date?: string): Promise<{ businessDate: string; technicians: CashHandoff[]; totalExpectedCents: number; totalCountedCents: number; technicianCount: number; reconciledCount: number; openCount: number }> {
    if (!this.canView(ctx)) throw withCode(new TechCashHandoffError('forbidden', 'Not allowed.', 403), 'PERMISSION_DENIED');
    const d = normDate(date, await this.today(ctx));
    const technicians = await this.repo.listForDay(ctx, d);
    const totalExpectedCents = technicians.reduce((a, h) => a + h.expectedCents, 0);
    const totalCountedCents = technicians.reduce((a, h) => a + (h.countedCents || 0), 0);
    const reconciledCount = technicians.filter((h) => h.status === 'reconciled' || h.status === 'discrepancy').length;
    const openCount = technicians.filter((h) => h.status === 'open' || h.status === 'submitted').length;
    return { businessDate: d, technicians, totalExpectedCents, totalCountedCents, technicianCount: technicians.length, reconciledCount, openCount };
  }
  async posTechDetail(ctx: TCHCtx, technicianId: string, date?: string): Promise<CashHandoffDetail> {
    if (!this.canView(ctx)) throw withCode(new TechCashHandoffError('forbidden', 'Not allowed.', 403), 'PERMISSION_DENIED');
    if (!isUuid(technicianId)) throw withCode(new TechCashHandoffError('bad_request', 'Invalid technician.', 400), 'TECHNICIAN_NOT_FOUND');
    return this.repo.handoffForTech(ctx, technicianId, normDate(date, await this.today(ctx)));
  }
  /**
   * End-of-Day Cash (Oct 29 2026): count a technician's cash. Body: countedCents (the amount counted — the whole unit, or
   * with mode 'add' one PARTIAL hand-off added to what was already accepted), notes, date, optional denominations (a count
   * sheet whose subtotals must equal countedCents), expectedVersion (optimistic concurrency), idempotencyKey (one event per
   * submission), transferToDrawer + registerId (record the cash entering the register, once, as a custody movement).
   */
  async posReconcile(ctx: TCHCtx, technicianId: string, body: any): Promise<CashHandoffDetail & { result: { status: HandoffStatus; varianceCents: number; version: number; eventId: string | null; drawerMovementId: string | null; replayed: boolean } }> {
    if (!this.has(ctx, 'pos.checkout.take_payment')) throw withCode(new TechCashHandoffError('forbidden', 'You do not have permission to reconcile cash.', 403), 'PERMISSION_DENIED');
    if (!isUuid(technicianId)) throw withCode(new TechCashHandoffError('bad_request', 'Invalid technician.', 400), 'TECHNICIAN_NOT_FOUND');
    const counted = Math.round(Number(body?.countedCents));
    if (!Number.isFinite(counted) || counted < 0) throw withCode(new TechCashHandoffError('bad_amount', 'Enter the counted cash in cents (0 or more).', 400), 'COUNTED_CASH_INVALID');
    const mode: 'replace' | 'add' = body?.mode === 'add' ? 'add' : 'replace';
    if (mode === 'add' && counted <= 0) throw withCode(new TechCashHandoffError('bad_amount', 'A partial hand-off must be more than $0.', 400), 'COUNTED_CASH_INVALID');
    const denominations = parseDenominations(body?.denominations);
    if (denominations && denominations.reduce((a, d) => a + d.denominationCents * d.quantity, 0) !== counted) throw withCode(new TechCashHandoffError('bad_amount', 'The count sheet does not add up to the counted amount.', 400), 'COUNT_SHEET_MISMATCH');
    const expectedVersion = body?.expectedVersion == null || body.expectedVersion === '' ? null : Math.round(Number(body.expectedVersion));
    if (expectedVersion != null && !Number.isFinite(expectedVersion)) throw withCode(new TechCashHandoffError('bad_request', 'Invalid version.', 400), 'VALIDATION_FAILED');
    const d = normDate(body?.date, await this.today(ctx));
    const exp = await this.repo.expectedCashForTech(ctx, technicianId, d);
    const notes = typeof body?.notes === 'string' ? body.notes.slice(0, 500) : null;
    let r: Awaited<ReturnType<TechCashHandoffRepository['reconcile']>>;
    try {
      r = await this.repo.reconcile(ctx, technicianId, d, exp, counted, notes, { mode, denominations, expectedVersion, idempotencyKey: typeof body?.idempotencyKey === 'string' && body.idempotencyKey ? body.idempotencyKey.slice(0, 120) : null,
        transferToDrawer: body?.transferToDrawer === true, registerId: typeof body?.registerId === 'string' && body.registerId ? body.registerId.slice(0, 64) : null });
    } catch (e) { throw e instanceof TechCashHandoffVersionConflict ? withCode(e, 'HANDOFF_VERSION_CONFLICT') : e instanceof TechCashHandoffError && e.code === 'not_countable' ? withCode(e, 'HANDOFF_NOT_COUNTABLE') : e; }
    const detail = await this.repo.handoffForTech(ctx, technicianId, d);
    if (r.replayed) return { ...detail, result: { status: r.status, varianceCents: r.varianceCents, version: r.version, eventId: r.eventId, drawerMovementId: r.drawerMovementId, replayed: true } };
    const { status, varianceCents } = r;
    await this.repo.audit(ctx, 'tech_cash_handoff_reconciled', technicianId, { businessDate: d, expectedCents: exp.expectedCents, countedCents: r.countedCents, amountCents: counted, mode, varianceCents, status, version: r.version, eventId: r.eventId, drawerMovementId: r.drawerMovementId, denominations: denominations ? denominations.length : 0 });
    if (!this.repo.emitsDomainEvents?.()) this.toTenant(ctx, status === 'discrepancy' ? TCH_EVENTS.handoffDiscrepancy : TCH_EVENTS.handoffReconciled, { technicianId, businessDate: d, expectedCents: exp.expectedCents, countedCents: r.countedCents, varianceCents, status });   // §343: else the projection delivers the recorded fact
    if (!this.repo.emitsDomainEvents?.()) this.toTech(technicianId, TCH_EVENTS.handoffReconciled, { businessDate: d, countedCents: r.countedCents, varianceCents, status });   // §343: else the projection delivers the recorded fact
    if (status === 'discrepancy') {
      const usd = (n: number) => '$' + (Math.abs(n) / 100).toFixed(2);
      const dir = varianceCents > 0 ? 'over' : 'short';
      await this.repo.alert(ctx, 'warning', 'Cash hand-off discrepancy',
        `${detail.technicianName || 'A technician'} is ${dir} ${usd(varianceCents)} — counted ${usd(r.countedCents)} vs ${usd(exp.expectedCents)} expected on ${d}.`,
        { technicianId, technicianName: detail.technicianName, businessDate: d, expectedCents: exp.expectedCents, countedCents: r.countedCents, varianceCents, status });
    this.ownerAlert(ctx, 'Cash hand-off discrepancy');
    }
    return { ...detail, result: { status, varianceCents, version: r.version, eventId: r.eventId, drawerMovementId: r.drawerMovementId, replayed: false } };
  }

  /** End-of-Day Cash §17: a manager resolves a shortage / overage with a reason. The figures stay; the unit is reconciled (resolved). */
  async posResolve(ctx: TCHCtx, technicianId: string, body: any): Promise<CashHandoffDetail> {
    if (!this.has(ctx, 'checkout.manage_overrides')) throw withCode(new TechCashHandoffError('forbidden', 'Resolving a cash discrepancy needs a manager.', 403), 'PERMISSION_DENIED');
    if (!isUuid(technicianId)) throw withCode(new TechCashHandoffError('bad_request', 'Invalid technician.', 400), 'TECHNICIAN_NOT_FOUND');
    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
    if (!reason) throw withCode(new TechCashHandoffError('bad_request', 'Say how the difference was resolved.', 400), 'HANDOFF_RESOLUTION_REASON_REQUIRED');
    const expectedVersion = body?.expectedVersion == null || body.expectedVersion === '' ? null : Math.round(Number(body.expectedVersion));
    const d = normDate(body?.date, await this.today(ctx));
    let r: { version: number; varianceCents: number };
    try { r = await this.repo.resolve(ctx, technicianId, d, reason, expectedVersion); }
    catch (e) { throw e instanceof TechCashHandoffVersionConflict ? withCode(e, 'HANDOFF_VERSION_CONFLICT') : e instanceof TechCashHandoffError && e.code === 'not_under_review' ? withCode(e, 'HANDOFF_NOT_UNDER_REVIEW') : e instanceof TechCashHandoffError && e.code === 'not_found' ? withCode(e, 'HANDOFF_NOT_FOUND') : e; }
    await this.repo.audit(ctx, 'tech_cash_handoff_resolved', technicianId, { businessDate: d, reason, varianceCents: r.varianceCents, version: r.version });
    const detail = await this.repo.handoffForTech(ctx, technicianId, d);
    if (!this.repo.emitsDomainEvents?.()) this.toTenant(ctx, TCH_EVENTS.handoffReconciled, { technicianId, businessDate: d, expectedCents: detail.expectedCents, countedCents: detail.countedCents, varianceCents: r.varianceCents, status: 'reconciled', resolved: true });
    return detail;
  }
}
