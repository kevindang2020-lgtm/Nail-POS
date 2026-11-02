// communications-announcements.service.ts — Send Platform Announcement (§24). Validates the request, enforces the
// platform-vs-customer boundary (recipient roles are tenant STAFF roles — never CUSTOMER), computes a REAL recipient
// estimate, is idempotent (an identical idempotency key returns the original), and persists an authoritative record
// (status 'queued', or 'scheduled' when future-dated). Actual dispatch is handled downstream by the messaging worker.
import { BadRequestException } from '@nestjs/common';
import { TENANT_USER_ROLES, isTenantUserRole } from './communications-overview-core';
import { CommunicationsAnnouncementsRepository } from './communications-announcements.kysely.repository';

export interface AdminCtx { userId?: string; email?: string; ip?: string }
const CHANNELS = ['email', 'sms', 'push', 'in_app', 'multi'];
const PRIORITIES = ['normal', 'high', 'critical'];
const validUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export class CommunicationsAnnouncementsService {
  constructor(private readonly repo: CommunicationsAnnouncementsRepository) {}

  eligibleRoles(): readonly string[] { return TENANT_USER_ROLES; }

  async listRecent() { return { announcements: await this.repo.recent() }; }

  async create(ctx: AdminCtx, body: any) {
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const bodyText = typeof body?.body === 'string' ? body.body.trim() : '';
    if (!title) throw new BadRequestException('title is required');
    if (!bodyText) throw new BadRequestException('body is required');
    const subject = typeof body?.subject === 'string' && body.subject.trim() ? body.subject.trim() : null;

    const channel = String(body?.channel ?? 'in_app');
    if (!CHANNELS.includes(channel)) throw new BadRequestException('invalid channel');
    const priority = String(body?.priority ?? 'normal');
    if (!PRIORITIES.includes(priority)) throw new BadRequestException('invalid priority');

    const roles: string[] = Array.isArray(body?.recipientRoles) ? [...new Set(body.recipientRoles.map((r: any) => String(r).toUpperCase()))] as string[] : [];
    if (roles.length === 0) throw new BadRequestException('at least one recipient role is required');
    // Platform-vs-customer boundary: announcements target tenant staff/admins, never customers.
    if (roles.includes('CUSTOMER')) throw new BadRequestException('platform announcements cannot target tenant customers');
    const invalid = roles.filter((r) => !isTenantUserRole(r));
    if (invalid.length) throw new BadRequestException(`unsupported recipient role(s): ${invalid.join(', ')}`);

    const targetScope = body?.targetScope === 'selected' ? 'selected' : 'all_tenants';
    let targetTenantIds: string[] = [];
    if (targetScope === 'selected') {
      targetTenantIds = Array.isArray(body?.targetTenantIds) ? body.targetTenantIds.map((t: any) => String(t)).filter(validUuid) : [];
      if (targetTenantIds.length === 0) throw new BadRequestException('selected scope requires at least one valid tenant');
      const exist = await this.repo.tenantsExist(targetTenantIds);
      if (exist !== targetTenantIds.length) throw new BadRequestException('one or more target tenants do not exist');
    }

    let scheduledAt: string | null = null; let status = 'queued';
    if (body?.scheduledAt) { const d = new Date(body.scheduledAt); if (isNaN(d.getTime())) throw new BadRequestException('scheduledAt is not a valid date'); if (d.getTime() <= Date.now()) throw new BadRequestException('scheduledAt must be in the future'); scheduledAt = d.toISOString(); status = 'scheduled'; }

    const idempotencyKey = typeof body?.idempotencyKey === 'string' && body.idempotencyKey.trim() ? body.idempotencyKey.trim().slice(0, 120) : null;
    if (idempotencyKey) { const existing = await this.repo.findByIdempotency(idempotencyKey); if (existing) return { ok: true, idempotent: true, id: existing.id, recipientEstimate: existing.recipient_estimate, status: existing.status }; }

    const recipientEstimate = await this.repo.recipientEstimate(roles, targetScope, targetTenantIds);
    const createdBy = ctx.userId && validUuid(ctx.userId) ? ctx.userId : null;
    const { id } = await this.repo.insertAnnouncement({ title, subject, body: bodyText, channel, priority, recipientRoles: roles, targetScope, targetTenantIds, status, scheduledAt, recipientEstimate, idempotencyKey, createdBy });

    // Audit each targeted tenant (audit_events.tenant_id is NOT NULL). All-tenants sends are recorded authoritatively
    // by the platform_announcements row itself.
    if (targetScope === 'selected') { for (const t of targetTenantIds) await this.repo.writeAuditForTenant(t, ctx, 'announcement_created', `Platform announcement queued: ${title}`, { id, channel, roles, recipientEstimate }); }

    return { ok: true, idempotent: false, id, recipientEstimate, status, targetScope, channel, priority };
  }
}
