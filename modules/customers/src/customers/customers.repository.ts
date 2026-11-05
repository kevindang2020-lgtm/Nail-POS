import { normalizePhone } from '../customer-activation-rules/customer-activation-core';
// customers.repository.ts — persistence port + in-memory adapter for POS Customers.
// A tenant-scoped, MUTABLE customer DB so create/edit/archive/notes/loyalty/merge changes genuinely persist.
// Filters (§18) are applied server-side. A different tenant sees its own (empty) DB — isolation. Merge never
// crosses tenants (the store is partitioned by tenant). Histories are read-only references for the detail view.
import {
  POSCustomersFullState, POSCustomerRow, POSCustomerDetail, CustomerFilters, CustomerListItem, CustomerListResponse, buildCustomersAnalytics,
  CustomerSource, DuplicateRisk, CustomerVisitRow, CustomerAppointmentRow, CustomerTicketRow, CustomerReceiptRow,
  CustomerNotes, CustomerLoyalty, CustomerMembership, CustomerGiftCard, DuplicateGroup, CreateCustomerRequest,
  EditCustomerRequest, CustomerKpis, CustomerInsights, POSCustomersKpisFull, Pagination, detectDuplicates, BulkCustomerInsert, BulkCustomerUpdate, CustomerVersionConflict } from './customers.dto';
import { clampPageSize, clampPage } from '@aipowersalon/api-contracts';

export interface CustomersContext { tenantId: string; branchId: string; userId: string; role: string; permissions: string[]; }

interface Cust {
  customerId: string; firstName: string; lastName: string; phone: string; email: string; avatarUrl?: string | null; status: 'active' | 'inactive' | 'archived';
  source: CustomerSource; visitCount: number; lastVisitAt: string | null; nextAppointmentAt: string | null;
  totalSpendCents: number; loyaltyPoints: number; loyaltyTier: string; isVip: boolean; tags: string[]; birthdayMonth?: number; birthday?: string;
  marketingOptIn: boolean; smsOptIn: boolean; emailOptIn: boolean; createdAt: string; updatedAt: string;
  preferredName?: string | null; preferredLanguage?: string | null; preferredBranchId?: string | null;   // Decision 1
  notes: CustomerNotes; loyalty: CustomerLoyalty; membership: CustomerMembership; giftCards: CustomerGiftCard[];
  visits: CustomerVisitRow[]; appointments: CustomerAppointmentRow[]; tickets: CustomerTicketRow[]; receipts: CustomerReceiptRow[];
  version?: number;
}

