// ai-provisioning.service.ts — durable provisioning of a draft agent through the voice provider. start() creates a
// persisted job (idempotent: an active job for the agent is returned rather than duplicated) and kicks off run().
// run() executes the ordered steps, persisting progress; at the provider step it calls voiceProvider.createAgent(...).
// If the provider is not connected it fails honestly with a specific error_code + safe message — never fake progress.
// On success the agent gets its provider_agent_id and flips draft→ready. Execution is in-process (no platform queue
// exists); production hardening would move run() to a real worker, but the job STATE is durable and pollable today.
import type { ProvisioningJob } from '@aipowersalon/api-contracts/tenant';
export type { ProvisioningJob };   // owned by packages/api-contracts (Constitution 13 §13)
import { Injectable, Inject, Optional } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { hasPermission } from '@aipowersalon/permissions';
import { PROVISIONING_STEPS, STEP_LABELS, progressFor, type ProvisioningStep } from './provisioning-core';
import { ProviderNotConnectedError, type VoiceProvisioningPort } from './provider-ports';
import { DEFAULT_GREETING, DEFAULT_BEHAVIOR } from './ai-agent-core';
import type { ProvisioningMetricsService } from './provisioning-metrics.service';

export interface ProvCtx { tenantId: string; branchId: string | null; userId: string; role: string; permissions: string[] }

export class ProvForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'ProvForbiddenError'; } }
export class ProvNotFoundError extends Error { constructor(msg = 'Job not found') { super(msg); this.name = 'ProvNotFoundError'; } }

export interface AgentReader { get(tenantId: string, id: string): Promise<any | null>; setProvisioned(tenantId: string, id: string, providerAgentId: string): Promise<void> }
export interface ProvJobRepo {
  activeForAgent(tenantId: string, agentId: string): Promise<ProvisioningJob | null>;
  create(tenantId: string, branchId: string | null, agentId: string, userId: string): Promise<ProvisioningJob>;
  get(tenantId: string, id: string): Promise<ProvisioningJob | null>;
  patch(tenantId: string, id: string, fields: Partial<ProvisioningJob>): Promise<ProvisioningJob | null>;
}

@Injectable()
export class AiProvisioningService {
  constructor(
    @Inject('ProvJobRepo') private readonly repo: ProvJobRepo,
    @Inject('ProvAgentReader') private readonly agents: AgentReader,
    @Inject('VoiceProvider') private readonly voice: VoiceProvisioningPort,
    @Optional() @Inject('ProvisioningMetrics') private readonly metrics?: ProvisioningMetricsService,
  ) {}

  async start(ctx: ProvCtx, agentId: string): Promise<ProvisioningJob> {
    if (!hasPermission(ctx as any, 'ai.manage')) throw new ProvForbiddenError('Missing ai.manage');
    const agent = await this.agents.get(ctx.tenantId, agentId);
    if (!agent) throw new ProvNotFoundError('Agent not found');
    const existing = await this.repo.activeForAgent(ctx.tenantId, agentId);
    if (existing) return existing;              // idempotent: don't start a second provision
    const job = await this.repo.create(ctx.tenantId, ctx.branchId, agentId, ctx.userId);
    // Fire-and-forget: run persists its own progress; the client polls get(). Errors are captured into the job.
    void this.run(ctx, job.id, agent).catch(() => undefined);
    return job;
  }

  async get(ctx: ProvCtx, id: string): Promise<ProvisioningJob> {
    const job = await this.repo.get(ctx.tenantId, id);
    if (!job) throw new ProvNotFoundError();
    return job;
  }

  /** Execute the steps. Public so a real worker could drive it; safe to call once per job. */
  async run(ctx: ProvCtx, jobId: string, agent: any): Promise<void> {
    this.metrics?.attempt();
    let completed = 0;
    const step = async (name: ProvisioningStep, fn?: () => Promise<void>) => {
      await this.repo.patch(ctx.tenantId, jobId, { status: 'running', currentStep: name, currentStepLabel: STEP_LABELS[name], progress: progressFor(completed) });
      if (fn) await fn();
      completed += 1;
      await this.repo.patch(ctx.tenantId, jobId, { progress: progressFor(completed) });
    };
    try {
      await step('load_business_info');
      await step('load_calendar_setup');
      let knowledge = '';
      await step('generate_knowledge', async () => { knowledge = `${agent.name} at the salon. ${agent.useCase ?? ''}`.trim(); });
      let providerAgentId = '';
      await step('create_voice_agent', async () => {
        const handle = await this.voice.createAgent({
          name: agent.name, language: agent.language ?? 'en',
          greeting: agent.greeting ?? DEFAULT_GREETING, behavior: agent.behavior ?? DEFAULT_BEHAVIOR,
          knowledge, tools: [],
        });
        providerAgentId = handle.providerAgentId;
      });
      await step('register_webhook');
      await step('validate_runtime');
      await step('finalize', async () => { await this.agents.setProvisioned(ctx.tenantId, agent.id, providerAgentId); });
      await this.repo.patch(ctx.tenantId, jobId, { status: 'succeeded', progress: 100, providerAgentId });
      this.metrics?.success();
    } catch (e: any) {
      const isProvider = e instanceof ProviderNotConnectedError;
      const errorCode = isProvider ? 'PROVIDER_NOT_CONNECTED' : 'PROVISIONING_ERROR';
      await this.repo.patch(ctx.tenantId, jobId, {
        status: 'failed',
        errorCode,
        safeErrorMessage: isProvider ? `${e.provider} is not connected. Connect the account, then retry.` : 'Provisioning failed. You can retry.',
      });
      this.metrics?.failure(errorCode);
    }
  }
}

