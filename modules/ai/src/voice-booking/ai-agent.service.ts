// ai-agent.service.ts — CRUD for AI Front Desk agents (config/draft lifecycle). Tenant-scoped (scope is server-derived
// in the controller), permission-gated ('ai.manage' for writes), and versioned (each save snapshots the config).
// Provisioning to a provider is intentionally NOT here — an agent stays 'draft' until an account is connected.
import { Injectable, Inject } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { canMoveToSql } from '@aipowersalon/database';
import { AI_RECEPTIONIST_AGENT } from '../ai-lifecycles';
import { hasPermission } from '@aipowersalon/permissions';
import { normalizeAgentConfig, canTransitionAgent, AgentValidationError, DEFAULT_GREETING, DEFAULT_BEHAVIOR, type AgentConfig, type AgentConfigInput, type AgentStatus } from './ai-agent-core';

export interface AgentCtx { tenantId: string; branchId: string | null; userId: string; role: string; permissions: string[] }
export interface AgentRow {
  id: string; tenantId: string; branchId: string | null; name: string; status: AgentStatus; callType: string;
  language: string; useCase: string | null; greeting: string | null; behavior: string | null;
  provider: string | null; providerAgentId: string | null; knowledgeVersion: number; createdAtMs: number; updatedAtMs: number;
}

export class AgentForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'AgentForbiddenError'; } }
export class AgentNotFoundError extends Error { constructor(msg = 'Agent not found') { super(msg); this.name = 'AgentNotFoundError'; } }

export interface AgentRepo {
  list(tenantId: string, opts: { branchId?: string | null; status?: string }): Promise<AgentRow[]>;
  get(tenantId: string, id: string): Promise<AgentRow | null>;
  insert(tenantId: string, cfg: AgentConfig, userId: string): Promise<AgentRow>;
  update(tenantId: string, id: string, cfg: AgentConfig, userId: string): Promise<AgentRow | null>;
  setStatus(tenantId: string, id: string, status: AgentStatus, userId: string): Promise<AgentRow | null>;
  setProvisioned(tenantId: string, id: string, providerAgentId: string): Promise<void>;
  addVersion(tenantId: string, agentId: string, version: number, config: unknown, userId: string): Promise<void>;
}

@Injectable()
export class AiAgentService {
  constructor(@Inject('AgentRepo') private readonly repo: AgentRepo) {}

  private canManage(ctx: AgentCtx) { if (!hasPermission(ctx as any, 'ai.manage')) throw new AgentForbiddenError('Missing ai.manage'); }

  async list(ctx: AgentCtx, opts: { status?: string } = {}): Promise<AgentRow[]> {
    return this.repo.list(ctx.tenantId, { branchId: undefined, status: opts.status });
  }

  async get(ctx: AgentCtx, id: string): Promise<AgentRow> {
    const row = await this.repo.get(ctx.tenantId, id);
    if (!row) throw new AgentNotFoundError();
    return row;
  }

  /** Create a config-only draft. Applies safe defaults for greeting/behavior when not supplied. */
  async createDraft(ctx: AgentCtx, input: AgentConfigInput): Promise<AgentRow> {
    this.canManage(ctx);
    const cfg = normalizeAgentConfig({ greeting: DEFAULT_GREETING, behavior: DEFAULT_BEHAVIOR, ...input });
    const row = await this.repo.insert(ctx.tenantId, cfg, ctx.userId);
    await this.repo.addVersion(ctx.tenantId, row.id, 1, cfg, ctx.userId);
    return row;
  }

  async update(ctx: AgentCtx, id: string, input: AgentConfigInput): Promise<AgentRow> {
    this.canManage(ctx);
    const cur = await this.repo.get(ctx.tenantId, id);
    if (!cur) throw new AgentNotFoundError();
    if (cur.status === 'archived') throw new AgentValidationError('Archived agents cannot be edited.');
    const cfg = normalizeAgentConfig(input, {
      name: cur.name, branchId: cur.branchId, callType: cur.callType as any, language: cur.language,
      useCase: cur.useCase, greeting: cur.greeting, behavior: cur.behavior,
    });
    const updated = await this.repo.update(ctx.tenantId, id, cfg, ctx.userId);
    if (!updated) throw new AgentNotFoundError();
    await this.repo.addVersion(ctx.tenantId, id, updated.knowledgeVersion + 1, cfg, ctx.userId);
    return updated;
  }

