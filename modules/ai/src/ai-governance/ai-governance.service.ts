// ai-governance.service.ts — reads/writes control modes (with conservative defaults) and exposes the enforcement
// decision. Changing a mode requires the owner/admin permission and is recorded with the acting user (spec §54).
import { withDefaults, isControlMode, canAutoExecute, requiresApproval, type AssistantControl, type ControlMode, type ActionRisk } from './ai-governance.dto';
import type { AiGovernanceRepo } from './ai-governance.repository';
import { hasPermission } from '@aipowersalon/permissions';
import { HttpException } from '@nestjs/common';

// BUILD_PLAN Phase 9: was OWNER_ROLES = ['owner', 'tenant_owner', 'admin', 'tenant_admin'] OR the key — an OWNER
// shortcut (Constitution 2 audit bug 6) around a key no catalog held. ai.control.manage is the one gate now; the catalog
// registers it (owners hold every tenant key).
const CONTROL_PERM = 'ai.control.manage';

export class AiGovernanceService {
  constructor(
    private readonly repo: AiGovernanceRepo,
    private readonly assistantKeys: () => string[],
    // Optional audit sink (spec §54: mutations are audited). Optional so the service stays unit-constructible.
    private readonly audit?: { record: (ctx: any, input: any) => Promise<unknown> },
  ) {}

  async list(tenantId: string): Promise<AssistantControl[]> {
    return withDefaults(await this.repo.list(tenantId), this.assistantKeys());
  }
  async setMode(ctx: { tenantId: string; userId: string | null; role?: string; permissions?: string[] }, assistantKey: string, mode: string): Promise<AssistantControl> {
    const allowed = hasPermission({ tenantId: ctx.tenantId, branchId: '', userId: ctx.userId ?? '', role: (ctx.role ?? '') as any, permissions: ctx.permissions ?? [] }, CONTROL_PERM);
    // §163 run 3 (Oct 27 2026): registry codes as HttpExceptions — a plain Error with a `status` field was answered 500
    if (!allowed) throw new HttpException({ code: 'PERMISSION_DENIED', message: 'You do not have permission to change AI control modes.' }, 403);
    if (!this.assistantKeys().includes(assistantKey)) throw new HttpException({ code: 'RESOURCE_NOT_FOUND', message: 'That AI assistant does not exist.', details: { field: 'assistantKey' } }, 404);
    if (!isControlMode(mode)) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'That control mode is not valid.', details: { field: 'mode' } }, 400);
    await this.repo.set(ctx.tenantId, assistantKey, mode, ctx.userId);
    // §54 — audit the mutation (resilient; a logging failure must never break the change).
    void this.audit?.record(
      { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role },
      { module: 'ai_governance', action: 'ai.control_mode.changed', resourceType: 'ai_assistant', resourceId: assistantKey,
        summary: `AI control mode for ${assistantKey} set to ${mode}`, status: 'success', severity: 'info', metadata: { mode } },
    ).catch(() => { /* audit must never break the action */ });
    return (await this.list(ctx.tenantId)).find((a) => a.assistantKey === assistantKey)!;
  }
  /** Enforcement decision for an action under a mode (used by AI action paths). */
  async decide(tenantId: string, assistantKey: string, risk: ActionRisk): Promise<{ mode: ControlMode; autoExecute: boolean; needsApproval: boolean }> {
    const ctl = (await this.list(tenantId)).find((a) => a.assistantKey === assistantKey);
    const mode = (ctl?.mode ?? 'recommendation_only') as ControlMode;
    return { mode, autoExecute: canAutoExecute(mode, risk), needsApproval: requiresApproval(mode, risk) };
  }
}
