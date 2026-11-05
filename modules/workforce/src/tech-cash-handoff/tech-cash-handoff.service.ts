// tech-cash-handoff.service.ts — orchestration + auth scoping + realtime for end-of-day cash hand-off.
import { RealtimeEmitter, EVENTS, type EventName } from '@aipowersalon/realtime-contracts';
import { TechCashHandoffRepository, TCHCtx } from './tech-cash-handoff.repository';
import { hasPermission } from '@aipowersalon/permissions';
import { CashHandoff, CashHandoffDetail, TCH_EVENTS, TechCashHandoffError, normDate, isUuid } from './tech-cash-handoff.dto';

export class TechCashHandoffService {
  constructor(private readonly repo: TechCashHandoffRepository, private readonly realtime?: RealtimeEmitter) {}
  /** Today at the branch — the date a hand-off defaults to. */
  private async today(ctx: TCHCtx): Promise<string | undefined> { try { return await (this.repo as any).today?.(ctx); } catch { return undefined; } }

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
    if (!techId) throw new TechCashHandoffError('not_a_technician', 'Not a technician account.', 403);
    return this.repo.handoffForTech(ctx, techId, normDate(date, await this.today(ctx)));
  }
  async techSubmit(ctx: TCHCtx, date?: string): Promise<CashHandoffDetail> {
    const techId = await this.repo.resolveTechnicianId(ctx);
    if (!techId) throw new TechCashHandoffError('not_a_technician', 'Not a technician account.', 403);
    const d = normDate(date, await this.today(ctx));
    const exp = await this.repo.expectedCashForTech(ctx, techId, d);
    if (exp.expectedCents <= 0) throw new TechCashHandoffError('no_cash', 'No cash to hand off for this day.', 400);
    await this.repo.submit(ctx, techId, d, exp);
    await this.repo.audit(ctx, 'tech_cash_handoff_submitted', techId, { businessDate: d, expectedCents: exp.expectedCents, paymentCount: exp.paymentCount });
    if (!this.repo.emitsDomainEvents?.()) this.toTenant(ctx, TCH_EVENTS.handoffSubmitted, { technicianId: techId, businessDate: d, expectedCents: exp.expectedCents, paymentCount: exp.paymentCount });   // §343: else the projection delivers the recorded fact
    return this.repo.handoffForTech(ctx, techId, d);
  }

  // ---- POS / front desk ----
  async posList(ctx: TCHCtx, date?: string): Promise<{ businessDate: string; technicians: CashHandoff[]; totalExpectedCents: number; totalCountedCents: number; technicianCount: number; reconciledCount: number; openCount: number }> {
    if (!this.canView(ctx)) throw new TechCashHandoffError('forbidden', 'Not allowed.', 403);
    const d = normDate(date, await this.today(ctx));
    const technicians = await this.repo.listForDay(ctx, d);
    const totalExpectedCents = technicians.reduce((a, h) => a + h.expectedCents, 0);
    const totalCountedCents = technicians.reduce((a, h) => a + (h.countedCents || 0), 0);
    const reconciledCount = technicians.filter((h) => h.status === 'reconciled' || h.status === 'discrepancy').length;
    const openCount = technicians.filter((h) => h.status === 'open' || h.status === 'submitted').length;
    return { businessDate: d, technicians, totalExpectedCents, totalCountedCents, technicianCount: technicians.length, reconciledCount, openCount };
  }
  async posTechDetail(ctx: TCHCtx, technicianId: string, date?: string): Promise<CashHandoffDetail> {
    if (!this.canView(ctx)) throw new TechCashHandoffError('forbidden', 'Not allowed.', 403);
    if (!isUuid(technicianId)) throw new TechCashHandoffError('bad_request', 'Invalid technician.', 400);
    return this.repo.handoffForTech(ctx, technicianId, normDate(date, await this.today(ctx)));
  }
  async posReconcile(ctx: TCHCtx, technicianId: string, body: any): Promise<CashHandoffDetail> {
    if (!this.has(ctx, 'pos.checkout.take_payment')) throw new TechCashHandoffError('forbidden', 'You do not have permission to reconcile cash.', 403);
    if (!isUuid(technicianId)) throw new TechCashHandoffError('bad_request', 'Invalid technician.', 400);
    const counted = Math.round(Number(body?.countedCents));
    if (!Number.isFinite(counted) || counted < 0) throw new TechCashHandoffError('bad_amount', 'Enter the counted cash in cents (0 or more).', 400);
    const d = normDate(body?.date, await this.today(ctx));
    const exp = await this.repo.expectedCashForTech(ctx, technicianId, d);
    const notes = typeof body?.notes === 'string' ? body.notes.slice(0, 500) : null;
    const { status, varianceCents } = await this.repo.reconcile(ctx, technicianId, d, exp, counted, notes);
    const detail = await this.repo.handoffForTech(ctx, technicianId, d);
    await this.repo.audit(ctx, 'tech_cash_handoff_reconciled', technicianId, { businessDate: d, expectedCents: exp.expectedCents, countedCents: counted, varianceCents, status });
    if (!this.repo.emitsDomainEvents?.()) this.toTenant(ctx, status === 'discrepancy' ? TCH_EVENTS.handoffDiscrepancy : TCH_EVENTS.handoffReconciled, { technicianId, businessDate: d, expectedCents: exp.expectedCents, countedCents: counted, varianceCents, status });   // §343: else the projection delivers the recorded fact
    if (!this.repo.emitsDomainEvents?.()) this.toTech(technicianId, TCH_EVENTS.handoffReconciled, { businessDate: d, countedCents: counted, varianceCents, status });   // §343: else the projection delivers the recorded fact
    if (status === 'discrepancy') {
      const usd = (n: number) => '$' + (Math.abs(n) / 100).toFixed(2);
      const dir = varianceCents > 0 ? 'over' : 'short';
      await this.repo.alert(ctx, 'warning', 'Cash hand-off discrepancy',
        `${detail.technicianName || 'A technician'} is ${dir} ${usd(varianceCents)} — counted ${usd(counted)} vs ${usd(exp.expectedCents)} expected on ${d}.`,
        { technicianId, technicianName: detail.technicianName, businessDate: d, expectedCents: exp.expectedCents, countedCents: counted, varianceCents, status });
    this.ownerAlert(ctx, 'Cash hand-off discrepancy');
    }
    return detail;
  }
}
