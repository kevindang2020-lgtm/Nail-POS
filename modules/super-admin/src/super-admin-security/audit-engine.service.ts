// audit-engine.service.ts — the Security Audit Engine (Kevin's 1am architecture, Jul 26 2026).
// 1:00 AM (or manual) → advisory-locked run → checks → findings DEDUPLICATED by fingerprint → new critical/high
// findings escalate into the EXISTING security_incidents Super Admin workflow (review → fix → close) → findings
// that stop appearing are auto-RESOLVED (re-verify). A crashed check is itself a finding; a missed schedule
// window is itself a finding (failure detection).
import { runTick } from '@aipowersalon/observability';
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import { envHygieneFindings, webhookCorsFindings, fingerprintOf, needsIncident, reconcile, type CheckFinding } from './audit-engine-core';
import type { AuditEngineRepositoryPort } from './audit-engine.repository';
import type { IncidentService } from './incident.service';
import { runsBackgroundJob } from '@aipowersalon/config';

export interface AuditRunSummary { ran: boolean; runId?: string; checksRun?: number; open?: number; resolved?: number; skippedReason?: string }

export class AuditEngineService {
  private readonly log = new Logger('SecurityAuditEngine');
  constructor(
    private readonly repo: AuditEngineRepositoryPort,
    private readonly incidents?: Pick<IncidentService, 'create'>,
    private readonly db?: AppDatabase,
    private readonly env: Record<string, string | undefined> = process.env,
  ) {}

  /** The check battery. Each check is isolated: a crash becomes a HIGH finding instead of killing the run. */
  private async collectFindings(): Promise<{ findings: CheckFinding[]; checksRun: number }> {
    const findings: CheckFinding[] = [];
    let checksRun = 0;
    const guarded = async (name: string, fn: () => Promise<CheckFinding[]> | CheckFinding[]) => {
      checksRun++;
      try { findings.push(...(await fn())); }
      catch (e: any) {
        findings.push({ area: 'engine', title: `check crashed: ${name}`, severity: 'high', detail: String(e?.message ?? e).slice(0, 400) });
      }
    };

    await guarded('env-hygiene', () => envHygieneFindings(this.env));
    await guarded('webhook-cors-hygiene', () => webhookCorsFindings(this.env));

    await guarded('super-admin-mfa', async () => {
      if (!this.db) return [];
      const rows: any[] = await sql`select u.id from users u where u.role = 'SUPER_ADMIN'
        and not exists (select 1 from mfa_factors f where f.user_id = u.id and f.confirmed = true)
        limit 25`.execute(this.db as any).then((x: any) => x.rows);
      return rows.length ? [{ area: 'authentication', title: 'Super Admin account(s) without confirmed MFA', severity: 'high', detail: `${rows.length} SUPER_ADMIN user(s) have no confirmed MFA factor. Spec §7: MFA is mandatory for Super Admin.` }] : [];
    });

    await guarded('payments-idempotency-drift', async () => {
      if (!this.db) return [];
      const r: any = await sql`select count(*)::int as c from payments where created_at > now() - interval '7 days' and status = 'approved' and idempotency_key is null`.execute(this.db as any).then((x: any) => x.rows[0]);
      const c = Number(r?.c || 0);
      return c > 0 ? [{ area: 'payments', title: 'Approved payments recorded without an idempotency key', severity: 'medium', detail: `${c} approved payment(s) in the last 7 days carry no idempotency_key — replay protection is drifting on some payment path.` }] : [];
    });

    await guarded('schedule-gap', async () => {
      const last = await this.repo.lastCompletedAt();
      if (!last) return [];                                    // first ever run: no gap to report
      const gapH = (Date.now() - Date.parse(last)) / 3_600_000;
      return gapH > 26 ? [{ area: 'engine', title: 'Audit schedule gap detected', severity: 'medium', detail: `Last completed audit finished ${gapH.toFixed(1)}h ago (expected ~24h). The scheduler missed a window or the run failed.` }] : [];
    });

    return { findings, checksRun };
  }

