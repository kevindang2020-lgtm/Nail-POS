// membership-comms.repository.ts — port + in-memory adapter. Member comms are delivered in-app by inserting
// customer_notifications rows (the customer app already reads these). Reads resolve the member's name/plan/billing date
// for composing a message and find members due for a renewal reminder. The reference column makes delivery idempotent.

export interface CommsContext { tenantId: string; branchId: string; userId: string; role: string; permissions: string[] }
export interface MemberCommInfo { customerId: string; customerName: string | null; planName: string | null; nextBillingAt: string | null; status: string }
export interface DueMember {
  membershipId: string; customerId: string; customerName: string | null; planName: string | null;
  /** renewal: the next billing date; expiry: the date the membership ends */
  nextBillingAt: string | null;
  /** §151 SMS: the customer's phone (E.164) and the salon's name; absent → in-app only */
  phone?: string | null; salonName?: string | null; branchId?: string | null;
}
export interface NotificationInsert { type: string; title: string; body: string; reference: string }

export interface MembershipCommsRepositoryPort {
  memberCommInfo(ctx: CommsContext, membershipId: string): Promise<MemberCommInfo | null>;
  membersDueForReminder(ctx: CommsContext, withinDays: number): Promise<DueMember[]>;
  // System/scheduler surface: members due across ALL tenants. Each row carries its tenantId so the caller can scope every
  // write per-tenant (the read is intentionally cross-tenant, mirroring the billing run-renewals sweep).
  membersDueForReminderAllTenants(now: Date, withinDays: number, limit: number): Promise<Array<DueMember & { tenantId: string }>>;
  notificationExists(ctx: CommsContext, customerId: string, reference: string): Promise<boolean>;
  insertNotification(ctx: CommsContext, customerId: string, n: NotificationInsert): Promise<void>;
  /** §151: members whose membership ENDS (no renewal: canceling, auto-renew off, a fixed term) within the window. */
  membersExpiringAllTenants?(now: Date, withinDays: number, limit: number): Promise<Array<DueMember & { tenantId: string }>>;
  /** Insert the notification unless one with this reference exists — atomically (two sweeps → one row). true = inserted. */
  insertNotificationOnce?(ctx: CommsContext, customerId: string, n: NotificationInsert): Promise<boolean>;
  /** Membership Overview 10: which of these phones texted STOP / were opted out of SMS for this salon (notification_opt_outs). */
  smsOptedOut?(ctx: CommsContext, phones: string[]): Promise<Set<string>>;
}

interface StoredNotification { tenantId: string; customerId: string; type: string; title: string; body: string; reference: string }

export class InMemoryMembershipCommsRepository implements MembershipCommsRepositoryPort {
  private members = new Map<string, MemberCommInfo & { autoRenew: boolean; tenantId: string; phone?: string | null; salonName?: string | null; endsAt?: string | null }>();
  readonly notifications: StoredNotification[] = [];
  readonly optedOut = new Set<string>();   // `${tenantId}|${phone}`
  async smsOptedOut(ctx: CommsContext, phones: string[]): Promise<Set<string>> { return new Set(phones.filter((p) => this.optedOut.has(`${ctx.tenantId}|${p}`))); }

  seedMember(membershipId: string, info: MemberCommInfo, autoRenew = true, tenantId = 't1', extra: { phone?: string | null; salonName?: string | null; endsAt?: string | null } = {}) { this.members.set(membershipId, { ...info, autoRenew, tenantId, ...extra }); }

  async memberCommInfo(_c: CommsContext, membershipId: string): Promise<MemberCommInfo | null> {
    const m = this.members.get(membershipId);
    return m ? { customerId: m.customerId, customerName: m.customerName, planName: m.planName, nextBillingAt: m.nextBillingAt, status: m.status } : null;
  }

  async membersDueForReminder(_c: CommsContext, withinDays: number): Promise<DueMember[]> {
    const now = Date.now();
    const limit = now + withinDays * 86400000;
    const out: DueMember[] = [];
    for (const [membershipId, m] of this.members) {
      if (!m.autoRenew || !m.nextBillingAt) continue;
      if (!['active', 'trial'].includes(m.status)) continue;
      const t = new Date(m.nextBillingAt).getTime();
      if (t >= now && t <= limit) out.push({ membershipId, customerId: m.customerId, customerName: m.customerName, planName: m.planName, nextBillingAt: m.nextBillingAt, phone: m.phone ?? null, salonName: m.salonName ?? null });
    }
    return out;
  }

  async membersDueForReminderAllTenants(now: Date, withinDays: number, limit: number): Promise<Array<DueMember & { tenantId: string }>> {
    const base = now.getTime();
    const upper = base + withinDays * 86400000;
    const out: Array<DueMember & { tenantId: string }> = [];
    for (const [membershipId, m] of this.members) {
      if (!m.autoRenew || !m.nextBillingAt) continue;
      if (!['active', 'trial'].includes(m.status)) continue;
      const t = new Date(m.nextBillingAt).getTime();
      if (t >= base && t <= upper) out.push({ membershipId, tenantId: m.tenantId, customerId: m.customerId, customerName: m.customerName, planName: m.planName, nextBillingAt: m.nextBillingAt, phone: m.phone ?? null, salonName: m.salonName ?? null });
    }
    out.sort((a, b) => new Date(a.nextBillingAt || 0).getTime() - new Date(b.nextBillingAt || 0).getTime());
    return out.slice(0, limit);
  }

  async membersExpiringAllTenants(now: Date, withinDays: number, limit: number): Promise<Array<DueMember & { tenantId: string }>> {
    const base = now.getTime(); const upper = base + withinDays * 86400000;
    const out: Array<DueMember & { tenantId: string }> = [];
    for (const [membershipId, m] of this.members) {
      if (!m.endsAt || ['canceled', 'expired', 'completed'].includes(m.status)) continue;
      const t = new Date(m.endsAt).getTime();
      if (t >= base && t <= upper) out.push({ membershipId, tenantId: m.tenantId, customerId: m.customerId, customerName: m.customerName, planName: m.planName, nextBillingAt: m.endsAt, phone: m.phone ?? null, salonName: m.salonName ?? null });
    }
    return out.slice(0, limit);
  }

  async insertNotificationOnce(ctx: CommsContext, customerId: string, n: NotificationInsert): Promise<boolean> {
    if (this.notifications.some((x) => x.tenantId === ctx.tenantId && x.customerId === customerId && x.reference === n.reference)) return false;
    this.notifications.push({ tenantId: ctx.tenantId, customerId, ...n });
    return true;
  }

  async notificationExists(_c: CommsContext, customerId: string, reference: string): Promise<boolean> {
    return this.notifications.some((n) => n.customerId === customerId && n.reference === reference);
  }

  async insertNotification(ctx: CommsContext, customerId: string, n: NotificationInsert): Promise<void> {
    this.notifications.push({ tenantId: ctx.tenantId, customerId, ...n });
  }
}
