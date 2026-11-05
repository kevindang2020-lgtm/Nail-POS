// customers.service.ts — tenant POS Customers. Resolves tenant/role from session; enforces per-action
// permissions; validates + flags duplicates; preserves history; merges only with confirmation; audits.
// ASYNC: the repository is async (Postgres/Kysely or in-memory), so every use-case awaits the repo.
import { parseBirthdayInput } from '../birthdays/birthday-core';
import { utcDate } from '@aipowersalon/date-time';
import { type EntitlementsService, AutomationEngineService } from '@aipowersalon/platform';
import { type RealtimeEmitter, EVENTS, makeEnvelope } from '@aipowersalon/realtime-contracts';
import { hasPermission, isStaffPrincipal } from '@aipowersalon/permissions';
import {
  POSCustomersFullState, CustomerFilters, CustomerListResponse, POSCustomerRow, POSCustomerDetail,
  CreateCustomerRequest, EditCustomerRequest, CustomerVisitRow, CustomerAppointmentRow, CustomerTicketRow,
  CustomerReceiptRow, CustomerNotes, CustomerLoyalty, CustomerMembership, CustomerGiftCard, DuplicateGroup,
  customersToCsv,
  CustomerImportRow, CustomerImportPreview, CustomerImportResult, CustomerImportOptions, BulkCustomerInsert, BulkCustomerUpdate,
  parseCustomerCsv, detectCustomerColumns, splitFullName, normalizeImportPhone, cleanImportEmail, parseImportBirthday,
  PREFERRED_NAME_MAX, PREFERRED_LANGUAGE_MAX,
} from './customers.dto';
import { CustomersContext, CustomersRepositoryPort } from './customers.repository';
import type { AuditService } from '@aipowersalon/audit';

export class ForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError'; } }
import { normalizeCustomerLanguage, withCode } from '@aipowersalon/api-contracts';
/** detail (Vietnamese POS §2 / §21 / §58, Oct 27 2026 — additive): a stable code / field / rule / params beside the English
 *  message, so the POS words it in the cashier's language (ns/errors) — the message stays the English fallback. */
export interface ValidationDetail { code?: string; field?: string; rule?: string; params?: Record<string, string | number> }
export class ValidationError extends Error { constructor(msg: string, readonly detail?: ValidationDetail) { super(msg); this.name = 'ValidationError'; } }
// a loyalty rule (reason missing, below zero, …) is the caller's mistake, not a server error
const directEditRefused = () => withCode(new ValidationError("A customer's points can't be set or lowered by the salon. Ask for bonus points instead — the owner approves them."), 'LOYALTY_DIRECT_EDIT_REFUSED');
const loyaltyError = (e: any): never => { throw (e?.name === 'LoyaltyLedgerError' || /below 0|Invalid amount/.test(String(e?.message)) ? new ValidationError(String(e.message)) : e); };


export interface POSCustomersAuditLog {
  tenantId: string; branchId?: string; userId: string; role: string; actionType: string; entityType: string;
  entityId?: string; before?: Record<string, unknown>; after?: Record<string, unknown>; metadata?: Record<string, unknown>; createdAt: string;
}

/** Structural port: the identity service without importing it (keeps module coupling one-way). */
export interface IdentityLinkLike {
  ensureLinked(c: { tenantId: string; customerId: string; firstName?: string | null; lastName?: string | null; fullName?: string | null; phoneRaw?: string | null; email?: string | null }, source?: 'realtime' | 'reconciliation' | 'activation' | 'import'): Promise<unknown>;
  /** Bounded post-import linking; anything beyond the cap is left to the nightly reconciliation. */
  linkUnlinkedForTenant?(tenantId: string, cap?: number): Promise<{ linked: number; newGlobals: number; review: number; deferred: boolean }>;
}

export class CustomersService {
  private audit: POSCustomersAuditLog[] = [];
  constructor(private readonly repo: CustomersRepositoryPort, private readonly auditSvc?: AuditService, private readonly entitlements?: EntitlementsService, private readonly engine: AutomationEngineService | null = null, private readonly identity?: IdentityLinkLike, private readonly realtime?: RealtimeEmitter) {}

