// ai-marketing-send-sweep.ts — the worker loop that turns approved+scheduled campaigns into real sends. There is
// no general job queue in this codebase, so this runs as a periodic sweep (like ai-trial-sweep/reminders): find
// campaigns whose scheduled time has arrived, load each one's plan, and hand it to the send executor under a
// TRUSTED system context. The executor is idempotent, so overlapping/retried sweeps never double-send.
//
// The loop below is unit-tested with fakes. The Kysely DueCampaignSource is DB glue (⚠️ live-smoke required).
import { runTick } from '@aipowersalon/observability';
import { systemContext } from '@aipowersalon/tenant-context';
import { Injectable, Logger, Inject, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { dueForSend } from './ai-marketing-send-adapters-core';
import type { AiMarketingContext } from './ai-marketing.dto';
import { runsBackgroundJob } from '@aipowersalon/config';

export interface DueCampaign {
  tenantId: string;
  branchId: string | null;
  campaignId: string;
  scheduledAt: string | null;
  status: string;
}
export interface DueCampaignSource {
  findDue(nowIso: string, limit: number): Promise<DueCampaign[]>;
}
export interface PlanReaderPort {
  get(tenantId: string, campaignId: string): Promise<{ messageVersion: number; body: string; audienceDefinition?: Record<string, unknown> | null } | null>;
}
export interface SendExecutorPort {
  executeCampaign(ctx: AiMarketingContext, args: { campaignId: string; messageVersion: number; body: string; subject?: string | null }): Promise<unknown>;
}

export interface SweepResult {
  processed: number;
  sent: unknown[];
  skippedNoPlan: string[];
  errors: { campaignId: string; error: string }[];
}

// Per-tenant fairness (spec: scale to 10k tenants). Given a pool of due campaigns, round-robin across tenants so
// no single tenant monopolizes a tick: take at most `maxPerTenant` per tenant, up to `maxTotal` overall,
// interleaving tenants in first-seen order. Unselected campaigns stay 'scheduled' + due → next tick picks them up.
// Pure + unit-tested.
export function selectFairBatch(
  dues: DueCampaign[],
  opts: { maxPerTenant: number; maxTotal: number },
): DueCampaign[] {
  const maxPerTenant = Math.max(1, opts.maxPerTenant);
  const maxTotal = Math.max(1, opts.maxTotal);
  const byTenant = new Map<string, DueCampaign[]>();
  const order: string[] = [];
  for (const d of dues) {
    let q = byTenant.get(d.tenantId);
    if (!q) { q = []; byTenant.set(d.tenantId, q); order.push(d.tenantId); }
    q.push(d);
  }
  const taken: DueCampaign[] = [];
  const count = new Map<string, number>();
  let progress = true;
  while (taken.length < maxTotal && progress) {
    progress = false;
    for (const t of order) {
      if (taken.length >= maxTotal) break;
      const q = byTenant.get(t)!;
      const c = count.get(t) ?? 0;
      if (q.length > 0 && c < maxPerTenant) {
        taken.push(q.shift()!);
        count.set(t, c + 1);
        progress = true;
      }
    }
  }
  return taken;
}

export class AiMarketingSendSweep {
  constructor(
    private readonly due: DueCampaignSource,
    private readonly plans: PlanReaderPort,
    private readonly executor: SendExecutorPort,
  ) {}

  async runOnce(
    nowIso: string = new Date().toISOString(),
    opts: { poolSize?: number; maxPerTenant?: number; maxTotal?: number } = {},
  ): Promise<SweepResult> {
    const maxTotal = Math.max(1, opts.maxTotal ?? 50);
    const maxPerTenant = Math.max(1, opts.maxPerTenant ?? 5);
    const poolSize = Math.max(maxTotal, opts.poolSize ?? maxTotal * 4); // fetch a wider pool so fairness has choices
    const pool = await this.due.findDue(nowIso, poolSize);
    // Per-tenant fairness: no single tenant monopolizes a tick.
    const dues = selectFairBatch(pool, { maxPerTenant, maxTotal });
    const result: SweepResult = { processed: 0, sent: [], skippedNoPlan: [], errors: [] };

    for (const d of dues) {
      // Defensive double-check of due-ness even if the source query is imperfect.
      if (!dueForSend(d.status, d.scheduledAt, nowIso)) continue;

      const plan = await this.plans.get(d.tenantId, d.campaignId);
      if (!plan || !plan.body) { result.skippedNoPlan.push(d.campaignId); continue; }

      // Trusted system context — no user. The executor uses the system-actor campaign lifecycle.
      const ctx = systemContext({ tenantId: d.tenantId, branchId: d.branchId, actor: 'ai-marketing-send-sweep' }) as unknown as AiMarketingContext;
      try {
        const summary = await this.executor.executeCampaign(ctx, {
          campaignId: d.campaignId, messageVersion: plan.messageVersion, body: plan.body,
          ...(typeof plan.audienceDefinition?.emailSubject === 'string' ? { subject: plan.audienceDefinition.emailSubject as string } : {}),   // Campaign Center email subject
        });
        result.sent.push(summary);
      } catch (e: any) {
        result.errors.push({ campaignId: d.campaignId, error: String(e?.message || 'error') });
      }
      result.processed++;
    }
    return result;
  }
}

// --- Kysely DueCampaignSource: scheduled campaigns whose time has arrived (⚠️ live-smoke required) ----------
export class KyselyDueCampaignSource implements DueCampaignSource {
  constructor(private readonly db: Kysely<DB>) {}
  async findDue(nowIso: string, limit: number): Promise<DueCampaign[]> {
    try {
      // due 'scheduled' campaigns, plus 'in_progress' ones that HAVE a send plan (a run to resume). Raw SQL, tenant carried.
      const rows = (await sql<any>`select c.id, c.tenant_id, c.branch_id, c.status, c.scheduled_at from campaigns c
          where (c.status = 'scheduled' and c.scheduled_at is not null and c.scheduled_at <= ${nowIso}::timestamptz)
             or (c.status = 'in_progress' and exists (select 1 from ai_marketing_campaign_plans p where p.campaign_id = c.id and p.tenant_id = c.tenant_id))
          order by c.scheduled_at asc nulls last, c.id
          limit ${Math.max(1, Math.min(500, limit))}`.execute(this.db)).rows;
      return (rows as any[]).map((r) => ({
        tenantId: String(r.tenant_id),
        branchId: r.branch_id ?? null,
        campaignId: String(r.id),
        scheduledAt: r.scheduled_at ? new Date(r.scheduled_at).toISOString() : null,
        status: String(r.status),
      }));
    } catch {
      return [];
    }
  }
}

// SAFETY: the sweep is OFF unless AI_MARKETING_SEND_SWEEP_ENABLED=1. A background sender must never turn itself
// on silently — enabling it is an explicit operational choice, and it should only be armed after the two-tenant
// live smoke passes.
export function sendSweepEnabled(): boolean {
  return process.env.AI_MARKETING_SEND_SWEEP_ENABLED === '1';
}
const SWEEP_INTERVAL_MS = Math.max(30_000, Number(process.env.AI_MARKETING_SEND_SWEEP_INTERVAL_MS) || 60_000);
const SWEEP_MAX_PER_TENANT = Math.max(1, Number(process.env.AI_MARKETING_SEND_SWEEP_MAX_PER_TENANT) || 5);
const SWEEP_MAX_TOTAL = Math.max(1, Number(process.env.AI_MARKETING_SEND_SWEEP_MAX_TOTAL) || 50);

@Injectable()
export class AiMarketingSendSweepScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('AiMarketingSendSweepScheduler');
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(@Inject(AiMarketingSendSweep) private readonly sweep: AiMarketingSendSweep) {}

  onModuleInit(): void {
    if (!runsBackgroundJob('ai')) return;   // Constitution 13 Phase 8: this process may not run 'ai' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (!sendSweepEnabled()) { this.log.log('AI Marketing send sweep DISABLED (set AI_MARKETING_SEND_SWEEP_ENABLED=1 to arm).'); return; }
    void runTick({ jobType: 'ai.marketing.send', jobClass: 'ai', everyMs: SWEEP_INTERVAL_MS }, () => this.tick()).catch(() => undefined);
    this.timer = setInterval(() => { void runTick({ jobType: 'ai.marketing.send', jobClass: 'ai', everyMs: SWEEP_INTERVAL_MS }, () => this.tick()).catch(() => undefined); }, SWEEP_INTERVAL_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.log.log(`AI Marketing send sweep armed (every ${Math.round(SWEEP_INTERVAL_MS / 1000)}s).`);
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  private async tick(): Promise<void> {
    if (this.running) return; // never overlap a sweep
    this.running = true;
    try {
      const r = await this.sweep.runOnce(new Date().toISOString(), { maxPerTenant: SWEEP_MAX_PER_TENANT, maxTotal: SWEEP_MAX_TOTAL });
      if (r.processed) this.log.log(`Send sweep: processed ${r.processed}, errors ${r.errors.length}, no-plan ${r.skippedNoPlan.length}.`);
    } catch (e: any) {
      this.log.error(`Send sweep failed: ${e?.message ?? e}`);
    } finally {
      this.running = false;
    }
  }
}