  /** One full engine cycle. Advisory-locked: concurrent instances skip instead of double-running. */
  async runAudit(trigger: 'scheduled' | 'manual', userId: string | null = null): Promise<AuditRunSummary> {
    const locked = await this.repo.withRunLock(async () => {
      const runId = await this.repo.startRun(trigger, userId);
      try {
        const { findings, checksRun } = await this.collectFindings();
        const existing = await this.repo.allFindings();
        const plan = reconcile(existing, findings);
        for (const f of plan.toInsert) {
          let incidentId: string | null = null;
          if (needsIncident(f) && this.incidents) {
            try {
              const inc: any = await this.incidents.create(
                { title: `[Security audit] ${f.title}`, description: f.detail, category: f.area === 'authentication' ? 'authentication' : 'other', severity: f.severity, detectionSource: 'automated_security_audit', tenantId: null, branchId: null, assignedTo: null, correlationId: fingerprintOf(f) } as any,
                { userId, role: 'SUPER_ADMIN', name: 'Security Audit Engine', ip: null } as any,
              );
              incidentId = inc?.id ?? null;
            } catch (e: any) { this.log.error(`incident creation failed for "${f.title}": ${e?.message ?? e}`); }
          }
          await this.repo.insertFinding(runId, f, incidentId);
        }
        for (const b of plan.toBump) await this.repo.bumpFinding(b.id, runId, b.finding);
        for (const r of plan.toReopen) await this.repo.reopenFinding(r.id, runId, r.finding);
        for (const r of plan.toResolve) await this.repo.resolveFinding(r.id, runId);
        const open = plan.toInsert.length + plan.toBump.length + plan.toReopen.length;
        await this.repo.finishRun(runId, { status: 'completed', checksRun, findingsOpen: open, findingsResolved: plan.toResolve.length });
        this.log.log(`Security audit ${runId} (${trigger}): checks=${checksRun} open=${open} resolved=${plan.toResolve.length}`);
        return { runId, checksRun, open, resolved: plan.toResolve.length };
      } catch (e: any) {
        await this.repo.finishRun(runId, { status: 'failed', checksRun: 0, findingsOpen: 0, findingsResolved: 0, error: String(e?.message ?? e).slice(0, 500) }).catch(() => {});
        throw e;
      }
    });
    if (!locked.ran) return { ran: false, skippedReason: 'another instance is running the audit (advisory lock held)' };
    return { ran: true, ...locked.result! };
  }

  listRuns(limit = 20) { return this.repo.listRuns(Math.min(100, Math.max(1, limit))); }
  listFindings(status: string | null, limit = 50) { return this.repo.listFindings(status, Math.min(200, Math.max(1, limit))); }
}

// ---------------- scheduler (mirrors CustomerImportScheduler; off unless armed) ----------------
const CHECK_INTERVAL_MS = 5 * 60 * 1000;   // every 5 minutes: is it the 1am window and has ~a day passed?

export function auditWorkerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.SECURITY_AUDIT_WORKER_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** Pure decision (unit-tested): fire during the 01:00-01:59 local hour when the last completed run is >20h old. */
export function shouldFireScheduled(now: Date, lastCompletedIso: string | null): boolean {
  if (now.getHours() !== 1) return false;
  if (!lastCompletedIso) return true;
  return now.getTime() - Date.parse(lastCompletedIso) > 20 * 3_600_000;
}

@Injectable()
export class AuditEngineScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('AuditEngineScheduler');
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(private readonly svc: AuditEngineService) {}
  onModuleInit(): void {
    if (!runsBackgroundJob('standard')) return;   // Constitution 13 Phase 8: this process may not run 'standard' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (!auditWorkerEnabled()) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'audit.engine', jobClass: 'standard', everyMs: CHECK_INTERVAL_MS }, () => this.tick()).catch(() => undefined); }, CHECK_INTERVAL_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.log.log('Security audit worker armed (1:00 AM daily window, advisory-locked).');
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }
  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const last = await this.svc['repo'].lastCompletedAt();
      if (shouldFireScheduled(new Date(), last)) await this.svc.runAudit('scheduled');
    } catch (e: any) { this.log.error(`audit tick failed: ${e?.message ?? e}`); }
    finally { this.running = false; }
  }
}
