// Repository for platform announcements. In-memory impl is stateful so create + lifecycle are exercised without a
// database. listForOversight returns rows shaped for the marketing-overview engine (ownerType 'platform').

import type { AnnouncementInput, AnnouncementStatus } from './platform-announcement-core';

export interface AnnouncementRow {
  id: string; title: string; body: string | null; channel: string; audienceScope: string; status: string;
  scheduledAt: string | null; audienceSize: number; sentCount: number; openCount: number; clickCount: number;
  bookingCount: number; revenueCents: number; tenantIds: string[]; createdByUserId: string | null; createdAt: string;
  sentAt: string | null; cancelledAt: string | null; cancelReason: string | null;
}

/** Platform row for the marketing oversight engine (ownerType 'platform'). */
export interface OversightPlatformRow {
  id: string; ownerType: 'platform'; tenantId: null; tenantName: null; branchId: null; branchName: null;
  name: string; channel: string; audienceSize: number; status: string; scheduledAt: string | null;
  sentCount: number; openCount: number; clickCount: number; bookingCount: number; revenueCents: number;
}

export interface AnnouncementRepo {
  list(scope: { status?: string; cap?: number }): Promise<AnnouncementRow[]>;
  get(id: string): Promise<AnnouncementRow | null>;
  create(input: AnnouncementInput & { status: AnnouncementStatus; audienceSize: number; createdByUserId: string | null }): Promise<AnnouncementRow>;
  setStatus(id: string, status: AnnouncementStatus, extra?: { cancelReason?: string; sentAt?: string }): Promise<AnnouncementRow | null>;
  listForOversight(): Promise<OversightPlatformRow[]>;
}

let ASEQ = 1;
const norm = (s: string) => s.toLowerCase();

export class InMemoryAnnouncementRepo implements AnnouncementRepo {
  private rows: AnnouncementRow[] = [];

  async list(scope: { status?: string; cap?: number }): Promise<AnnouncementRow[]> {
    let r = [...this.rows].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    if (scope.status) r = r.filter((x) => x.status === scope.status);
    return r.slice(0, scope.cap ?? 200);
  }
  async get(id: string): Promise<AnnouncementRow | null> { return this.rows.find((r) => r.id === id) ?? null; }

  async create(input: AnnouncementInput & { status: AnnouncementStatus; audienceSize: number; createdByUserId: string | null }): Promise<AnnouncementRow> {
    const row: AnnouncementRow = {
      id: `PANN-${String(ASEQ++).padStart(4, '0')}`, title: String(input.title), body: input.body ?? null,
      channel: String(input.channel ?? 'email'), audienceScope: String(input.audienceScope ?? 'selected_tenants'),
      status: input.status, scheduledAt: input.scheduledAt ?? null, audienceSize: input.audienceSize,
      sentCount: 0, openCount: 0, clickCount: 0, bookingCount: 0, revenueCents: 0,
      tenantIds: (input.tenantIds ?? []).filter(Boolean), createdByUserId: input.createdByUserId, createdAt: new Date().toISOString(),
      sentAt: null, cancelledAt: null, cancelReason: null,
    };
    this.rows.push(row);
    return row;
  }
  async setStatus(id: string, status: AnnouncementStatus, extra?: { cancelReason?: string; sentAt?: string }): Promise<AnnouncementRow | null> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return null;
    row.status = status;
    if (status === 'cancelled') { row.cancelledAt = new Date().toISOString(); row.cancelReason = extra?.cancelReason ?? null; }
    if (status === 'sent') { row.sentAt = extra?.sentAt ?? new Date().toISOString(); }
    return row;
  }
  async listForOversight(): Promise<OversightPlatformRow[]> {
    return this.rows.filter((r) => norm(r.status) !== 'cancelled' || true).map((r) => ({
      id: r.id, ownerType: 'platform', tenantId: null, tenantName: null, branchId: null, branchName: null,
      name: r.title, channel: r.channel, audienceSize: r.audienceSize, status: r.status, scheduledAt: r.scheduledAt,
      sentCount: r.sentCount, openCount: r.openCount, clickCount: r.clickCount, bookingCount: r.bookingCount, revenueCents: r.revenueCents,
    }));
  }
}
