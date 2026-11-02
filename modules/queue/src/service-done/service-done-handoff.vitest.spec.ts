// service-done-handoff.vitest.spec — Service Done mandate (Oct 28 2026) §26, §29–§37, §44, §55–§59, §99–§102, §107–§110.
// The checkout handoff is ONE transition however often or from however many stations it is asked for; the readiness
// rule decides it; paid visits are never re-added; completed history changes only through Reopen; KPIs have no
// decorative values. Run against the in-memory adapter (the Kysely adapter's compare-and-set SQL is verified on
// PostgreSQL 16 in docs/mandates/status/SERVICE_DONE_ONE_SCREEN_STATUS.md).
import { describe, it, expect } from 'vitest';
import { ServiceDoneService } from './service-done.service';
import { InMemoryServiceDoneRepository } from './service-done.repository';
import { capReadyStaff, completionAccuracyPercent, computeRebookingRatePercent, SD_STAFF_BOARD_LIMIT } from './service-done.dto';

const PERMS = ['pos.service_done.view', 'pos.service_done.send_to_checkout', 'pos.checkout.view', 'pos.service_done.quality_check', 'pos.service_done.assign_technician', 'pos.service_done.reopen'];
const ctx = { tenantId: 'luxe001', branchId: 'b1', userId: 'u_mgr', role: 'MANAGER', permissions: PERMS } as any;
const other = { ...ctx, tenantId: 'other_salon', userId: 'u_x' } as any;
const code = async (p: Promise<unknown>) => { try { await p; return 'OK'; } catch (e: any) { return e?.apiCode ?? e?.code ?? e?.message; } };
const setup = () => { const repo = new InMemoryServiceDoneRepository(); return { repo, svc: new ServiceDoneService(repo as any) }; };
// sd_3002 = approved, not ready · sd_3001 = quality pending · sd_3004 = issue_found · sd_3005 = already sent

describe('Move to Checkout is idempotent and concurrency-safe (§35–§37, §107, §110)', () => {
  it('MOVE TO CHECKOUT ×3 → one handoff business effect', async () => {
    const { repo, svc } = setup();
    const r = [await svc.sendToCheckout(ctx, 'sd_3002'), await svc.sendToCheckout(ctx, 'sd_3002'), await svc.sendToCheckout(ctx, 'sd_3002')];
    expect(r.map((x) => x.duplicate)).toEqual([false, true, true]);
    expect(new Set(r.map((x) => x.idempotencyKey)).size).toBe(1);
    expect(repo.readyFacts.filter((f) => f.ticketId === 'sd_3002')).toHaveLength(1);
    expect((await repo.ticket(ctx, 'sd_3002'))!.checkoutStatus).toBe('sent_to_checkout');
  });
  it('two stations at the same instant → exactly one moves, the other is idempotent success', async () => {
    const { repo, svc } = setup();
    const [a, b] = await Promise.all([svc.sendToCheckout(ctx, 'sd_3002'), svc.sendToCheckout({ ...ctx, userId: 'u_desk2' }, 'sd_3002')]);
    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
    expect(repo.readyFacts).toHaveLength(1);
  });
  it('a ticket already sent answers success without a second fact', async () => {
    const { repo, svc } = setup();
    expect((await svc.sendToCheckout(ctx, 'sd_3005')).duplicate).toBe(true);
    expect(repo.readyFacts).toHaveLength(0);
  });
  it('Mark Ready twice → one transition', async () => {
    const { repo, svc } = setup();
    await svc.markReady(ctx, 'sd_3002'); await svc.markReady(ctx, 'sd_3002');
    expect(repo.readyFacts).toEqual([{ ticketId: 'sd_3002', checkoutStatus: 'ready_for_checkout' }]);
  });
});