  async setStatus(ctx: AgentCtx, id: string, status: AgentStatus): Promise<AgentRow> {
    this.canManage(ctx);
    const cur = await this.repo.get(ctx.tenantId, id);
    if (!cur) throw new AgentNotFoundError();
    if (!canTransitionAgent(cur.status, status)) throw new AgentValidationError(`Cannot change an agent from ${cur.status} to ${status}.`);
    const updated = await this.repo.setStatus(ctx.tenantId, id, status, ctx.userId);
    if (!updated) throw new AgentNotFoundError();
    return updated;
  }
}

// ---- repos ----
const nowMs = () => Date.now();

export class InMemoryAgentRepo implements AgentRepo {
  private rows: AgentRow[] = [];
  private versions: { tenantId: string; agentId: string; version: number; config: unknown }[] = [];
  private seq = 0;
  async list(tenantId: string, opts: { status?: string }): Promise<AgentRow[]> {
    return this.rows.filter((r) => r.tenantId === tenantId && (!opts.status || r.status === opts.status)).sort((a, b) => b.createdAtMs - a.createdAtMs);
  }
  async get(tenantId: string, id: string): Promise<AgentRow | null> { return this.rows.find((r) => r.tenantId === tenantId && r.id === id) ?? null; }
  async insert(tenantId: string, cfg: AgentConfig, _userId: string): Promise<AgentRow> {
    const row: AgentRow = { id: 'agent_' + (++this.seq), tenantId, branchId: cfg.branchId, name: cfg.name, status: 'draft', callType: cfg.callType, language: cfg.language, useCase: cfg.useCase, greeting: cfg.greeting, behavior: cfg.behavior, provider: null, providerAgentId: null, knowledgeVersion: 1, createdAtMs: nowMs(), updatedAtMs: nowMs() };
    this.rows.push(row); return row;
  }
  async update(tenantId: string, id: string, cfg: AgentConfig, _userId: string): Promise<AgentRow | null> {
    const row = this.rows.find((r) => r.tenantId === tenantId && r.id === id); if (!row) return null;
    Object.assign(row, { name: cfg.name, branchId: cfg.branchId, callType: cfg.callType, language: cfg.language, useCase: cfg.useCase, greeting: cfg.greeting, behavior: cfg.behavior, knowledgeVersion: row.knowledgeVersion + 1, updatedAtMs: nowMs() });
    return row;
  }
  async setStatus(tenantId: string, id: string, status: AgentStatus, _userId: string): Promise<AgentRow | null> {
    const row = this.rows.find((r) => r.tenantId === tenantId && r.id === id); if (!row) return null;
    row.status = status; row.updatedAtMs = nowMs(); return row;
  }
  async addVersion(tenantId: string, agentId: string, version: number, config: unknown): Promise<void> { this.versions.push({ tenantId, agentId, version, config }); }
  async setProvisioned(tenantId: string, id: string, providerAgentId: string): Promise<void> {
    const row = this.rows.find((r) => r.tenantId === tenantId && r.id === id);
    if (row) { row.provider = 'retell'; row.providerAgentId = providerAgentId; row.status = 'ready'; row.updatedAtMs = nowMs(); }
  }
}

