// deposit-reconciliation.sweep.service.ts — the durable background job body. For each tenant with activity it runs
// the SAME deterministic engine (matching + fee reconciliation) and auto-creates exceptions for real problems
// (missing deposits, fee differences) so they land in the human review queue without waiting for someone to open
// a screen. It is IDEMPOTENT: an exception is created only if no unresolved one already exists for that source_ref,
// so repeated sweeps never duplicate. It NEVER resolves, matches money, or touches funds — detection only.
import { buildReconState, DEFAULT_RECON_OPTIONS, type ReconContext } from './deposit-reconciliation.dto';
import { buildFeeReconState, DEFAULT_FEE_OPTIONS } from './deposit-reconciliation.fees';
import { suggestSeverity } from './deposit-reconciliation.exceptions';
import type { ReconRepositoryPort } from './deposit-reconciliation.repository';
import { systemContext } from '@aipowersalon/tenant-context';
import type { FeeScheduleRepositoryPort } from './deposit-reconciliation.fees.repository';
import type { ExceptionsRepositoryPort } from './deposit-reconciliation.exceptions.repository';
import type { SweepRepositoryPort } from './deposit-reconciliation.sweep.repository';

const money = (c: number) => '$' + (c / 100).toFixed(2);

export class ReconSweepService {
  constructor(
    private readonly sweepRepo: SweepRepositoryPort,
    private readonly recon: ReconRepositoryPort,
    private readonly fees: FeeScheduleRepositoryPort,
    private readonly exceptions: ExceptionsRepositoryPort,
  ) {}

  /** B-14 remainder (Oct 20 2026): the ONE system-context shape. It posed as a made-up user ('00000000-…'), stored as the
   *  creator of every case it raised; a system job has no user — the repository keeps NULL and the audit names the job. */
  private ctx(tenantId: string): ReconContext { return systemContext({ tenantId, actor: 'deposit-reconciliation-sweep' }) as unknown as ReconContext; }

  async sweepAll(): Promise<{ tenantsSwept: number; exceptionsCreated: number }> {
    const tenantIds = await this.sweepRepo.listActiveTenantIds();
    let exceptionsCreated = 0;
    for (const tenantId of tenantIds) exceptionsCreated += await this.sweepTenant(this.ctx(tenantId));
    return { tenantsSwept: tenantIds.length, exceptionsCreated };
  }

  async sweepTenant(ctx: ReconContext): Promise<number> {
    const [settlements, deposits, schedules, existing] = await Promise.all([
      this.recon.listSettlements(ctx), this.recon.listDeposits(ctx), this.fees.listFeeSchedules(ctx), this.exceptions.list(ctx),
    ]);
    const recon = buildReconState(settlements, deposits, { ...DEFAULT_RECON_OPTIONS, nowIso: new Date().toISOString() });
    const fee = buildFeeReconState(settlements, schedules, DEFAULT_FEE_OPTIONS);
    const openRefs = new Set(existing.filter((e) => e.status !== 'resolved' && e.sourceRef).map((e) => e.sourceRef as string));

    interface Candidate { kind: 'missing_deposit' | 'fee_difference'; ref: string; amountCents: number; title: string; detail: string }
    const candidates: Candidate[] = [];
    const ws = this.sweepRepo.workspaceState ? await this.sweepRepo.workspaceState(ctx.tenantId) : new Map<string, { allocatedCents: number; status: string }>();
    for (const r of recon.rows) {
      // the workspace is the source of truth for matches: a payout a person matched (any allocation) is not missing, and a failed /
      // returned / pending batch never paid out — the legacy engine's own pairing used to raise false cases for both
      const w = ws.get(r.settlementId);
      if (r.status === 'missing_deposit' && w && (w.allocatedCents > 0 || ['failed', 'returned', 'pending'].includes(w.status))) continue;
      if (r.status === 'missing_deposit') candidates.push({ kind: 'missing_deposit', ref: `missing_deposit:${r.settlementId}`, amountCents: r.expectedNetCents, title: `Missing deposit — ${money(r.expectedNetCents)} ${r.processorType || 'settlement'}`, detail: `Settlement settled ${String(r.settledAt).slice(0, 10)} has no matching bank deposit past the funding window.` });
    }
    for (const f of fee.rows) {
      if (f.status === 'fee_difference') { const d = Math.abs(f.differenceCents ?? 0); candidates.push({ kind: 'fee_difference', ref: `fee_difference:${f.settlementId}`, amountCents: d, title: `Fee difference — ${money(d)} on ${f.processorType || 'settlement'}`, detail: `Actual fee ${money(f.actualFeeCents)} vs expected ${money(f.expectedFeeCents ?? 0)} (schedule v${f.scheduleVersion}).` }); }
    }

    let created = 0;
    for (const c of candidates) {
      if (openRefs.has(c.ref)) continue;          // idempotent: already flagged and unresolved
      await this.exceptions.create(ctx, { kind: c.kind, severity: suggestSeverity(c.kind, c.amountCents), title: c.title, detail: c.detail, amountCents: c.amountCents, sourceRef: c.ref });
      openRefs.add(c.ref); created++;
    }
    return created;
  }
}