export interface CustomersRepositoryPort {
  /** Constitution 8: true when the repository writes domain events in its transactions. */
  emitsDomainEvents?(): boolean;
  /** Decision 1: is this one of the tenant's branches (for a customer's preferred branch)? */
  isTenantBranch?(ctx: CustomersContext, branchId: string): Promise<boolean>;
  query(ctx: CustomersContext, f: CustomerFilters): Promise<POSCustomersFullState>;
  detail(ctx: CustomersContext, id: string): Promise<POSCustomerDetail | null>;
  create(ctx: CustomersContext, req: CreateCustomerRequest): Promise<POSCustomerRow>;
  update(ctx: CustomersContext, id: string, req: EditCustomerRequest): Promise<POSCustomerRow | null>;
  setStatus(ctx: CustomersContext, id: string, status: 'active' | 'inactive' | 'archived'): Promise<POSCustomerRow | null>;
  findByContact(ctx: CustomersContext, phone?: string, email?: string, excludeId?: string): Promise<POSCustomerRow | null>;
  listContactKeys(ctx: CustomersContext): Promise<{ id: string; normalizedPhone: string | null; email: string | null; birthday: string | null }[]>;
  bulkInsertCustomers(ctx: CustomersContext, rows: BulkCustomerInsert[]): Promise<number>;
  bulkUpdateContactInfo(ctx: CustomersContext, updates: BulkCustomerUpdate[]): Promise<number>;
  visits(ctx: CustomersContext, id: string): Promise<CustomerVisitRow[] | null>;
  appointments(ctx: CustomersContext, id: string): Promise<CustomerAppointmentRow[] | null>;
  tickets(ctx: CustomersContext, id: string): Promise<CustomerTicketRow[] | null>;
  receipts(ctx: CustomersContext, id: string): Promise<CustomerReceiptRow[] | null>;
  getNotes(ctx: CustomersContext, id: string): Promise<CustomerNotes | null>;
  setNotes(ctx: CustomersContext, id: string, n: CustomerNotes): Promise<CustomerNotes | null>;
  getTags(ctx: CustomersContext, id: string): Promise<string[] | null>;
  setTags(ctx: CustomersContext, id: string, t: string[]): Promise<string[] | null>;
  getLoyalty(ctx: CustomersContext, id: string): Promise<CustomerLoyalty | null>;
  getLoyaltyLedger(ctx: CustomersContext, id: string): Promise<any[] | null>;
  adjustLoyaltyPoints(ctx: CustomersContext, id: string, b: any): Promise<any | null>;
  setLoyalty(ctx: CustomersContext, id: string, l: CustomerLoyalty): Promise<CustomerLoyalty | null>;
  getMembership(ctx: CustomersContext, id: string): Promise<CustomerMembership | null>;
  setMembership(ctx: CustomersContext, id: string, m: CustomerMembership): Promise<CustomerMembership | null>;
  getGiftCards(ctx: CustomersContext, id: string): Promise<CustomerGiftCard[] | null>;
  duplicates(ctx: CustomersContext): Promise<DuplicateGroup[]>;
  merge(ctx: CustomersContext, groupId: string, primaryId: string): Promise<POSCustomerDetail | null>;
  /** Functional Decision 29: remember Keep Separate / Not Sure for every pair in a duplicate group. */
  decideDuplicate(ctx: CustomersContext, groupId: string, decision: 'keep_separate' | 'not_sure'): Promise<boolean>;
  exportRows(ctx: CustomersContext, f: CustomerFilters): Promise<{ headers: string[]; rows: (string | number)[][] }>;
}

const now = () => new Date().toISOString();
const daysAgoISO = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); };
function defNotes(): CustomerNotes { return { salonNotes: '', allergyNotes: '', preferredStyle: '', preferredTechnician: '', servicePreferences: '', warnings: '', customerVisible: false }; }
function defLoyalty(points: number, tier: string): CustomerLoyalty { return { points, earned: points, redeemed: 0, tier, tierThresholdPoints: 500, birthdayReward: true, referralReward: true }; }
function defMembership(): CustomerMembership { return { plan: 'None', status: 'none', benefits: [], billingStatus: 'n/a' }; }

export class InMemoryCustomersRepository implements CustomersRepositoryPort {
  /** Decision 1: the in-memory twin knows the caller's branch and any branches added here. */
  extraBranchIds: string[] = [];
  async isTenantBranch(ctx: CustomersContext, branchId: string) { return branchId === ctx.branchId || this.extraBranchIds.includes(branchId); }
  private store = new Map<string, Cust[]>();
  private seq = 5000;