  /** §7/§8 real-time duplicate prevention: after a tenant customer exists, resolve-or-create the GLOBAL identity
   *  and link it. Best-effort by design — identity linking must never fail a salon's customer create; the 7 PM
   *  reconciliation is the safety net. Nothing is copied INTO this tenant's row: only the link is written. */
  private async linkGlobalIdentity(ctx: CustomersContext, row: POSCustomerRow, req: CreateCustomerRequest): Promise<void> {
    if (!this.identity) return;
    try {
      await this.identity.ensureLinked({
        tenantId: ctx.tenantId, customerId: row.customerId,
        firstName: req.firstName ?? null, lastName: req.lastName ?? null,
        fullName: `${req.firstName || ''} ${req.lastName || ''}`.trim() || null,
        phoneRaw: req.phone ?? null, email: req.email ?? null,
      }, 'realtime');
    } catch { /* never blocks the create */ }
  }

  private assertUser(ctx: CustomersContext) {
    if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated');
    if (!isStaffPrincipal(ctx)) throw new ForbiddenError('Customers are not available for this role');
  }
  private need(ctx: CustomersContext, perm: string) { this.assertUser(ctx); if (!hasPermission(ctx as any, perm)) throw new ForbiddenError('Missing ' + perm); }
  private log(ctx: CustomersContext, actionType: string, entityType: string, entityId?: string, before?: any, after?: any, metadata?: any) {
    this.audit.push({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType, entityType, entityId, before, after, metadata, createdAt: new Date().toISOString() });
    // Persist to the durable, tenant-scoped audit trail (best-effort). Customer merges/archives/edits are
    // compliance-relevant, so they belong in the unified audit_events store the S22 screen reads.
    void this.auditSvc?.record(
      { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role },
      { module: 'customers', action: actionType, resourceType: entityType, resourceId: entityId, metadata },
    );
  }
  auditLog(): POSCustomersAuditLog[] { return this.audit.slice(); }
  private mustFind<T>(v: T | null, msg = 'Customer not found'): T { if (v === null || v === undefined) throw new ValidationError(msg); return v; }
  private validEmail(e?: string) { return !e || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); }
  private validPhone(p?: string) { return !p || /^[+()\-\s\d]{7,}$/.test(p); }

  // ---- read ----
  /** money on customer records (spend, CLV, visits' amounts) needs financial or report access */
  private canSeeMoney(ctx: CustomersContext): boolean { const c = ctx as Parameters<typeof hasPermission>[0]; return hasPermission(c, 'pos.customers.financial.view') || hasPermission(c, 'pos.reports.view'); }
  async getState(ctx: CustomersContext, f: CustomerFilters = {}): Promise<POSCustomersFullState> { 
    this.need(ctx, 'pos.customers.view'); 
    const st = await this.repo.query(ctx, f); 
    this.log(ctx, 'pos_customers_viewed', 'pos_customer', undefined, undefined, undefined, { filters: f }); 
    const canSeeFinancial = this.canSeeMoney(ctx);
    if (!canSeeFinancial) {
      st.customers.items.forEach(c => c.totalSpendCents = 0);
      st.rows.items.forEach(r => { r.totalSpendCents = 0; r.averageSpendCents = 0; });
      st.kpisFull.averageSpendCents = 0;
      st.analytics.lifetimeValue.totalRevenueCents = 0;
      st.analytics.lifetimeValue.avgClvCents = 0;
      if (st.trends) { st.trends.avgSpend = null; st.trends.clv = null; }
    }
    return st; 
  }
  async getKpis(ctx: CustomersContext) { return (await this.getState(ctx)).kpisFull; }
  async list(ctx: CustomersContext, f: CustomerFilters = {}): Promise<CustomerListResponse> { 
    this.need(ctx, 'pos.customers.view'); 
    const res = (await this.repo.query(ctx, f)).customers; 
    const canSeeFinancial = this.canSeeMoney(ctx);
    if (!canSeeFinancial) res.items.forEach(c => c.totalSpendCents = 0);
    return res; 
  }
  async search(ctx: CustomersContext, f: CustomerFilters = {}): Promise<CustomerListResponse> { return this.list(ctx, f); }
  async detail(ctx: CustomersContext, id: string): Promise<POSCustomerDetail> { 
    this.need(ctx, 'pos.customers.view'); 
    const d = this.mustFind(await this.repo.detail(ctx, id)); 
    const canSeeFinancial = this.canSeeMoney(ctx);
    if (!canSeeFinancial) { d.totalSpendCents = 0; d.averageSpendCents = 0; d.recentVisits = []; d.giftCards = []; }
    const canSeeNotes = hasPermission(ctx as any, 'pos.customers.notes.view');
    if (!canSeeNotes) { d.notes = { salonNotes: '', allergyNotes: '', preferredStyle: '', preferredTechnician: '', servicePreferences: '', warnings: '', customerVisible: false }; }
    return d; 
  }

  // ---- create / edit (with duplicate flagging) ----
  async create(ctx: CustomersContext, req: CreateCustomerRequest): Promise<POSCustomerRow> {
    this.need(ctx, 'pos.customers.create');
    if ((!req.firstName || !req.firstName.trim()) && (!req.phone || !req.phone.trim())) throw withCode(new ValidationError('First name or phone is required', { field: 'firstName', rule: 'REQUIRED_ONE_OF', params: { other: 'phone' } }), 'NAME_OR_PHONE_REQUIRED');
    if (!this.validPhone(req.phone)) throw withCode(new ValidationError('Phone is not valid', { field: 'phone', rule: 'FORMAT' }), 'PHONE_INVALID');
    if (!this.validEmail(req.email)) throw withCode(new ValidationError('Email is not valid', { field: 'email', rule: 'FORMAT' }), 'EMAIL_INVALID');
    req = this.cleanBirthday(req);   // Birthday Campaigns §05: a calendar date, validated (never a future date, never a guessed year)
    const existing = await this.repo.findByContact(ctx, req.phone, req.email);
    if (existing) throw new ValidationError(`Possible duplicate of "${existing.displayName}" (same phone/email). Review duplicates or merge instead of saving blindly.`, { code: 'CUSTOMER_POSSIBLE_DUPLICATE', params: { name: String(existing.displayName ?? '') } });
    if (this.entitlements) await this.entitlements.assertCanCreate(ctx.tenantId, 'customers');
    const row = await this.repo.create(ctx, req); this.log(ctx, 'pos_customer_created', 'pos_customer', row.customerId, undefined, row);
    await this.linkGlobalIdentity(ctx, row, req);
    return row;
  }
  // Decision 1: preferred name / language / branch are profile fields (pos.customers.edit), not private notes. Trimmed;
  // '' clears; length-limited; the branch must be one of this salon's.
  private async cleanPreferences(ctx: CustomersContext, req: EditCustomerRequest): Promise<EditCustomerRequest> {
    const out: EditCustomerRequest = { ...req };
    const text = (v: unknown, max: number, label: string, field: string): string | null => {
      if (v === null) return null;
      if (typeof v !== 'string') throw new ValidationError(`${label} must be text`, { field, rule: 'TYPE', params: { type: 'string' } });
      const t = v.trim().replace(/\s+/g, ' ');
      if (t.length > max) throw withCode(new ValidationError(`${label} must be ${max} characters or fewer`, { field, rule: 'MAX_LENGTH', params: { max } }), 'FIELD_TOO_LONG', { field: label, max: max });
      return t || null;
    };
    if (req.preferredName !== undefined) out.preferredName = text(req.preferredName, PREFERRED_NAME_MAX, 'Preferred name', 'preferredName');
    // Vietnamese POS mandate WP-I (§55): the CUSTOMER's communication language is 'en' / 'vi' (column CHECK, 697). Typed
    // names are accepted and stored as the code ("Vietnamese" / "Tiếng Việt" / "vi-VN" → 'vi'); '' clears; anything else
    // is refused — the salon's messages are written in English or Vietnamese only.
    if (req.preferredLanguage !== undefined) {
      const typed = text(req.preferredLanguage, PREFERRED_LANGUAGE_MAX, 'Preferred language', 'preferredLanguage');
      const code = normalizeCustomerLanguage(typed);
      if (code === undefined) throw withCode(new ValidationError('Preferred language must be English or Vietnamese', { field: 'preferredLanguage', rule: 'ENUM', params: { allowed: 'English, Tiếng Việt' } }), 'LANGUAGE_INVALID');
      out.preferredLanguage = code;
    }
    if (req.preferredBranchId !== undefined) {
      const b = req.preferredBranchId ? String(req.preferredBranchId) : null;
      if (b && !(await this.repo.isTenantBranch?.(ctx, b))) throw withCode(new ValidationError('Preferred branch is not one of this salon\'s branches', { field: 'preferredBranchId', rule: 'FORMAT' }), 'PREFERRED_BRANCH_INVALID');
      out.preferredBranchId = b;
    }
    return out;
  }
  /** Birthday Campaigns guide §05: YYYY-MM-DD (year known) or MM-DD (year unknown → stored on 2000, never shown); '' / null clears. */
  private cleanBirthday<R extends { birthday?: string | null; birthdayYearKnown?: boolean }>(req: R): R {
    if (req.birthday === undefined) return req;
    if (req.birthday === null || (typeof req.birthday === 'string' && req.birthday.trim() === '')) return { ...req, birthday: null };
    const today = utcDate(new Date(Date.now() + 14 * 3600_000));   // the latest calendar date anywhere on Earth: never refuses a salon's "today"
    const p = parseBirthdayInput(req.birthday, today);
    if (!p.ok) throw withCode(new ValidationError(p.reason, { field: 'birthday', rule: 'FORMAT' }), 'BIRTHDAY_INVALID');
    return { ...req, birthday: p.value.date, birthdayYearKnown: p.value.yearKnown };
  }
  async update(ctx: CustomersContext, id: string, req: EditCustomerRequest): Promise<POSCustomerRow> {
    this.need(ctx, 'pos.customers.edit');
    if (!this.validPhone(req.phone)) throw withCode(new ValidationError('Phone is not valid', { field: 'phone', rule: 'FORMAT' }), 'PHONE_INVALID');
    if (!this.validEmail(req.email)) throw withCode(new ValidationError('Email is not valid', { field: 'email', rule: 'FORMAT' }), 'EMAIL_INVALID');
    req = await this.cleanPreferences(ctx, req);   // Decision 1
    req = this.cleanBirthday(req);   // Birthday Campaigns §05/§10: the profile editor may now record or correct a birthday
    if (req.phone || req.email) { const dupe = await this.repo.findByContact(ctx, req.phone, req.email, id); if (dupe) throw new ValidationError(`Phone/email already used by "${dupe.displayName}". Review duplicates or merge.`, { code: 'CUSTOMER_CONTACT_IN_USE', params: { name: String(dupe.displayName ?? '') } }); }
    const before = this.mustFind(await this.repo.detail(ctx, id));
    const row = (await this.repo.update(ctx, id, req))!; this.log(ctx, 'pos_customer_updated', 'pos_customer', id, before, row);
    // §3 CUSTOMER PROFILE: targeted invalidation. The envelope carries the customer ID only — the phone/email/name
    // that changed never rides the event (§12); authorized screens refetch what they may see.
    try {
      if (!this.repo.emitsDomainEvents?.()) {   // Constitution 8: projected from customer.updated when the repo emits
        this.realtime?.toTenant({ tenantId: ctx.tenantId, branchId: ctx.branchId }, EVENTS.customerProfileUpdated,
          makeEnvelope({ eventType: EVENTS.customerProfileUpdated, tenantId: ctx.tenantId, branchId: ctx.branchId, resourceType: 'customer', resourceId: id }));
      }
    } catch { /* never load-bearing */ }
    return row;
  }
  /** F1 §60: without the outbox projection, tell open screens directly (ids only) that this profile's status changed */
  private statusChanged(ctx: CustomersContext, id: string) {
    if (this.repo.emitsDomainEvents?.()) return;
    try {
      this.realtime?.toTenant({ tenantId: ctx.tenantId, branchId: ctx.branchId }, EVENTS.customerProfileUpdated,
        makeEnvelope({ eventType: EVENTS.customerProfileUpdated, tenantId: ctx.tenantId, branchId: ctx.branchId, resourceType: 'customer', resourceId: id }));
    } catch (e) { console.warn(`[customers] status realtime notice failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
  async archive(ctx: CustomersContext, id: string): Promise<POSCustomerRow> { this.need(ctx, 'pos.customers.archive'); const row = this.mustFind(await this.repo.setStatus(ctx, id, 'archived')); this.log(ctx, 'pos_customer_archived', 'pos_customer', id, undefined, undefined, { note: 'kept in historical tickets/appointments/receipts/reports' }); this.statusChanged(ctx, id); return row; }
  async reactivate(ctx: CustomersContext, id: string): Promise<POSCustomerRow> { this.need(ctx, 'pos.customers.archive'); const row = this.mustFind(await this.repo.setStatus(ctx, id, 'active')); this.log(ctx, 'pos_customer_reactivated', 'pos_customer', id); this.statusChanged(ctx, id); return row; }

  // ---- history ----
  async visits(ctx: CustomersContext, id: string): Promise<CustomerVisitRow[]> { this.need(ctx, 'pos.customers.view'); return this.mustFind(await this.repo.visits(ctx, id)); }
  async appointments(ctx: CustomersContext, id: string): Promise<CustomerAppointmentRow[]> { this.need(ctx, 'pos.customers.view'); return this.mustFind(await this.repo.appointments(ctx, id)); }
  async tickets(ctx: CustomersContext, id: string): Promise<CustomerTicketRow[]> { this.need(ctx, 'pos.customers.view'); return this.mustFind(await this.repo.tickets(ctx, id)); }
  async receipts(ctx: CustomersContext, id: string): Promise<CustomerReceiptRow[]> { this.need(ctx, 'pos.customers.view'); return this.mustFind(await this.repo.receipts(ctx, id)); }

  // ---- notes (sensitive — separate view/edit permissions) + tags ----
  async getNotes(ctx: CustomersContext, id: string): Promise<CustomerNotes> { this.need(ctx, 'pos.customers.notes.view'); return this.mustFind(await this.repo.getNotes(ctx, id)); }
  async setNotes(ctx: CustomersContext, id: string, n: CustomerNotes): Promise<CustomerNotes> { this.need(ctx, 'pos.customers.notes.edit'); const out = this.mustFind(await this.repo.setNotes(ctx, id, n)); this.log(ctx, 'pos_customer_notes_updated', 'pos_customer_notes', id); return out; }
  async getTags(ctx: CustomersContext, id: string): Promise<string[]> { this.need(ctx, 'pos.customers.view'); return this.mustFind(await this.repo.getTags(ctx, id)); }
  async setTags(ctx: CustomersContext, id: string, t: string[]): Promise<string[]> { this.need(ctx, 'pos.customers.edit'); const out = this.mustFind(await this.repo.setTags(ctx, id, t)); this.log(ctx, 'pos_customer_tags_updated', 'pos_customer_tags', id, undefined, undefined, { count: t.length }); return out; }

  // ---- loyalty / membership / gift cards ----
  async getLoyalty(ctx: CustomersContext, id: string): Promise<CustomerLoyalty> { this.need(ctx, 'pos.customers.view'); return this.mustFind(await this.repo.getLoyalty(ctx, id)); }
  async getLoyaltyLedger(ctx: CustomersContext, id: string): Promise<any[]> { this.need(ctx, 'pos.customers.view'); return this.mustFind(await this.repo.getLoyaltyLedger(ctx, id)); }
  // Customer Profile & Global Loyalty Protection (Nov 4 2026): salon staff never add to, set or lower a customer's points
  // directly — a manager asks for bonus points (POST /pos/loyalty/bonus-requests) and the owner approves them. The two old
  // routes stay (an old POS build gets this answer, not a 404); a tier-only change through setLoyalty still works.
  async adjustLoyaltyPoints(ctx: CustomersContext, _id: string, _b: any): Promise<any> { this.need(ctx, 'pos.customers.loyalty.edit'); throw directEditRefused(); }
  async setLoyalty(ctx: CustomersContext, id: string, l: CustomerLoyalty): Promise<CustomerLoyalty> { this.need(ctx, 'pos.customers.loyalty.edit'); const cur = await this.repo.getLoyalty(ctx, id); if (l.points != null && Number(l.points) !== Number(cur?.points ?? 0)) throw directEditRefused(); if (cur) l = { ...l, points: cur.points }; if (l.points < 0) throw withCode(new ValidationError('Points cannot be negative'), 'POINTS_NEGATIVE'); if (!String((l as any).reason ?? '').trim()) throw withCode(new ValidationError('A loyalty adjustment needs a reason'), 'LOYALTY_ADJUST_REASON_REQUIRED'); const before = await this.repo.getLoyalty(ctx, id).catch(() => null); const out = this.mustFind(await this.repo.setLoyalty(ctx, id, l).catch(loyaltyError)); this.log(ctx, 'pos_customer_loyalty_updated', 'pos_customer_loyalty', id, before as any, out as any, { reason: String((l as any).reason).trim() }); return out; }
  async getMembership(ctx: CustomersContext, id: string): Promise<CustomerMembership> { this.need(ctx, 'pos.customers.view'); return this.mustFind(await this.repo.getMembership(ctx, id)); }
  async setMembership(ctx: CustomersContext, id: string, m: CustomerMembership): Promise<CustomerMembership> { this.need(ctx, 'pos.customers.membership.edit'); const out = this.mustFind(await this.repo.setMembership(ctx, id, m)); this.log(ctx, 'pos_customer_membership_updated', 'pos_customer_membership', id, undefined, out); return out; }
  async giftCards(ctx: CustomersContext, id: string): Promise<CustomerGiftCard[]> { this.need(ctx, 'pos.customers.view'); return this.mustFind(await this.repo.getGiftCards(ctx, id)); }

  // ---- duplicates / merge ----
  async duplicates(ctx: CustomersContext): Promise<DuplicateGroup[]> { this.need(ctx, 'pos.customers.view'); const groups = await this.repo.duplicates(ctx); this.log(ctx, 'pos_customer_duplicate_reviewed', 'pos_customer_duplicate', undefined, undefined, undefined, { groups: groups.length }); return groups; }
  /** Functional Decision 29 — staff judge a duplicate group: Keep Separate (it leaves the queue) or Not Sure (it stays, flagged). */
  async decideDuplicate(ctx: CustomersContext, groupId: string, decision: string): Promise<{ ok: true }> {
    this.need(ctx, 'pos.customers.merge');
    if (decision !== 'keep_separate' && decision !== 'not_sure') throw new ValidationError('Decision must be keep_separate or not_sure');
    if (!(await this.repo.decideDuplicate(ctx, groupId, decision))) throw withCode(new ValidationError('Unknown duplicate group'), 'DUPLICATE_GROUP_NOT_FOUND');
    this.log(ctx, 'pos_customer_duplicate_decided', 'pos_customer_merge', groupId, undefined, undefined, { decision });
    return { ok: true };
  }
  async merge(ctx: CustomersContext, groupId: string, primaryCustomerId: string): Promise<POSCustomerDetail> {
    this.need(ctx, 'pos.customers.merge');
    if (!primaryCustomerId) throw withCode(new ValidationError('A primary customer must be chosen to merge'), 'MERGE_PRIMARY_REQUIRED'); // no auto-merge without confirmation
    const merged = await this.repo.merge(ctx, groupId, primaryCustomerId);
    if (!merged) throw withCode(new ValidationError('Merge failed: unknown group or primary not in group'), 'MERGE_FAILED');
    this.log(ctx, 'pos_customer_merged', 'pos_customer_merge', primaryCustomerId, undefined, undefined, { groupId });
    return merged;
  }

  // ---- import / export ----
  async export(ctx: CustomersContext, f: CustomerFilters = {}): Promise<{ format: 'csv'; filename: string; csv: string }> {
    this.need(ctx, 'pos.customers.export'); const ex = await this.repo.exportRows(ctx, f);
    // F1 §55: spend leaves the building only with financial access — otherwise the column is omitted, not zero-filled
    const canSeeFinancial = this.canSeeMoney(ctx);
    const drop = canSeeFinancial ? -1 : ex.headers.indexOf('TotalSpend');
    const headers = drop < 0 ? ex.headers : ex.headers.filter((_, i) => i !== drop);
    const rows = drop < 0 ? ex.rows : ex.rows.map((r) => r.filter((_, i) => i !== drop));
    const csv = customersToCsv(headers, rows);
    this.log(ctx, 'pos_customers_exported', 'pos_customers_export', undefined, undefined, undefined, { rows: rows.length, filters: f }); return { format: 'csv', filename: 'pos-customers.csv', csv };
  }
  // ===== Bulk customer import (CSV) — into the tenant customers table, which IS the main Postgres the tenant's AI
  // customer-insights reads. Preview is a dry run; commit batch-inserts. Built for large salon exports (50k+). =====
  private readonly IMPORT_ROW_CAP = 100000;

  // Parse + map + dedup (against existing customers AND within the file) + validate. Pure classification, writes nothing.
  private async classifyImport(ctx: CustomersContext, csv: string, opts?: CustomerImportOptions): Promise<{ columns: Record<string, number>; rows: CustomerImportRow[]; invalidEmailsDropped: number }> {
    const grid = parseCustomerCsv(csv || '');
    if (grid.length < 2) throw withCode(new ValidationError('The file has no data rows (a header row plus at least one record is required).'), 'IMPORT_NO_ROWS');
    if (grid.length - 1 > this.IMPORT_ROW_CAP) throw withCode(new ValidationError(`Too many rows (${grid.length - 1}). Split the file into chunks of ${this.IMPORT_ROW_CAP} or fewer.`), 'IMPORT_TOO_MANY_ROWS', { rows: grid.length - 1, max: this.IMPORT_ROW_CAP });
    const columns = detectCustomerColumns(grid[0]);
    if (columns.firstName === undefined && columns.fullName === undefined && columns.phone === undefined) {
      throw withCode(new ValidationError('Could not find a name or phone column. Expected a header like: first name, last name, phone, email, birthday (or a single "name" column).'), 'IMPORT_COLUMNS_MISSING');
    }
    const updateExisting = !!opts?.updateExisting;
    // existing contacts for dedup (tenant-wide). In update mode we also need each match's id + current fields so we can
    // tell which columns are empty and safe to fill.
    type Rec = { id: string; normalizedPhone: string | null; email: string | null; birthday: string | null };
    const existing = await this.repo.listContactKeys(ctx);
    const existPhone = new Set<string>(); const existEmail = new Set<string>();
    const recByPhone = new Map<string, Rec>(); const recByEmail = new Map<string, Rec>();
    for (const k of existing) {
      const rec: Rec = { id: k.id, normalizedPhone: k.normalizedPhone, email: k.email ? k.email.toLowerCase() : null, birthday: k.birthday };
      if (k.normalizedPhone) { existPhone.add(k.normalizedPhone); recByPhone.set(k.normalizedPhone, rec); }
      if (rec.email) { existEmail.add(rec.email); recByEmail.set(rec.email, rec); }
    }
    const seenPhone = new Set<string>(); const seenEmail = new Set<string>();
    const cell = (r: string[], i?: number) => (i === undefined ? '' : (r[i] ?? '').trim());

    const rows: CustomerImportRow[] = []; let invalidEmailsDropped = 0;
    for (let i = 1; i < grid.length; i++) {
      const r = grid[i]; const rowNumber = i;
      let firstName = cell(r, columns.firstName); let lastName = cell(r, columns.lastName);
      if (!firstName && columns.fullName !== undefined) { const s = splitFullName(cell(r, columns.fullName)); firstName = s.firstName; lastName = lastName || s.lastName; }
      const phoneRaw = cell(r, columns.phone) || undefined; const normalizedPhone = normalizeImportPhone(phoneRaw);
      const em = cleanImportEmail(cell(r, columns.email) || undefined); if (em.dropped) invalidEmailsDropped++;
      const birthday = parseImportBirthday(cell(r, columns.birthday) || undefined);
      const base: CustomerImportRow = { rowNumber, firstName, lastName, phone: phoneRaw, normalizedPhone, email: em.email, birthday, action: 'create' };

      if (!firstName.trim() && !normalizedPhone) { rows.push({ ...base, action: 'error', reason: 'No name or phone' }); continue; }

      // matches an existing customer? (phone takes precedence, then email)
      const matched = (normalizedPhone && recByPhone.get(normalizedPhone)) || (em.email && recByEmail.get(em.email)) || null;
      if (matched) {
        if (updateExisting) {
          const fills: ('birthday' | 'email' | 'phone')[] = [];
          if (birthday && !matched.birthday) fills.push('birthday');
          // only fill a contact field when the existing record lacks it AND no *other* customer already owns that value
          if (em.email && !matched.email && !(recByEmail.has(em.email) && recByEmail.get(em.email)!.id !== matched.id)) fills.push('email');
          if (normalizedPhone && !matched.normalizedPhone && !(recByPhone.has(normalizedPhone) && recByPhone.get(normalizedPhone)!.id !== matched.id)) fills.push('phone');
          if (fills.length) rows.push({ ...base, action: 'update', customerId: matched.id, fills, reason: 'Fills ' + fills.join(', ') });
          else rows.push({ ...base, action: 'duplicate', reason: 'Existing customer (no new info)' });
        } else {
          const reason = (normalizedPhone && existPhone.has(normalizedPhone)) ? 'Existing customer (phone)' : 'Existing customer (email)';
          rows.push({ ...base, action: 'duplicate', reason });
        }
        continue;
      }
      if (normalizedPhone && seenPhone.has(normalizedPhone)) { rows.push({ ...base, action: 'duplicate', reason: 'Repeated phone in file' }); continue; }
      if (em.email && seenEmail.has(em.email)) { rows.push({ ...base, action: 'duplicate', reason: 'Repeated email in file' }); continue; }
      if (normalizedPhone) seenPhone.add(normalizedPhone); if (em.email) seenEmail.add(em.email);
      rows.push(base);
    }
    return { columns, rows, invalidEmailsDropped };
  }

  async importPreview(ctx: CustomersContext, csv: string, opts?: CustomerImportOptions): Promise<CustomerImportPreview> {
    this.need(ctx, 'pos.customers.import');
    const { columns, rows, invalidEmailsDropped } = await this.classifyImport(ctx, csv, opts);
    const toCreate = rows.filter((r) => r.action === 'create').length;
    const toUpdate = rows.filter((r) => r.action === 'update').length;
    const duplicates = rows.filter((r) => r.action === 'duplicate').length;
    const errors = rows.filter((r) => r.action === 'error').length;
    return {
      detectedColumns: {
        firstName: columns.firstName !== undefined ? 'mapped' : undefined, lastName: columns.lastName !== undefined ? 'mapped' : undefined,
        fullName: columns.fullName !== undefined ? 'mapped' : undefined, phone: columns.phone !== undefined ? 'mapped' : undefined,
        email: columns.email !== undefined ? 'mapped' : undefined, birthday: columns.birthday !== undefined ? 'mapped' : undefined,
      },
      totalRows: rows.length, toCreate, toUpdate, duplicates, errors, invalidEmailsDropped, sample: rows.slice(0, 20),
    };
  }

  async importCommit(ctx: CustomersContext, csv: string, opts?: CustomerImportOptions): Promise<CustomerImportResult> {
    this.need(ctx, 'pos.customers.import');
    const { rows, invalidEmailsDropped } = await this.classifyImport(ctx, csv, opts);
    const toInsert: BulkCustomerInsert[] = rows.filter((r) => r.action === 'create').map((r) => ({
      firstName: r.firstName, lastName: r.lastName, phoneDisplay: r.phone, normalizedPhone: r.normalizedPhone, email: r.email, birthday: r.birthday,
    }));
    const created = await (async () => {
      if (this.entitlements && toInsert.length) await this.entitlements.assertCapacity(ctx.tenantId, 'customers', toInsert.length);
      return this.repo.bulkInsertCustomers(ctx, toInsert);
    })();
    // §7: an IMPORT is a creation site too. Bulk insert returns a count rather than ids, so instead of linking
    // row-by-row we link a BOUNDED batch of this tenant's still-unlinked customers right here — small and medium
    // imports are fully linked before the response returns. Anything past the cap stays unlinked and is selected
    // by the next reconciliation pass (the incremental cursor targets exactly these rows). Best-effort: an
    // identity failure never fails the import.
    let identityLink: { linked: number; newGlobals: number; review: number; deferred: boolean } | undefined;
    if (this.identity?.linkUnlinkedForTenant && created > 0) {
      try { identityLink = await this.identity.linkUnlinkedForTenant(ctx.tenantId, 500); } catch { /* nightly covers it */ }
    }
    // update-existing: only the fields flagged as fillable are sent, so empty columns get filled and nothing is overwritten.
    const toUpdate: BulkCustomerUpdate[] = rows.filter((r) => r.action === 'update').map((r) => ({
      customerId: r.customerId!,
      birthday: r.fills?.includes('birthday') ? r.birthday : undefined,
      email: r.fills?.includes('email') ? r.email : undefined,
      normalizedPhone: r.fills?.includes('phone') ? r.normalizedPhone : undefined,
      phoneDisplay: r.fills?.includes('phone') ? r.phone : undefined,
    }));
    const updated = await this.repo.bulkUpdateContactInfo(ctx, toUpdate);
    const duplicatesSkipped = rows.filter((r) => r.action === 'duplicate').length;
    const errors = rows.filter((r) => r.action === 'error');
    this.log(ctx, 'pos_customers_imported', 'pos_customers_import', undefined, undefined, undefined, { created, updated, duplicatesSkipped, errors: errors.length, invalidEmailsDropped, totalRows: rows.length });
    // If any rows failed to import, emit CUSTOMER_IMPORT_FAILED into the automation engine (notify tenant admin, etc.).
    // Fire-and-forget + guarded; the import result is already computed and must not be affected by automation.
    if (this.engine && errors.length > 0 && ctx.tenantId) {
      this.engine.ingestEvent({ eventId: `import|${ctx.tenantId}|${Date.now()}`, type: 'CUSTOMER_IMPORT_FAILED', tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, entityType: 'pos_customers_import', triggeredBy: 'system', payload: { errors: errors.length, totalRows: rows.length, created, updated } })
        .catch(() => { /* automation is best-effort */ });
    }
    // The identity summary is reported, not hidden: `deferred` tells the operator that some imported rows are
    // still waiting for the nightly reconciliation rather than pretending everything is linked.
    return { created, updated, duplicatesSkipped, errors: errors.length, invalidEmailsDropped, totalRows: rows.length, identityLinked: identityLink?.linked ?? 0, identityDeferred: identityLink?.deferred ?? false, errorSamples: errors.slice(0, 20).map((e) => ({ rowNumber: e.rowNumber, reason: e.reason || 'invalid' })) };
  }

  // Back-compat: POST /pos/customers/import with { csv } commits. (Older callers that posted no body now get a clear error.)
  async import(ctx: CustomersContext, csv?: string): Promise<CustomerImportResult> {
    if (!csv || !csv.trim()) { this.need(ctx, 'pos.customers.import'); throw new ValidationError('Provide CSV text in the "csv" field (or use import/preview first).'); }
    return this.importCommit(ctx, csv);
  }
}
