// Platform announcements service. Validates input, derives status, records targets, and gates lifecycle transitions.
// A platform announcement targets tenant users of selected (or all) tenants — never a tenant's own customers.

import { validateAnnouncementInput, initialStatus, canTransition, type AnnouncementInput, type AnnouncementStatus } from './platform-announcement-core';
import type { AnnouncementRepo, AnnouncementRow } from './platform-announcements.repository';

// Rough audience estimate when scope is all_tenants and the caller doesn't supply a count. Honest: this is an
// estimate, not a delivered count (delivery is NotConnected). Selected-tenants uses the target count as a proxy.
const estimateAudience = (input: AnnouncementInput, allTenantsCount: number): number =>
  input.audienceScope === 'all_tenants' ? allTenantsCount : (input.tenantIds ?? []).filter(Boolean).length;

export class PlatformAnnouncementsService {
  constructor(private readonly repo: AnnouncementRepo, private readonly allTenantsCount: () => Promise<number> = async () => 0) {}

  list(scope: { status?: string; cap?: number } = {}) { return this.repo.list(scope); }

  async create(input: AnnouncementInput & { createdByUserId?: string | null }): Promise<{ ok: boolean; errors?: string[]; announcement?: AnnouncementRow }> {
    const { errors } = validateAnnouncementInput(input);
    if (errors.length) return { ok: false, errors };
    const audienceSize = estimateAudience(input, await this.allTenantsCount());
    const announcement = await this.repo.create({ ...input, status: initialStatus(input), audienceSize, createdByUserId: input.createdByUserId ?? null });
    return { ok: true, announcement };
  }

  private async transition(id: string, to: AnnouncementStatus, extra?: { cancelReason?: string }): Promise<{ ok: boolean; errors?: string[]; announcement?: AnnouncementRow }> {
    const cur = await this.repo.get(id);
    if (!cur) return { ok: false, errors: ['Announcement not found.'] };
    if (cur.status === to) return { ok: true, announcement: cur }; // idempotent
    if (!canTransition(cur.status as AnnouncementStatus, to)) return { ok: false, errors: [`Cannot move a ${cur.status} announcement to ${to}.`] };
    const row = await this.repo.setStatus(id, to, extra);
    return row ? { ok: true, announcement: row } : { ok: false, errors: ['Announcement not found.'] };
  }

  schedule(id: string) { return this.transition(id, 'scheduled'); }
  send(id: string) { return this.transition(id, 'sending'); }
  cancel(id: string, reason: string) {
    if (!reason || !reason.trim()) return Promise.resolve({ ok: false, errors: ['A cancellation reason is required.'] });
    return this.transition(id, 'cancelled', { cancelReason: reason.trim() });
  }

  listForOversight() { return this.repo.listForOversight(); }
}
