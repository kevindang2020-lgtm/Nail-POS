// subscription-change.service.ts — tenant upgrade/downgrade workflow with decimal-safe proration. preview computes the
// change (classification + prorated credit/charge/net) without writing; commit applies it (immediate => updates the
// subscription + fresh period; end_of_cycle => records a scheduled change) and audits. Permission-gated.
import type { ChangePreview } from '@aipowersalon/api-contracts/platform';
export type { ChangePreview };   // owned by packages/api-contracts (Constitution 13 §13)
import { Injectable, Inject } from '@nestjs/common';
import type { SubscriptionChangeRepo, AuditActor, ChangeRow } from './subscription-change.repository';
import { classifyChange, computeProration, type ChangeType, type Strategy } from './proration-core';
import { InvalidStateTransitionError } from '@aipowersalon/database';

export class ChangeForbiddenError extends Error {}
export class ChangeNotFoundError extends Error {}
export class ChangeValidationError extends Error {}

export type ChangeActor = AuditActor & { permissions?: string[] };
const MANAGE_PERM = 'super_admin.subscriptions.manage';
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;


@Injectable()
export class SubscriptionChangeService {
  constructor(@Inject('SubscriptionChangeRepo') private readonly repo: SubscriptionChangeRepo) {}

  private requireManage(actor: ChangeActor) {
    if (!(actor?.permissions ?? []).includes(MANAGE_PERM)) throw new ChangeForbiddenError(`missing permission: ${MANAGE_PERM}`);
  }

  async getSubscription(tenantId: string) {
    const s = await this.repo.getSubscription(tenantId);
    return s ?? { planText: null, planCode: null, monthlyPriceCents: null, periodStartMs: null, periodEndMs: null, status: null };
  }

  private async build(tenantId: string, toPlanCode: string, strategy: Strategy, nowMs: number): Promise<ChangePreview> {
    const sub = await this.repo.getSubscription(tenantId);
    const to = await this.repo.getPlanByCode(toPlanCode);
    if (!to) throw new ChangeNotFoundError(`plan not found: ${toPlanCode}`);

    const oldCents = sub?.monthlyPriceCents ?? null;
    const changeType = classifyChange(oldCents, to.monthlyPriceCents);
    const periodStartMs = sub?.periodStartMs ?? nowMs;
    const periodEndMs = sub?.periodEndMs ?? nowMs + MONTH_MS;

    const changeAtMs = strategy === 'end_of_cycle' ? periodEndMs : nowMs;
    const proration = computeProration({ periodStartMs, periodEndMs, changeAtMs, oldMonthlyCents: oldCents ?? 0, newMonthlyCents: to.monthlyPriceCents });
    const effectiveAt = new Date(strategy === 'end_of_cycle' ? periodEndMs : nowMs).toISOString();

    return {
      tenantId,
      from: { planCode: sub?.planCode ?? null, planText: sub?.planText ?? null, monthlyPriceCents: oldCents },
      to: { planCode: to.code, name: to.name, monthlyPriceCents: to.monthlyPriceCents },
      changeType, strategy, effectiveAt, proration,
    };
  }

  async preview(tenantId: string, toPlanCode: string, strategy: Strategy): Promise<ChangePreview> {
    if (strategy !== 'immediate' && strategy !== 'end_of_cycle') throw new ChangeValidationError('strategy must be immediate or end_of_cycle');
    return this.build(tenantId, toPlanCode, strategy, Date.now());
  }

  async commit(actor: ChangeActor, tenantId: string, toPlanCode: string, strategy: Strategy, reason: string | null): Promise<{ changeId: string; preview: ChangePreview }> {
    this.requireManage(actor);
    if (strategy !== 'immediate' && strategy !== 'end_of_cycle') throw new ChangeValidationError('strategy must be immediate or end_of_cycle');
    const nowMs = Date.now();
    const p = await this.build(tenantId, toPlanCode, strategy, nowMs);

    let changeId: string;
    if (strategy === 'immediate') {
      changeId = await this.repo.applyImmediateChange({
        tenantId, toPlan: { code: p.to.planCode, name: p.to.name, monthlyPriceCents: p.to.monthlyPriceCents, billingInterval: 'monthly' },
        fromPlanCode: p.from.planCode, changeType: p.changeType,
        creditCents: p.proration.creditCents, chargeCents: p.proration.chargeCents, netCents: p.proration.netCents,
        reason, createdBy: actor.userId ?? null,
      });
    } else {
      changeId = await this.repo.recordScheduledChange({
        tenantId, toPlanCode: p.to.planCode, fromPlanCode: p.from.planCode, changeType: p.changeType,
        effectiveAtMs: Date.parse(p.effectiveAt), reason, createdBy: actor.userId ?? null,
      });
    }
    await this.repo.writeAudit(actor, 'super_admin_subscription_changed', tenantId, {
      from: p.from.planCode, to: p.to.planCode, changeType: p.changeType, strategy, netCents: p.proration.netCents,
    });
    return { changeId, preview: p };
  }

  async listChanges(tenantId: string): Promise<ChangeRow[]> { return this.repo.listChanges(tenantId); }

  // Rollover: apply every scheduled (end_of_cycle) change whose effective_at has passed. Idempotent — each applied
  // change flips to 'applied' in the same transaction as the subscription update. Permission-gated + audited.
  async processScheduled(actor: ChangeActor): Promise<{ due: number; applied: number; skipped: number }> {
    this.requireManage(actor);
    const due = await this.repo.getDueScheduledChanges(new Date().toISOString());
    let applied = 0; let skipped = 0;
    for (const d of due) {
      const to = await this.repo.getPlanByCode(d.toPlanCode);
      if (!to) { skipped++; continue; }
      // Phase 12 (#27): a change another pass already applied is refused by SUBSCRIPTION_CHANGE (its transaction rolls back)
      try { await this.repo.applyScheduledChange(d.id, d.tenantId, to); }
      catch (e) { if (e instanceof InvalidStateTransitionError) { skipped++; continue; } throw e; }
      await this.repo.writeAudit(actor, 'super_admin_scheduled_change_applied', d.tenantId, { changeId: d.id, toPlanCode: d.toPlanCode });
      applied++;
    }
    return { due: due.length, applied, skipped };
  }
}