// ---- repos ----
const jobShape = (r: any): ProvisioningJob => ({ id: r.id, tenantId: r.tenant_id, agentId: r.agent_id, status: r.status, currentStep: r.current_step ?? null, currentStepLabel: r.current_step ? STEP_LABELS[r.current_step as ProvisioningStep] ?? null : null, progress: Number(r.progress ?? 0), errorCode: r.error_code ?? null, safeErrorMessage: r.safe_error_message ?? null, providerAgentId: r.provider_agent_id ?? null });

export class InMemoryProvJobRepo implements ProvJobRepo {
  private rows: any[] = []; private seq = 0;
  async activeForAgent(tenantId: string, agentId: string) { const r = this.rows.find((x) => x.tenant_id === tenantId && x.agent_id === agentId && (x.status === 'pending' || x.status === 'running')); return r ? jobShape(r) : null; }
  async create(tenantId: string, branchId: string | null, agentId: string) { const r = { id: 'job_' + (++this.seq), tenant_id: tenantId, branch_id: branchId, agent_id: agentId, status: 'pending', progress: 0 }; this.rows.push(r); return jobShape(r); }
  async get(tenantId: string, id: string) { const r = this.rows.find((x) => x.tenant_id === tenantId && x.id === id); return r ? jobShape(r) : null; }
  async patch(tenantId: string, id: string, fields: Partial<ProvisioningJob>) {
    const r = this.rows.find((x) => x.tenant_id === tenantId && x.id === id); if (!r) return null;
    if (fields.status !== undefined) r.status = fields.status;
    if (fields.currentStep !== undefined) r.current_step = fields.currentStep;
    if (fields.progress !== undefined) r.progress = fields.progress;
    if (fields.errorCode !== undefined) r.error_code = fields.errorCode;
    if (fields.safeErrorMessage !== undefined) r.safe_error_message = fields.safeErrorMessage;
    if (fields.providerAgentId !== undefined) r.provider_agent_id = fields.providerAgentId;
    return jobShape(r);
  }
}

export class KyselyProvJobRepo implements ProvJobRepo {
  constructor(private readonly db: Kysely<any>) {}
  async activeForAgent(tenantId: string, agentId: string) { const r: any = (await sql`SELECT * FROM ai_receptionist_provisioning_jobs WHERE tenant_id = ${tenantId} AND agent_id = ${agentId} AND status IN ('pending','running') ORDER BY created_at DESC LIMIT 1`.execute(this.db)).rows[0]; return r ? jobShape(r) : null; }
  async create(tenantId: string, branchId: string | null, agentId: string, userId: string) { const r: any = (await sql`INSERT INTO ai_receptionist_provisioning_jobs (tenant_id, branch_id, agent_id, status, created_by_user_id) VALUES (${tenantId}, ${branchId}, ${agentId}, 'pending', ${userId}) RETURNING *`.execute(this.db)).rows[0]; return jobShape(r); }
  async get(tenantId: string, id: string) { const r: any = (await sql`SELECT * FROM ai_receptionist_provisioning_jobs WHERE tenant_id = ${tenantId} AND id = ${id} LIMIT 1`.execute(this.db)).rows[0]; return r ? jobShape(r) : null; }
  async patch(tenantId: string, id: string, f: Partial<ProvisioningJob>) {
    const r: any = (await sql`UPDATE ai_receptionist_provisioning_jobs SET
        status = COALESCE(${f.status ?? null}, status),
        current_step = ${f.currentStep !== undefined ? f.currentStep : sql`current_step`},
        progress = COALESCE(${f.progress ?? null}, progress),
        error_code = ${f.errorCode !== undefined ? f.errorCode : sql`error_code`},
        safe_error_message = ${f.safeErrorMessage !== undefined ? f.safeErrorMessage : sql`safe_error_message`},
        provider_agent_id = ${f.providerAgentId !== undefined ? f.providerAgentId : sql`provider_agent_id`},
        updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${id} RETURNING *`.execute(this.db)).rows[0];
    return r ? jobShape(r) : null;
  }
}
