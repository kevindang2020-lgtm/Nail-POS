// communications-limits.service.ts — Set Tenant Usage Limits (§36) + the backend enforcement evaluator. Setting a
// limit validates inputs, upserts the tenant's configuration, and records a before/after audit. The evaluator compares
// configured limits against REAL month-to-date / today usage and returns an authoritative decision the send pipeline
// consults before dispatch (soft → warn, hard → block, approval → require approval).
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { pct } from './communications-overview-core';
import { CommunicationsLimitsRepository, type LimitRow } from './communications-limits.kysely.repository';

export interface AdminCtx { userId?: string; email?: string; ip?: string }
const ENFORCEMENT = ['soft', 'hard', 'approval'];
const validUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const intOrNull = (v: unknown, name: string, max = 100000000): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new BadRequestException(`${name} must be a non-negative integer (or blank for unlimited)`);
  return n;
};

function shape(row: LimitRow | null) {
  if (!row) return null;
  return { monthlySms: row.monthly_sms, monthlyEmail: row.monthly_email, monthlyPush: row.monthly_push, dailyLimit: row.daily_limit, enforcement: row.enforcement, optOutRateThresholdBps: row.opt_out_rate_threshold_bps, failureRateThresholdBps: row.failure_rate_threshold_bps, status: row.status, updatedAt: row.updated_at };
}

export class CommunicationsLimitsService {
  constructor(private readonly repo: CommunicationsLimitsRepository) {}

  async getTenantLimit(tenantId: string) {
    if (!validUuid(tenantId)) throw new BadRequestException('invalid tenantId');
    const [row, usage] = await Promise.all([this.repo.getLimit(tenantId), this.repo.monthUsage(tenantId)]);
    const limit = shape(row);
    const limitUsed = limit
      ? {
          sms: limit.monthlySms ? pct(usage.sms, limit.monthlySms) : null,
          email: limit.monthlyEmail ? pct(usage.email, limit.monthlyEmail) : null,
          push: limit.monthlyPush ? pct(usage.push, limit.monthlyPush) : null,
        }
      : null;
    return { tenantId, limit, usage, limitUsed, available: !!limit };
  }

  async setTenantLimit(ctx: AdminCtx, tenantId: string, body: any) {
    if (!validUuid(tenantId)) throw new BadRequestException('invalid tenantId');
    if (!(await this.repo.tenantExists(tenantId))) throw new NotFoundException('tenant not found');

    const monthlySms = intOrNull(body?.monthlySms, 'monthlySms');
    const monthlyEmail = intOrNull(body?.monthlyEmail, 'monthlyEmail');
    const monthlyPush = intOrNull(body?.monthlyPush, 'monthlyPush');
    const dailyLimit = intOrNull(body?.dailyLimit, 'dailyLimit');
    const enforcement = String(body?.enforcement ?? 'soft');
    if (!ENFORCEMENT.includes(enforcement)) throw new BadRequestException('invalid enforcement');
    const optOutBps = intOrNull(body?.optOutRateThresholdBps, 'optOutRateThresholdBps', 10000);
    const failureBps = intOrNull(body?.failureRateThresholdBps, 'failureRateThresholdBps', 10000);
    const status = body?.status === 'suspended' ? 'suspended' : 'active';

    const before = shape(await this.repo.getLimit(tenantId));
    await this.repo.upsertLimit(tenantId, { monthlySms, monthlyEmail, monthlyPush, dailyLimit, enforcement, optOutBps, failureBps, status, updatedBy: ctx.userId && validUuid(ctx.userId) ? ctx.userId : null });
    const after = shape(await this.repo.getLimit(tenantId));
    await this.repo.writeAudit(tenantId, ctx, 'tenant_limit_set', 'Tenant messaging limits updated', { before, after });
    return { ok: true, tenantId, before, after };
  }

  /** Backend enforcement decision consulted before dispatch (real usage vs configured limits). */
  async evaluate(tenantId: string, channel: 'sms' | 'email' | 'push') {
    const [row, usage, today] = await Promise.all([this.repo.getLimit(tenantId), this.repo.monthUsage(tenantId), this.repo.todayUsage(tenantId)]);
    if (!row) return { withinLimit: true, action: 'allow' as const, reason: 'no_limit_configured', enforcement: 'none' as const };
    if (row.status === 'suspended') return { withinLimit: false, action: row.enforcement === 'hard' ? 'block' as const : 'warn' as const, reason: 'tenant_suspended', enforcement: row.enforcement };
    const monthlyMap: Record<string, number | null> = { sms: row.monthly_sms, email: row.monthly_email, push: row.monthly_push };
    const monthlyLimit = monthlyMap[channel];
    const monthlyUsed = usage[channel];
    const overMonthly = monthlyLimit != null && monthlyUsed >= monthlyLimit;
    const overDaily = row.daily_limit != null && today >= row.daily_limit;
    const over = overMonthly || overDaily;
    const action = !over ? 'allow' as const : row.enforcement === 'hard' ? 'block' as const : row.enforcement === 'approval' ? 'require_approval' as const : 'warn' as const;
    return { withinLimit: !over, action, reason: over ? (overMonthly ? 'monthly_limit_reached' : 'daily_limit_reached') : 'within_limit', enforcement: row.enforcement, monthlyUsed, monthlyLimit, dailyUsed: today, dailyLimit: row.daily_limit };
  }
}