  private ensure(tenantId: string) {
    if (this.store.has(tenantId)) return;
    if (tenantId !== 'luxe001') { this.store.set(tenantId, []); return; }
    const mk = (id: string, fn: string, ln: string, phone: string, email: string, src: CustomerSource, visits: number, lastDays: number | null, spend: number, points: number, tier: string, vip: boolean, tags: string[], bmonth: number, over: Partial<Cust> = {}): Cust => ({
      customerId: id, firstName: fn, lastName: ln, phone, email, status: 'active', source: src, visitCount: visits,
      lastVisitAt: lastDays == null ? null : daysAgoISO(lastDays), nextAppointmentAt: null, totalSpendCents: spend,
      loyaltyPoints: points, loyaltyTier: tier, isVip: vip, tags, birthdayMonth: bmonth, marketingOptIn: true, smsOptIn: true, emailOptIn: !!email,
      createdAt: daysAgoISO(lastDays == null ? 1 : lastDays + 30), updatedAt: now(), notes: defNotes(), loyalty: defLoyalty(points, tier), membership: defMembership(), giftCards: [],
      visits: visits > 0 ? [{ visitId: id + '_v1', date: daysAgoISO(lastDays || 1), serviceName: 'Signature Manicure', technicianName: 'Mia', totalCents: Math.round(spend / Math.max(1, visits)), tipCents: 800 }] : [],
      appointments: [], tickets: visits > 0 ? [{ ticketId: id + '_t1', date: daysAgoISO(lastDays || 1), totalCents: Math.round(spend / Math.max(1, visits)), paymentMethod: 'card', status: 'closed' }] : [],
      receipts: visits > 0 ? [{ receiptId: id + '_r1', date: daysAgoISO(lastDays || 1), totalCents: Math.round(spend / Math.max(1, visits)), channel: 'sms' }] : [], ...over,
    });
    const today = new Date().getMonth() + 1;
    this.store.set(tenantId, [
      mk('cust_grace', 'Grace', 'Kim', '+18565550101', 'grace@example.com', 'booking', 12, 4, 540000, 620, 'VIP Gold', true, ['VIP', 'High value'], today),
      mk('cust_nora', 'Nora', 'Patel', '+18565550102', 'nora@example.com', 'google', 3, 12, 78000, 90, 'Regular', false, ['New client'], 3),
      mk('cust_liv', 'Liv', 'Chen', '+18565550103', 'liv@example.com', 'walk_in', 7, 20, 210000, 240, 'Silver', false, ['Returning'], 6),
      mk('cust_ivy', 'Ivy', 'Park', '+18565550104', '', 'walk_in', 1, 75, 6500, 10, 'Regular', false, ['No-show risk'], 9), // inactive 60+ days
      // deliberate duplicate pair: same phone, different name (for duplicate/merge tests)
      mk('cust_dup_a', 'Sam', 'Rivera', '+18565550199', 'sam@example.com', 'manual', 2, 30, 30000, 40, 'Regular', false, [], 1),
      mk('cust_dup_b', 'Samuel', 'Rivera', '+18565550199', '', 'import', 1, 45, 12000, 0, 'Regular', false, [], 1),
    ]);
  }
  private L(ctx: CustomersContext) { this.ensure(ctx.tenantId); return this.store.get(ctx.tenantId)!; }
  private find(ctx: CustomersContext, id: string) { return this.L(ctx).find((c) => c.customerId === id) || null; }
  private bool(v?: string) { return v === 'true' || v === 'yes' || v === '1'; }
  private async dupSet(ctx: CustomersContext): Promise<Map<string, DuplicateRisk>> {
    const groups = await this.duplicates(ctx); const m = new Map<string, DuplicateRisk>();
    for (const g of groups) { const risk: DuplicateRisk = /phone|email/i.test(g.reason) ? 'high' : 'possible'; for (const mem of g.members) if ((m.get(mem.customerId) ?? 'none') !== 'high') m.set(mem.customerId, risk); }
    return m;
  }
  private avgSpend(c: Cust) { return c.visitCount > 0 ? Math.round(c.totalSpendCents / c.visitCount) : 0; }
  private daysSince(iso: string | null) { return iso == null ? Infinity : Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); }

  private toRow(ctx: CustomersContext, c: Cust, dup: Map<string, DuplicateRisk>): POSCustomerRow {
    return {
      customerId: c.customerId, tenantId: ctx.tenantId, branchId: ctx.branchId, firstName: c.firstName, lastName: c.lastName,
      displayName: `${c.firstName} ${c.lastName}`.trim(), phone: c.phone, email: c.email, status: c.status, source: c.source,
      visitCount: c.visitCount, lastVisitAt: c.lastVisitAt, nextAppointmentAt: c.nextAppointmentAt, totalSpendCents: c.totalSpendCents,
      averageSpendCents: this.avgSpend(c), loyaltyPoints: c.loyaltyPoints, loyaltyTier: c.loyaltyTier, isVip: c.isVip, tags: c.tags,
      duplicateRisk: dup.get(c.customerId) || 'none', marketingOptIn: c.marketingOptIn, smsOptIn: c.smsOptIn, emailOptIn: c.emailOptIn,
      preferredName: c.preferredName ?? null, preferredLanguage: c.preferredLanguage ?? null, preferredBranchId: c.preferredBranchId ?? null,
      createdAt: c.createdAt, updatedAt: c.updatedAt, version: c.version ?? 1,
    };
  }

  private filtered(ctx: CustomersContext, f: CustomerFilters, dup: Map<string, DuplicateRisk>): Cust[] {
    let rows = this.L(ctx).slice();
    if (f.search) { const q = f.search.toLowerCase(); rows = rows.filter((c) => [c.firstName, c.lastName, c.preferredName, c.phone, c.email, ...c.tags].some((x) => (x || '').toLowerCase().includes(q))); }
    if (f.status) rows = rows.filter((c) => c.status === f.status);
    if (f.loyaltyTier) rows = rows.filter((c) => c.loyaltyTier === f.loyaltyTier);
    if (f.source) rows = rows.filter((c) => c.source === f.source);
    if (f.tag) rows = rows.filter((c) => c.tags.includes(f.tag!));
    if (f.birthdayMonth) rows = rows.filter((c) => c.birthdayMonth === Number(f.birthdayMonth));
    if (f.marketingOptIn) rows = rows.filter((c) => c.marketingOptIn === this.bool(f.marketingOptIn));
    if (f.duplicateRisk) rows = rows.filter((c) => (dup.get(c.customerId) || 'none') === f.duplicateRisk);
    if (f.inactiveDays != null) rows = rows.filter((c) => this.daysSince(c.lastVisitAt) >= Number(f.inactiveDays));
    if (f.segment === 'new') rows = rows.filter((c) => c.visitCount <= 1);
    if (f.segment === 'returning') rows = rows.filter((c) => c.visitCount > 1);
    if (f.segment === 'vip') rows = rows.filter((c) => c.isVip);
    return rows;
  }

  async query(ctx: CustomersContext, f: CustomerFilters) {
    const all = this.L(ctx);
    const dup = await this.dupSet(ctx);
    const matched = this.filtered(ctx, f, dup);
    const page = clampPage(f.page), pageSize = clampPageSize(f.pageSize, 20);
    const totalItems = matched.length, totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const pageRows = matched.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
    const pagination: Pagination = { page, pageSize, totalItems, totalPages };

    const listItems: CustomerListItem[] = pageRows.map((c) => ({
      customerId: c.customerId, fullName: `${c.firstName} ${c.lastName}`.trim(), phone: c.phone, normalizedPhone: normalizePhone(c.phone || '') ?? null, email: c.email,
      visitsCount: c.visitCount, favoriteServiceName: c.visits[0]?.serviceName, favoriteTechnicianName: c.visits[0]?.technicianName,
      loyaltyTier: (c.loyaltyTier as any) || 'Regular', lastVisitDate: c.lastVisitAt || undefined, totalSpendCents: c.totalSpendCents, status: c.status as any,
    }));
    const rowItems: POSCustomerRow[] = pageRows.map((c) => this.toRow(ctx, c, dup));
    const active = all.filter((c) => c.status === 'active');
    const avgSpendAll = all.length ? Math.round(all.reduce((a, c) => a + c.totalSpendCents, 0) / all.length) : 0;
    const thisMonth = new Date().getMonth() + 1;

    const kpis: CustomerKpis = {
      totalCustomers: all.length, totalCustomersTrendPercent: 0, newThisMonth: all.filter((c) => c.visitCount <= 1).length, newThisMonthTrendPercent: 0,
      vipMembers: all.filter((c) => c.isVip).length, vipPercentOfTotal: all.length ? Math.round((all.filter((c) => c.isVip).length / all.length) * 100) : 0,
      returningRatePercent: all.length ? Math.round((all.filter((c) => c.visitCount > 1).length / all.length) * 100) : 0, returningRateTrendPercent: 0,
      birthdaysThisWeek: all.filter((c) => c.birthdayMonth === thisMonth).length, birthdayCustomerAvatars: [], birthdayExtraCount: 0,
    };
    const kpisFull: POSCustomersKpisFull = {
      totalCustomers: all.length, newCustomersToday: all.filter((c) => this.daysSince(c.createdAt) === 0).length,
      returningCustomersToday: all.filter((c) => c.visitCount > 1 && this.daysSince(c.lastVisitAt) === 0).length,
      vipCustomers: all.filter((c) => c.isVip).length, birthdayThisMonth: all.filter((c) => c.birthdayMonth === thisMonth).length,
      inactiveCustomers: all.filter((c) => this.daysSince(c.lastVisitAt) >= 60).length, duplicateProfiles: dup.size,
      loyaltyMembers: all.filter((c) => c.loyaltyPoints > 0 || c.loyaltyTier !== 'Regular').length, averageSpendCents: avgSpendAll,
    };

    return {
      kpis, customers: { items: listItems, pagination } as CustomerListResponse,
      filters: { statuses: ['active', 'inactive', 'archived'], loyaltyTiers: ['VIP Gold', 'VIP Silver', 'Gold', 'Silver', 'Regular'] },
      kpisFull, analytics: buildCustomersAnalytics(all.map((c) => ({ totalSpendCents: c.totalSpendCents, visitCount: c.visitCount, recencyDays: this.daysSince(c.lastVisitAt), ageYears: c.birthday ? new Date().getFullYear() - new Date(c.birthday).getFullYear() : undefined }))), rows: { items: rowItems, pagination },
      filterFacets: {
        segments: ['new', 'returning', 'vip'], statuses: ['active', 'inactive', 'archived'],
        loyaltyTiers: [...new Set(all.map((c) => c.loyaltyTier))], visitRanges: ['0', '1-3', '4-9', '10+'],
        spendRanges: ['0-5000', '5001-20000', '20001+'], sources: [...new Set(all.map((c) => c.source))], tags: [...new Set(all.flatMap((c) => c.tags))],
      },
    };
  }

  async detail(ctx: CustomersContext, id: string) {
    const c = this.find(ctx, id); if (!c) return null;
    const dup = await this.dupSet(ctx);
    return { ...this.toRow(ctx, c, dup), notes: c.notes, loyalty: c.loyalty, membership: c.membership, giftCards: c.giftCards, recentVisits: c.visits, auditSummary: [{ lastAction: 'updated', lastActorRole: ctx.role, lastAt: c.updatedAt }] };
  }

  async findByContact(ctx: CustomersContext, phone?: string, email?: string, excludeId?: string) {
    const dup = await this.dupSet(ctx);
    const hit = this.L(ctx).find((c) => c.customerId !== excludeId && ((phone && c.phone === phone) || (email && c.email && c.email.toLowerCase() === email.toLowerCase())));
    return hit ? this.toRow(ctx, hit, dup) : null;
  }

  async create(ctx: CustomersContext, req: CreateCustomerRequest) {
    const c: Cust = {
      customerId: 'cust_' + (++this.seq), firstName: req.firstName, lastName: req.lastName || '', phone: req.phone || '', email: req.email || '',
      status: 'active', source: req.source || 'manual', visitCount: 0, lastVisitAt: null, nextAppointmentAt: null, totalSpendCents: 0,
      loyaltyPoints: 0, loyaltyTier: 'Regular', isVip: !!req.isVip, tags: req.tags || [], birthdayMonth: req.birthday ? new Date(req.birthday).getMonth() + 1 : undefined,
      marketingOptIn: req.marketingOptIn ?? false, smsOptIn: req.smsOptIn ?? false, emailOptIn: req.emailOptIn ?? false, createdAt: now(), updatedAt: now(),
      notes: { ...defNotes(), salonNotes: req.notes || '' }, loyalty: defLoyalty(0, 'Regular'), membership: defMembership(), giftCards: [], visits: [], appointments: [], tickets: [], receipts: [],
    };
    this.L(ctx).push(c); return this.toRow(ctx, c, await this.dupSet(ctx));
  }
  async listContactKeys(ctx: CustomersContext) {
    return this.L(ctx).map((c) => ({ id: c.customerId, normalizedPhone: (c.phone || '').replace(/[^\d+]/g, '') || null, email: c.email || null, birthday: c.birthday ?? null }));
  }
  async bulkInsertCustomers(ctx: CustomersContext, rows: BulkCustomerInsert[]) {
    let n = 0;
    for (const r of rows) {
      const c: Cust = {
        customerId: 'cust_' + (++this.seq), firstName: r.firstName, lastName: r.lastName || '', phone: r.phoneDisplay || '', email: r.email || '',
        status: 'active', source: 'manual', visitCount: 0, lastVisitAt: null, nextAppointmentAt: null, totalSpendCents: 0,
        loyaltyPoints: 0, loyaltyTier: 'Regular', isVip: false, tags: [], birthday: r.birthday || undefined, birthdayMonth: r.birthday ? new Date(r.birthday).getMonth() + 1 : undefined,
        marketingOptIn: false, smsOptIn: false, emailOptIn: false, createdAt: now(), updatedAt: now(),
        notes: defNotes(), loyalty: defLoyalty(0, 'Regular'), membership: defMembership(), giftCards: [], visits: [], appointments: [], tickets: [], receipts: [],
      };
      this.L(ctx).push(c); n++;
    }
    return n;
  }
  async bulkUpdateContactInfo(ctx: CustomersContext, updates: BulkCustomerUpdate[]) {
    let n = 0; const list = this.L(ctx);
    for (const u of updates) {
      const c = list.find((x) => x.customerId === u.customerId); if (!c) continue;
      let changed = false;
      if (u.birthday && !c.birthday) { c.birthday = u.birthday; c.birthdayMonth = new Date(u.birthday).getMonth() + 1; changed = true; }
      if (u.email && !(c.email || '').trim()) { c.email = u.email; changed = true; }
      if (u.normalizedPhone && !((c.phone || '').replace(/[^\d+]/g, ''))) { c.phone = u.phoneDisplay || u.normalizedPhone; changed = true; }
      if (changed) { c.updatedAt = now(); n++; }
    }
    return n;
  }
  async update(ctx: CustomersContext, id: string, req: EditCustomerRequest) {
    const c = this.find(ctx, id); if (!c) return null;
    if (req.expectedVersion != null && (c.version ?? 1) !== req.expectedVersion) throw new CustomerVersionConflict(c.version ?? 1);
    if (req.firstName != null) c.firstName = req.firstName; if (req.lastName != null) c.lastName = req.lastName;
    if (req.phone != null) c.phone = req.phone; if (req.email != null) c.email = req.email;
    if (req.tags != null) c.tags = req.tags; if (req.isVip != null) c.isVip = req.isVip; if (req.source != null) c.source = req.source;
    if (req.marketingOptIn != null) c.marketingOptIn = req.marketingOptIn; if (req.smsOptIn != null) c.smsOptIn = req.smsOptIn; if (req.emailOptIn != null) c.emailOptIn = req.emailOptIn;
    if (req.status != null) c.status = req.status;
    if (req.preferredName !== undefined) c.preferredName = req.preferredName || null;
    if (req.preferredLanguage !== undefined) c.preferredLanguage = req.preferredLanguage || null;
    if (req.preferredBranchId !== undefined) c.preferredBranchId = req.preferredBranchId || null;
    c.version = (c.version ?? 1) + 1; c.updatedAt = now(); return this.toRow(ctx, c, await this.dupSet(ctx));
  }
  async setStatus(ctx: CustomersContext, id: string, status: 'active' | 'inactive' | 'archived') { const c = this.find(ctx, id); if (!c) return null; c.status = status; c.updatedAt = now(); return this.toRow(ctx, c, await this.dupSet(ctx)); }

  async visits(ctx: CustomersContext, id: string) { return this.find(ctx, id)?.visits ?? null; }
  async appointments(ctx: CustomersContext, id: string) { return this.find(ctx, id)?.appointments ?? null; }
  async tickets(ctx: CustomersContext, id: string) { return this.find(ctx, id)?.tickets ?? null; }
  async receipts(ctx: CustomersContext, id: string) { return this.find(ctx, id)?.receipts ?? null; }
  async getNotes(ctx: CustomersContext, id: string) { return this.find(ctx, id)?.notes ?? null; }
  async setNotes(ctx: CustomersContext, id: string, n: CustomerNotes) { const c = this.find(ctx, id); if (!c) return null; c.notes = n; c.updatedAt = now(); return c.notes; }
  async getTags(ctx: CustomersContext, id: string) { return this.find(ctx, id)?.tags ?? null; }
  async setTags(ctx: CustomersContext, id: string, t: string[]) { const c = this.find(ctx, id); if (!c) return null; c.tags = t; c.updatedAt = now(); return c.tags; }
  async getLoyalty(ctx: CustomersContext, id: string) { return this.find(ctx, id)?.loyalty ?? null; }
  async setLoyalty(ctx: CustomersContext, id: string, l: CustomerLoyalty) { const c = this.find(ctx, id); if (!c) return null; c.loyalty = l; c.loyaltyPoints = l.points; c.loyaltyTier = l.tier; c.updatedAt = now(); return c.loyalty; }
  async getLoyaltyLedger(ctx: CustomersContext, id: string): Promise<any[] | null> { return this.find(ctx, id) ? [] : null; }
  async adjustLoyaltyPoints(ctx: CustomersContext, id: string, b: any): Promise<any | null> { return this.find(ctx, id) ? null : null; }
  async getMembership(ctx: CustomersContext, id: string) { return this.find(ctx, id)?.membership ?? null; }
  async setMembership(ctx: CustomersContext, id: string, m: CustomerMembership) { const c = this.find(ctx, id); if (!c) return null; c.membership = m; c.updatedAt = now(); return c.membership; }
  async getGiftCards(ctx: CustomersContext, id: string) { return this.find(ctx, id)?.giftCards ?? null; }

  private decisions = new Map<string, string>();   // tenant::a|b -> keep_separate | not_sure
  private pairs(ids: string[]) { const out: string[] = []; for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) out.push(ids[i] < ids[j] ? ids[i] + '|' + ids[j] : ids[j] + '|' + ids[i]); return out; }
  async duplicates(ctx: CustomersContext) {
    const groups = detectDuplicates(this.L(ctx).filter((c) => c.status !== 'archived').map((c) => ({ customerId: c.customerId, firstName: c.firstName, lastName: c.lastName, phone: c.phone, email: c.email })));
    return groups.flatMap((g) => {
      const ps = this.pairs(g.members.map((m) => m.customerId)).map((p) => this.decisions.get(ctx.tenantId + '::' + p));
      if (ps.length && ps.every((d) => d === 'keep_separate')) return [];
      return [{ ...g, notSure: ps.some((d) => d === 'not_sure') }];
    });
  }
  async decideDuplicate(ctx: CustomersContext, groupId: string, decision: 'keep_separate' | 'not_sure') {
    const g = (await this.duplicates(ctx)).find((x) => x.duplicateGroupId === groupId); if (!g) return false;
    for (const p of this.pairs(g.members.map((m) => m.customerId))) this.decisions.set(ctx.tenantId + '::' + p, decision);
    return true;
  }
  async merge(ctx: CustomersContext, groupId: string, primaryId: string) {
    const group = (await this.duplicates(ctx)).find((g) => g.duplicateGroupId === groupId); if (!group) return null;
    const primary = this.find(ctx, primaryId); if (!primary || !group.members.some((m) => m.customerId === primaryId)) return null;
    for (const mem of group.members) {
      if (mem.customerId === primaryId) continue;
      const src = this.find(ctx, mem.customerId); if (!src) continue;
      // move history + loyalty + tags to the primary profile; keep audit record of merged id
      primary.visits.push(...src.visits); primary.appointments.push(...src.appointments); primary.tickets.push(...src.tickets); primary.receipts.push(...src.receipts);
      primary.visitCount += src.visitCount; primary.totalSpendCents += src.totalSpendCents; primary.loyaltyPoints += src.loyaltyPoints;
      primary.loyalty.points += src.loyalty.points; primary.tags = [...new Set([...primary.tags, ...src.tags])];
      if (!primary.email && src.email) primary.email = src.email;
      src.status = 'archived'; src.tags = [...new Set([...src.tags, 'merged'])]; src.updatedAt = now();
    }
    primary.updatedAt = now();
    return this.detail(ctx, primaryId);
  }

  async exportRows(ctx: CustomersContext, f: CustomerFilters) {
    const dup = await this.dupSet(ctx); const rows = this.filtered(ctx, f, dup);
    return { headers: ['Id', 'Name', 'Phone', 'Email', 'Status', 'Source', 'Visits', 'TotalSpend', 'Tier', 'VIP', 'MarketingOptIn'], rows: rows.map((c) => [c.customerId, `${c.firstName} ${c.lastName}`, c.phone, c.email, c.status, c.source, c.visitCount, c.totalSpendCents, c.loyaltyTier, c.isVip ? 'yes' : 'no', c.marketingOptIn ? 'yes' : 'no']) };
  }
}