export class KyselyAgentRepo implements AgentRepo {
  constructor(private readonly db: Kysely<any>) {}
  private map = (r: any): AgentRow => ({ id: r.id, tenantId: r.tenant_id, branchId: r.branch_id ?? null, name: r.name, status: r.status, callType: r.call_type, language: r.language, useCase: r.use_case ?? null, greeting: r.greeting ?? null, behavior: r.behavior ?? null, provider: r.provider ?? null, providerAgentId: r.provider_agent_id ?? null, knowledgeVersion: Number(r.knowledge_version ?? 0), createdAtMs: new Date(r.created_at).getTime(), updatedAtMs: new Date(r.updated_at).getTime() });
  async list(tenantId: string, opts: { status?: string }): Promise<AgentRow[]> {
    const rows = opts.status
      ? (await sql`SELECT * FROM ai_receptionist_agents WHERE tenant_id = ${tenantId} AND status = ${opts.status} ORDER BY created_at DESC LIMIT 500`.execute(this.db)).rows
      : (await sql`SELECT * FROM ai_receptionist_agents WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT 500`.execute(this.db)).rows;
    return rows.map(this.map);
  }
  async get(tenantId: string, id: string): Promise<AgentRow | null> {
    const r: any = (await sql`SELECT * FROM ai_receptionist_agents WHERE tenant_id = ${tenantId} AND id = ${id} LIMIT 1`.execute(this.db)).rows[0];
    return r ? this.map(r) : null;
  }
  async insert(tenantId: string, cfg: AgentConfig, userId: string): Promise<AgentRow> {
    const r: any = (await sql`INSERT INTO ai_receptionist_agents (tenant_id, branch_id, name, status, call_type, language, use_case, greeting, behavior, knowledge_version, created_by_user_id, updated_by_user_id)
      VALUES (${tenantId}, ${cfg.branchId}, ${cfg.name}, 'draft', ${cfg.callType}, ${cfg.language}, ${cfg.useCase}, ${cfg.greeting}, ${cfg.behavior}, 1, ${userId}, ${userId}) RETURNING *`.execute(this.db)).rows[0];
    return this.map(r);
  }
  async update(tenantId: string, id: string, cfg: AgentConfig, userId: string): Promise<AgentRow | null> {
    const r: any = (await sql`UPDATE ai_receptionist_agents SET name = ${cfg.name}, branch_id = ${cfg.branchId}, call_type = ${cfg.callType}, language = ${cfg.language}, use_case = ${cfg.useCase}, greeting = ${cfg.greeting}, behavior = ${cfg.behavior}, knowledge_version = knowledge_version + 1, updated_by_user_id = ${userId}, updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${id} RETURNING *`.execute(this.db)).rows[0];
    return r ? this.map(r) : null;
  }
  async setStatus(tenantId: string, id: string, status: AgentStatus, userId: string): Promise<AgentRow | null> {
    const r: any = (await sql`UPDATE ai_receptionist_agents SET status = ${status}, updated_by_user_id = ${userId}, updated_at = now(), archived_at = ${status === 'archived' ? sql`now()` : sql`archived_at`}
      WHERE tenant_id = ${tenantId} AND id = ${id} AND ${canMoveToSql(AI_RECEPTIONIST_AGENT, status)} RETURNING *`.execute(this.db)).rows[0];
    return r ? this.map(r) : null;
  }
  async addVersion(tenantId: string, agentId: string, version: number, config: unknown, userId: string): Promise<void> {
    await sql`INSERT INTO ai_receptionist_agent_versions (tenant_id, agent_id, version, configuration, created_by_user_id)
      VALUES (${tenantId}, ${agentId}, ${version}, ${JSON.stringify(config)}::jsonb, ${userId})
      ON CONFLICT (tenant_id, agent_id, version) DO NOTHING`.execute(this.db);
  }
  async setProvisioned(tenantId: string, id: string, providerAgentId: string): Promise<void> {
    // Phase 12 (#27): provisioning moves an agent to ready from any non-archived state — never revives an archived one
    const r: any = await sql`UPDATE ai_receptionist_agents SET provider = 'retell', provider_agent_id = ${providerAgentId}, status = 'ready', updated_at = now() WHERE tenant_id = ${tenantId} AND id = ${id} AND ${canMoveToSql(AI_RECEPTIONIST_AGENT, 'ready')}`.execute(this.db);
    if (Number(r?.numAffectedRows ?? 1) === 0) throw new AgentValidationError('This agent is archived — it cannot be provisioned.');
  }
}