describe('readiness rule and quality workflow (§26, §30–§33)', () => {
  it('quality not approved → refused, no handoff', async () => {
    const { repo, svc } = setup();
    expect(await code(svc.sendToCheckout(ctx, 'sd_3001'))).toBe('CANNOT_SEND_TO_CHECKOUT');
    expect(await code(svc.markReady(ctx, 'sd_3001'))).toBe('QUALITY_APPROVAL_REQUIRED');
    expect(repo.readyFacts).toHaveLength(0);
  });
  it('a recorded quality issue holds checkout until it is re-approved', async () => {
    const { svc } = setup();
    expect(await code(svc.sendToCheckout(ctx, 'sd_3004'))).toBe('CANNOT_SEND_TO_CHECKOUT');
    await svc.qualityCheck(ctx, 'sd_3004', { result: 'approved', note: 'rework done, guest reconfirmed' } as any);
    expect((await svc.sendToCheckout(ctx, 'sd_3004')).duplicate).toBe(false);
  });
  it('the quality decision is audited with before / after', async () => {
    const { svc } = setup();
    await svc.qualityCheck(ctx, 'sd_3004', { result: 'approved' } as any);
    const a = svc.auditLog().find((x) => x.actionType === 'pos_service_done_quality_checked')!;
    expect(a.before).toEqual({ qualityStatus: 'issue_found' }); expect(a.after).toEqual({ qualityStatus: 'approved' });
  });
  it('a reopened visit cannot be handed off', async () => {
    const { svc } = setup();
    await svc.reopen(ctx, 'sd_3002', { reason: 'guest wants another color' } as any);
    expect(await code(svc.sendToCheckout(ctx, 'sd_3002'))).toBe('CANNOT_SEND_TO_CHECKOUT');
  });
});

describe('completed history is not silently rewritten (§29, §38, §97, §100, §108)', () => {
  it('quality change after the handoff → Reopen first', async () => {
    const { svc } = setup();
    expect(await code(svc.qualityCheck(ctx, 'sd_3005', { result: 'needs_review' } as any))).toBe('TICKET_LOCKED_AT_SERVICE_DONE');
  });
  it('technician ownership is not rewritten after the handoff', async () => {
    const { svc } = setup();
    expect(await code(svc.assignTechnician(ctx, 'sd_3005', { technicianId: 'tech_leo' }))).toBe('TICKET_LOCKED_AT_SERVICE_DONE');
  });
  it('a paid visit is never re-added to Checkout', async () => {
    const { repo, svc } = setup();
    (await repo.ticket(ctx, 'sd_3002'))!.paid = true;
    expect(await code(svc.sendToCheckout(ctx, 'sd_3002'))).toBe('TICKET_PAID_USE_REFUND');
    expect(await code(svc.qualityCheck(ctx, 'sd_3002', { result: 'approved' } as any))).toBe('TICKET_PAID_USE_REFUND');
    expect(repo.readyFacts).toHaveLength(0);
  });
  it('a stale review edit does not overwrite a newer one (expectedVersion)', async () => {
    const { svc } = setup();
    const seen = 1;   // both reviewers opened version 1
    await svc.qualityCheck(ctx, 'sd_3001', { result: 'approved', expectedVersion: seen } as any);
    expect(await code(svc.qualityCheck(ctx, 'sd_3001', { result: 'issue_found', expectedVersion: seen } as any))).toBe('TICKET_CHANGED_RELOAD');
  });
});

describe('tenant isolation (§102–§104)', () => {
  it('another salon cannot see or move this salon\'s visit', async () => {
    const { repo, svc } = setup();
    expect(await code(svc.sendToCheckout(other, 'sd_3002'))).toBe('TICKET_NOT_FOUND');
    expect(await code(svc.detail(other, 'sd_3002'))).toBe('TICKET_NOT_FOUND');
    expect((await svc.getState(other)).tickets.items).toHaveLength(0);
    expect(repo.readyFacts).toHaveLength(0);
  });
});

describe('KPI definitions have no decorative values (§16, §55, §57, §59) and staff is compact (§44)', () => {
  it('nothing completed → accuracy is null (was a decorative 100 %), rebooking null (was 0 %)', () => {
    expect(completionAccuracyPercent(0, 0)).toBeNull();
    expect(completionAccuracyPercent(20, 1)).toBe(95);
    expect(computeRebookingRatePercent([], [])).toBeNull();
    expect(computeRebookingRatePercent(['c1', 'c2'], ['c2'])).toBe(50);
  });
  it('a salon with no ratings shows no satisfaction number', async () => {
    const { svc } = setup();
    expect((await svc.getState(ctx)).kpis.customerSatisfactionAvg).toBeNull();
  });
  it('200 technicians → 8 rows, Available first, plus counts for everyone', () => {
    const ST = ['Busy', 'Available', 'Break', 'Finishing Soon'];
    const rows = Array.from({ length: 100 }, (_, i) => ({ technicianId: 't' + i, name: 'T' + i, status: ST[i % 4] }));
    const r = capReadyStaff(rows, 200);
    expect(SD_STAFF_BOARD_LIMIT).toBe(8); expect(r.staff).toHaveLength(8); expect(r.staff.every((x) => x.status === 'Available')).toBe(true);
    expect(r.staffSummary).toEqual({ onDuty: 100, available: 25, finishing: 25, busy: 25, onBreak: 25, shown: 8, roster: 200 });
  });
});
