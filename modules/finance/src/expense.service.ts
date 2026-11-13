// expense.service.ts — THE expense authority (mandate §9: one system, no ExpenseV2). Owner routes, the POS screen, the
// Owner App, OCR posting and the legacy inventory receipt-expense route all write through here.
//
// The rules it composes:
//   * tenant + branch come from the server (ctx + BranchScopePort, the same branch authorization the Owner App uses) —
//     never from the client (§70–77). A restricted manager reads and writes ONLY their branch.
//   * a receipt is evidence, an expense is the record (§10): an expense may link one receipt document; one receipt makes
//     at most one live expense (unique index — an OCR retry or a double-tapped Save never makes two, §123/§193).
//   * money is integer cents (§14); the breakdown must reconcile or the expense is flagged for review, never auto-approved
//     on an AI total that does not add up (§33–34).
//   * categories: the ten short owner categories + the salon's custom ones (§4–5); recommendation priority is the
//     category engine's (§42); a repeated correction becomes a tenant rule (§41), never a global one (§150).
//   * duplicates are flagged for a person, never deleted (§49); "Save anyway" needs a reason (§48).
//   * every change is versioned (§135–136: a stale edit gets EXPENSE_VERSION_CONFLICT, never a silent overwrite), recorded
//     in expense_history with before / after / actor / reason (§80–81, §204), audited, and published as a domain event
//     in the SAME transaction (§119 outbox).
//   * an approved expense is changed only by an audited correction or voided — never edited back or hard-deleted (§84–85).
//   * approval is idempotent: approving twice has one effect (§194).
import { branchShareOfSalonWide, validSharedCostShares, type SharedCostPolicy, type SharedCostShare } from './expense-money';
/** stored shares (jsonb) → the typed list; anything malformed is dropped, never guessed */
const sharesOf = (v: unknown): SharedCostShare[] => (Array.isArray(v) ? v : [])   // jsonb arrives parsed (driver + PGlite)
  .filter((x: any) => x && typeof x.branchId === 'string' && Number.isInteger(x.basisPoints)).map((x: any) => ({ branchId: String(x.branchId), basisPoints: Number(x.basisPoints) }));
import { Logger } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { assertTransition, InvalidStateTransitionError } from '@aipowersalon/database';
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent, type DomainEventType } from '@aipowersalon/events';
import { businessDate, isYmd, addDays } from '@aipowersalon/date-time';
import { ExpenseRepository, type Exec, type ExpenseRow, type ListFilters, type Scope } from './expense.repository';
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_CATEGORY_KEYS, normalizeCategory, customCategoryKey, categoryLabel, FALLBACK_CATEGORY } from './expense-categories';
import { recommendCategory, learnFromCorrection, type CategoryRecommendation } from './category-engine';
import { normalizeVendorName, matchVendor, vendorSimilarity } from './vendor-normalize';
import { reconcileBreakdown, allocate, rescaleAllocations, billStatusFor, billDueState, type AllocationInput } from './expense-money';
import { detectExpenseDuplicates, type DupResult } from './expense-duplicates';
import { EXPENSE, EXPENSE_BILL, EXPENSE_REIMBURSEMENT, EXPENSE_DUPLICATE } from './expense-lifecycles';
import { periodWindow, previousWindow, pctChange, detectRecurring, expenseInsights, type ReportPeriod, type DateWindow } from './expense-reports';
import { exportTotalCents, ACCOUNTING_EXPORT_ADAPTERS, EXPORT_COLUMN_KEYS, EXPORT_FORMULA_SAFE_KEYS, type ExportRow } from './expense-export';
import { ExpenseError } from './expense-errors';
import { matchReceiptToExpenses, matchExpenseToPayments, autoApprovalRulesOf, autoApprovalDecision, type AutoApprovalRule, type PaymentCandidate, type MatchVerdict } from './expense-matching';
import { digestsDue, monthWindow, lastCompletedMonth, weeklySummary, monthlySummary } from './expense-digests';

/** audit and the vendor link are best-effort by contract — a failure is logged, never swallowed, never fails the expense */
const financeLog = new Logger('Finance');

/** The read filter for every allowed branch (and the salon-wide rows) — see scope(). */
export const ALL_BRANCHES = 'all';
export interface FinanceCtx { tenantId: string; userId: string; role: string; permissions: string[]; selectedBranchId?: string | null }

/** The Owner App's branch authorization (OwnerService.resolveBranchScope), bound by the app — one branch rule, not two. */
export interface BranchScopePort {
  resolve(ctx: FinanceCtx, requestedBranchId?: string | null): Promise<{ branchId: string | null; allowed: string[] | null; restricted: string | null }>;
}
/** Creates a vendor in the salon's directory (InventoryService.createVendor), bound by the app; optional. */
export interface VendorDirectoryPort { create(ctx: FinanceCtx, name: string): Promise<{ id: string }> }
/** Optional AI category suggestion through the AI platform (§29, §39) — only ever a key from `validKeys`. */
export interface AiCategoryPort { suggest(ctx: FinanceCtx, x: { vendorRaw: string | null; lines: string[]; validKeys: string[] }): Promise<{ key: string; confidence: number; reason?: string } | null> }
/** §62/§63: the salon's outgoing card / bank transactions, when a connector holds them (none is bound today — the match then
 *  honestly answers UNMATCHED with the reason; a person may still link a reference by hand). */
export interface PaymentFeedPort { candidates(ctx: FinanceCtx, x: { amountCents: number; incurredOn: string }): Promise<PaymentCandidate[]> }
/** Best-effort platform audit (AuditService.record shape). */
export interface FinanceAuditPort { record(ctx: { tenantId: string; branchId?: string | null; userId?: string | null; role?: string | null }, e: { module: string; action: string; resourceType?: string; resourceId?: string; summary?: string; severity?: 'info' | 'warning' | 'critical'; metadata?: Record<string, unknown>; before?: unknown; after?: unknown; reason?: string | null }): Promise<unknown> }

export interface ExpenseInput {
  kind?: 'expense' | 'bill';
  category?: string | null;
  amountCents?: number | null;                 // the total
  subtotalCents?: number | null; taxCents?: number | null; tipCents?: number | null; feeCents?: number | null; discountCents?: number | null;
  incurredOn?: string | null;
  vendor?: string | null; vendorId?: string | null;
  description?: string | null;
  branchId?: string | null;
  paymentMethod?: string | null; cardBrand?: string | null; cardLast4?: string | null;
  receiptNumber?: string | null; invoiceNumber?: string | null; referenceNumber?: string | null;
  dueDate?: string | null;
  recurring?: boolean | null;
  reimburse?: boolean | null;                  // paid personally → reimbursement pending (§64)
  lineItems?: Array<{ description: string; quantity?: number | null; unitPriceCents?: number | null; totalCents: number; categoryKey?: string | null; confidence?: number | null }> | null;
  allocations?: AllocationInput[] | null;
  receiptDocumentId?: string | null;
  accountantNote?: string | null; taxReviewStatus?: string | null;
  /** 'draft' keeps it as a draft, 'submit' sends it for review, 'approve' approves now (needs the approve permission) */
  intent?: 'draft' | 'submit' | 'approve' | null;
  /** §48: save even though it looks like a duplicate — the reason is recorded */
  duplicateOverrideReason?: string | null;
  idempotencyKey?: string | null;
}

const PERM = { view: 'owner.expenses.view', manage: 'owner.expenses.manage', approve: 'owner.expenses.approve', export: 'owner.expenses.export', categories: 'owner.expenses.categories.manage', reimburse: 'owner.expenses.reimbursements.manage',
  // F7 §73 (Kevin, Nov 6 2026: pick best): separate keys so a role editor can give "record expenses" without delete / archive / bill payments
  deleteDraft: 'owner.expenses.delete_draft', archive: 'owner.expenses.archive', bills: 'owner.expenses.bills.manage' } as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAYMENT_METHODS = new Set(['business_card', 'cash', 'check', 'ach', 'bank_transfer', 'personal_card', 'other']);
const trimTo = (v: string | null | undefined, max: number) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const centsOk = (v: unknown) => v == null || (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100_000_000_00);
const snapshot = (e: ExpenseRow) => ({ status: e.status, category: e.category, amountCents: e.amountCents, subtotalCents: e.subtotalCents, taxCents: e.taxCents, tipCents: e.tipCents, feeCents: e.feeCents,
  discountCents: e.discountCents, vendor: e.vendor, vendorId: e.vendorId, incurredOn: e.incurredOn, branchId: e.branchId, description: e.description, paymentMethod: e.paymentMethod,
  invoiceNumber: e.invoiceNumber, receiptNumber: e.receiptNumber, dueDate: e.dueDate, billStatus: e.billStatus, paidCents: e.paidCents, reimbursementStatus: e.reimbursementStatus,
  duplicateStatus: e.duplicateStatus, archivedAt: e.archivedAt, version: e.version });

/** Extras (Expenses Management 01): an expense waiting in review longer than this is shown as overdue */
export const REVIEW_OVERDUE_DAYS = 7;
/** Extras (Expenses Management 06): months on the spending trend */
export const TREND_MONTHS = 12;
/** the `n` calendar months ending with the month of `today` (YYYY-MM-DD, the salon's day), oldest first, as YYYY-MM */
export function trendMonths(today: string, n: number): string[] {
  let y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const out: string[] = [];
  for (let i = 0; i < n; i++) { out.unshift(`${y}-${String(m).padStart(2, '0')}`); m -= 1; if (m === 0) { m = 12; y -= 1; } }
  return out;
}

export class ExpenseService {
  readonly repo: ExpenseRepository;
  vendors: VendorDirectoryPort | null = null;
  ai: AiCategoryPort | null = null;
  paymentFeed: PaymentFeedPort | null = null;
  audit: FinanceAuditPort | null = null;

  constructor(private readonly db: Kysely<DB>, private scopes: BranchScopePort, private readonly outbox: OutboxWriter | null = null, private readonly now: () => Date = () => new Date()) {
    this.repo = new ExpenseRepository(db);
  }
  /** apps/api binds the Owner App's branch authorization here at start-up (finance-wiring.ts) */
  bindBranchScope(p: BranchScopePort) { this.scopes = p; }
  /**
   * Oct 28 2026 (Receipt mandate audit F2): the branches this person may see, through the SAME bound rule — for the receipt
   * documents module (it has no branch rule of its own). null = every branch and the salon-wide rows (owner / salon-wide
   * role); a list = only those branches, never the salon-wide rows (a restricted manager's view, as finance reads it).
   */
  async visibleBranches(ctx: FinanceCtx): Promise<string[] | null> {
    const s = await this.scope(ctx, ALL_BRANCHES);
    return s.restricted ? [s.restricted] : s.allowed;
  }

  // ── authorization helpers ────────────────────────────────────────────────────────────────────────────────────────
  private require(ctx: FinanceCtx, perm: string) {
    if (!ctx?.tenantId) throw new ExpenseError('EXPENSE_ACCESS_DENIED', 'No salon context.');
    if (!ctx.permissions?.includes(perm)) throw new ExpenseError('EXPENSE_ACCESS_DENIED', 'You do not have permission for this.', { permission: perm });
  }
  private has(ctx: FinanceCtx, perm: string) { return !!ctx.permissions?.includes(perm); }
  private async scope(ctx: FinanceCtx, branchId?: string | null): Promise<Scope & { restricted: string | null }> {
    // a read with no branch follows the session's branch (the POS is a branch device); ALL_BRANCHES asks for every allowed
    // branch AND the salon-wide rows — what the Owner App's "All branches" means (deep-scan Oct 22 2026: it sent no branch,
    // so its finance dashboard / report / list silently showed only the branch picked at sign-in)
    const r = await this.scopes.resolve(ctx, branchId === ALL_BRANCHES ? null : branchId ?? ctx.selectedBranchId ?? null);
    return { tenantId: ctx.tenantId, branchId: r.branchId, allowed: r.allowed, restricted: r.restricted, salonWide: !r.restricted };
  }
  /** the branch a write may land in: the restricted manager's own branch only; an owner any allowed branch or the whole salon */
  private async writableBranch(ctx: FinanceCtx, requested: string | null | undefined): Promise<string | null> {
    const s = await this.scopes.resolve(ctx, requested ?? null);
    if (s.restricted) { if (requested && requested !== s.restricted) throw new ExpenseError('EXPENSE_ACCESS_DENIED', 'You can only record expenses for your branch.'); return s.restricted; }
    if (requested && s.allowed && !s.allowed.includes(requested)) throw new ExpenseError('EXPENSE_ACCESS_DENIED', 'That branch is not one of yours.');
    // defence in depth (the scope port is the rule; this is the floor): the branch must be this salon's own
    if (requested) {
      const own = await sql<{ id: string }>`SELECT id FROM branches WHERE tenant_id = ${ctx.tenantId} AND id = ${requested}`.execute(this.db);
      if (!own.rows.length) throw new ExpenseError('EXPENSE_ACCESS_DENIED', 'That branch is not one of yours.');
    }
    return requested ?? null;
  }
  /** the salon's timezone — the same source the Owner App reads (tenant_settings business-branch, salon-wide row) */
  private async tz(tenantId: string): Promise<string> {
    const r = await sql<{ tz: string | null }>`SELECT settings_json->>'timezone' AS tz FROM tenant_settings
      WHERE tenant_id = ${tenantId} AND category = 'business-branch' AND branch_id IS NULL LIMIT 1`.execute(this.db);
    return r.rows[0]?.tz || 'America/New_York';
  }
  private async today(tenantId: string) { return businessDate(await this.tz(tenantId), this.now()); }
  private async getScoped(ctx: FinanceCtx, id: string, exec: Exec = this.db, forUpdate = false): Promise<ExpenseRow> {
    const s = await this.scope(ctx, null);
    const e = await this.repo.get(exec, { tenantId: ctx.tenantId, branchId: null, allowed: s.allowed, salonWide: !s.restricted }, id, forUpdate);
    if (!e) throw new ExpenseError('EXPENSE_NOT_FOUND');
    if (s.restricted && e.branchId !== s.restricted) throw new ExpenseError('EXPENSE_NOT_FOUND');   // never confirm another branch's id exists
    return e;
  }
  private async emit(exec: Exec, ctx: { tenantId: string; userId?: string | null }, type: DomainEventType, e: Pick<ExpenseRow, 'id' | 'branchId'>, payload: Record<string, unknown>) {
    if (!this.outbox) return;
    await this.outbox.write(exec as never, createDomainEvent({ eventType: type, tenantId: ctx.tenantId, branchId: e.branchId || undefined, aggregateType: 'expense', aggregateId: e.id,
      actorId: ctx.userId || undefined, actorType: ctx.userId ? 'user' : 'system', payload: { expenseId: e.id, branchId: e.branchId ?? null, ...payload } }));
  }
  private async auditLog(ctx: FinanceCtx, action: string, e: Pick<ExpenseRow, 'id' | 'branchId'>, x: { summary?: string; before?: unknown; after?: unknown; reason?: string | null; severity?: 'info' | 'warning' | 'critical'; metadata?: Record<string, unknown> } = {}) {
    try { await this.audit?.record({ tenantId: ctx.tenantId, branchId: e.branchId, userId: ctx.userId, role: ctx.role }, { module: 'finance', action, resourceType: 'expense', resourceId: e.id, ...x }); } catch (x) { financeLog.warn(`audit write failed (${action}): ${(x as Error).message}`); }
  }

  // ── categories ───────────────────────────────────────────────────────────────────────────────────────────────────
  async categories(ctx: FinanceCtx) {
    this.require(ctx, PERM.view);
    const rows = await this.repo.categoryRows(ctx.tenantId);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const defaults = DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ key: c.key, label: c.label, isDefault: true, accountingCode: byKey.get(c.key)?.accountingCode ?? null, active: true, sortOrder: c.sortOrder }));
    const custom = rows.filter((r) => !DEFAULT_CATEGORY_KEYS.has(r.key)).map((r) => ({ key: r.key, label: r.label, isDefault: false, accountingCode: r.accountingCode, active: r.active, sortOrder: 100 + r.sortOrder }));
    return { categories: [...defaults, ...custom] };
  }
  private async validKeys(tenantId: string): Promise<{ keys: Set<string>; custom: Array<{ key: string; label: string }>; codes: Map<string, string | null> }> {
    const rows = await this.repo.categoryRows(tenantId);
    const custom = rows.filter((r) => !DEFAULT_CATEGORY_KEYS.has(r.key) && r.active);
    return { keys: new Set([...DEFAULT_CATEGORY_KEYS, ...custom.map((c) => c.key)]), custom, codes: new Map(rows.map((r) => [r.key, r.accountingCode])) };
  }
  async createCategory(ctx: FinanceCtx, b: { label: string; accountingCode?: string | null }) {
    this.require(ctx, PERM.categories);
    const label = trimTo(b.label, 60); const key = label ? customCategoryKey(label) : '';
    if (!label || !key) throw new ExpenseError('EXPENSE_INVALID', 'Give the category a name.');
    if (DEFAULT_CATEGORY_KEYS.has(key) || normalizeCategory(label) ) throw new ExpenseError('EXPENSE_INVALID', 'That is already one of the default categories.');
    await this.repo.upsertCategory(this.db, ctx.tenantId, { key, label, isSystem: false, accountingCode: trimTo(b.accountingCode, 60), active: true, actor: ctx.userId });
    return { key, label };
  }
  /** a default category: only its accounting code changes (§6); a custom one: label, code, active */
  async updateCategory(ctx: FinanceCtx, key: string, b: { label?: string | null; accountingCode?: string | null; active?: boolean | null }) {
    this.require(ctx, PERM.categories);
    if (DEFAULT_CATEGORY_KEYS.has(key)) {
      const def = DEFAULT_EXPENSE_CATEGORIES.find((c) => c.key === key)!;
      if (b.label != null && b.label !== def.label) throw new ExpenseError('EXPENSE_INVALID', 'The default categories keep their names; map them to an accounting code instead.');
      if (b.active === false) throw new ExpenseError('EXPENSE_INVALID', 'A default category cannot be turned off.');
      await this.repo.upsertCategory(this.db, ctx.tenantId, { key, label: def.label, isSystem: true, accountingCode: b.accountingCode === undefined ? undefined : trimTo(b.accountingCode, 60), actor: ctx.userId });
      return { key };
    }
    const existing = (await this.repo.categoryRows(ctx.tenantId)).find((c) => c.key === key);
    if (!existing) throw new ExpenseError('EXPENSE_CATEGORY_NOT_FOUND');
    await this.repo.upsertCategory(this.db, ctx.tenantId, { key, label: trimTo(b.label, 60) ?? existing.label, isSystem: false, accountingCode: b.accountingCode === undefined ? undefined : trimTo(b.accountingCode, 60), active: b.active ?? undefined, actor: ctx.userId });
    return { key };
  }

  // ── categorization rules (§174–175) ──────────────────────────────────────────────────────────────────────────────
  async rules(ctx: FinanceCtx) { this.require(ctx, PERM.view); return { rules: await this.repo.rules(ctx.tenantId) }; }
  async createRule(ctx: FinanceCtx, b: { vendor: string; categoryKey: string; keyword?: string | null; vendorId?: string | null }) {
    this.require(ctx, PERM.categories);
    const vendorNorm = normalizeVendorName(b.vendor);
    if (!vendorNorm) throw new ExpenseError('EXPENSE_INVALID', 'Name the vendor this rule is for.');
    const { keys } = await this.validKeys(ctx.tenantId);
    const key = normalizeCategory(b.categoryKey, keys);
    if (!key) throw new ExpenseError('EXPENSE_CATEGORY_NOT_FOUND');
    // §163 run 3 (Oct 27 2026): the vendor must be this salon's — an unknown id was a 500 (the tenant-consistency trigger)
    if (b.vendorId && !(await this.db.selectFrom('inventory_vendors').select('id').where('tenant_id', '=', ctx.tenantId).where('id', '=', b.vendorId).executeTakeFirst())) throw new ExpenseError('EXPENSE_INVALID', 'That vendor was not found.');
    const id = await this.repo.upsertRule(this.db, ctx.tenantId, { vendorNorm, vendorId: b.vendorId ?? null, keyword: trimTo(b.keyword, 60), categoryKey: key, kind: 'owner_lock', actor: ctx.userId });
    await this.auditLog(ctx, 'expense_rule_created', { id, branchId: null }, { summary: `Always categorize ${b.vendor} as ${categoryLabel(key)}`, metadata: { vendorNorm, key } });
    return { id, vendorNorm, categoryKey: key };
  }
  /** Vendor-rule preview (Extras · Receipt Expense OCR 05): what an "always categorize this vendor as X" rule would do,
   *  BEFORE it is saved. A rule only classifies FUTURE drafts: approved history and open drafts keep their category (no
   *  silent change) — the preview counts how the last 180 days of this vendor's expenses were categorized against it. */
  async previewRule(ctx: FinanceCtx, b: { vendor: string; categoryKey: string }) {
    this.require(ctx, PERM.view);
    const vendorNorm = normalizeVendorName(b.vendor);
    if (!vendorNorm) throw new ExpenseError('EXPENSE_INVALID', 'Name the vendor this rule is for.');
    const { keys, custom } = await this.validKeys(ctx.tenantId);
    const key = normalizeCategory(b.categoryKey, keys);
    if (!key) throw new ExpenseError('EXPENSE_CATEGORY_NOT_FOUND');
    const today = await this.today(ctx.tenantId);
    const [hist, rules] = await Promise.all([this.repo.vendorHistory(ctx.tenantId, addDays(today, -180)), this.repo.rules(ctx.tenantId)]);
    const mine = hist.filter((h) => h.vendor && normalizeVendorName(h.vendor) === vendorNorm);
    const by = new Map<string, number>(); for (const h of mine) by.set(h.category, (by.get(h.category) ?? 0) + 1);
    const approved = mine.filter((h) => h.status === 'approved'); const open = mine.filter((h) => h.status === 'draft' || h.status === 'pending_review');
    const existing = rules.find((r) => r.vendorNorm === vendorNorm && r.active !== false && r.kind === 'owner_lock') ?? null;
    return {
      vendorNorm, categoryKey: key, categoryLabel: categoryLabel(key, custom), since: addDays(today, -180),
      matched: mine.length, sameCategory: mine.filter((h) => h.category === key).length,
      approved: approved.length, approvedDifferent: approved.filter((h) => h.category !== key).length,
      open: open.length, openDifferent: open.filter((h) => h.category !== key).length,
      byCategory: [...by.entries()].sort((x, y) => y[1] - x[1]).map(([k, n]) => ({ key: k, label: categoryLabel(k, custom), count: n })),
      replaces: existing ? { id: existing.id, categoryKey: existing.categoryKey, label: categoryLabel(existing.categoryKey, custom) } : null,
    };
  }
  async deleteRule(ctx: FinanceCtx, id: string) {
    this.require(ctx, PERM.categories);
    if (!(await this.repo.deactivateRule(this.db, ctx.tenantId, id, ctx.userId))) throw new ExpenseError('EXPENSE_NOT_FOUND', 'That rule was not found.');
    return { id, active: false };
  }

  // ── settings (§176) ─────────────────────────────────────────────────────────────────────────────────────────────
  async settings(ctx: FinanceCtx) {
    this.require(ctx, PERM.view);
    const s = await this.repo.settings(ctx.tenantId);
    return {
      requireApproval: s?.require_approval ?? true, autoReady: s?.auto_ready ?? true, autoCategory: s?.auto_category ?? true, learnFromCorrections: s?.learn_from_corrections ?? true,
      duplicateDetection: s?.duplicate_detection ?? true, billReminderDays: s?.bill_reminder_days ?? 7, defaultBranchId: s?.default_branch_id ?? null,
      receptionistUpload: s?.receptionist_upload ?? false, technicianUpload: s?.technician_upload ?? false,
      // P2-3 (Oct 23 2026): how salon-wide costs show on one branch's report — NONE (default) or the owner's shares
      sharedCostPolicy: (s?.shared_cost_policy === 'MANUAL_PERCENTAGE' ? 'MANUAL_PERCENTAGE' : 'NONE') as SharedCostPolicy,
      sharedCostShares: sharesOf(s?.shared_cost_shares),
      // §65 (Oct 27 2026): a branch that holds a share but has since been closed / removed. Its share keeps splitting (every
      // cent of a salon-wide cost stays accounted for on some branch); the owner is asked to move it to an open branch.
      sharedCostSharesNeedReview: await this.closedBranches(ctx.tenantId, sharesOf(s?.shared_cost_shares).map((x) => x.branchId)),
      // §177 (Oct 27 2026): what the owner is told about — in-app always; push / SMS / e-mail follow the platform's providers
      notifyNeedsReview: s?.notify_needs_review ?? true, notifyBillDue: s?.notify_bill_due ?? true, notifyDuplicate: s?.notify_duplicate ?? true,
      notifyWeeklySummary: s?.notify_weekly_summary ?? true, notifyMonthlySummary: s?.notify_monthly_summary ?? true,
      weeklySummarySentFor: s?.weekly_summary_sent_for ?? null, monthlySummarySentFor: s?.monthly_summary_sent_for ?? null,
      // §83 (Oct 27 2026): the owner's low-risk auto-approval rules (trusted vendor under a threshold) — off until the owner adds one
      autoApprovalRules: autoApprovalRulesOf(s?.auto_approval_rules),
      version: s?.version ?? 0,
    };
  }
  /** The ids among `ids` whose branch is no longer open (status not active, or soft-deleted). */
  private async closedBranches(tenantId: string, ids: readonly string[]): Promise<string[]> {
    if (!ids.length) return [];
    const r = await sql<{ id: string }>`SELECT id FROM branches WHERE tenant_id = ${tenantId} AND id IN (${sql.join([...ids])}) AND (status IS DISTINCT FROM 'active' OR deleted_at IS NOT NULL)`.execute(this.db);
    return r.rows.map((x) => String(x.id));
  }
  async saveSettings(ctx: FinanceCtx, b: Partial<{ requireApproval: boolean; autoReady: boolean; autoCategory: boolean; learnFromCorrections: boolean; duplicateDetection: boolean; billReminderDays: number; defaultBranchId: string | null; receptionistUpload: boolean; technicianUpload: boolean; sharedCostPolicy: SharedCostPolicy; sharedCostShares: SharedCostShare[];
    notifyNeedsReview: boolean; notifyBillDue: boolean; notifyDuplicate: boolean; notifyWeeklySummary: boolean; notifyMonthlySummary: boolean; autoApprovalRules: Array<{ vendor: string; maxCents: number; categoryKey?: string | null; enabled?: boolean }>; version: number }>) {
    this.require(ctx, PERM.categories);
    const cur = await this.repo.settings(ctx.tenantId);
    const set: Record<string, unknown> = {};
    const map: Record<string, string> = { requireApproval: 'require_approval', autoReady: 'auto_ready', autoCategory: 'auto_category', learnFromCorrections: 'learn_from_corrections', duplicateDetection: 'duplicate_detection', receptionistUpload: 'receptionist_upload', technicianUpload: 'technician_upload',
      notifyNeedsReview: 'notify_needs_review', notifyBillDue: 'notify_bill_due', notifyDuplicate: 'notify_duplicate', notifyWeeklySummary: 'notify_weekly_summary', notifyMonthlySummary: 'notify_monthly_summary' };
    for (const [k, col] of Object.entries(map)) if (typeof (b as Record<string, unknown>)[k] === 'boolean') set[col] = (b as Record<string, unknown>)[k];
    // §83: each rule names a vendor (normalised here), a threshold in whole cents and optionally one of the salon's categories
    if (b.autoApprovalRules !== undefined) {
      if (!Array.isArray(b.autoApprovalRules) || b.autoApprovalRules.length > 100) throw new ExpenseError('EXPENSE_INVALID', 'Up to 100 auto-approval rules.');
      const { keys } = await this.validKeys(ctx.tenantId);
      const rules: AutoApprovalRule[] = [];
      for (const r of b.autoApprovalRules) {
        const vendorNorm = normalizeVendorName(r?.vendor);
        if (!vendorNorm) throw new ExpenseError('EXPENSE_INVALID', 'Each auto-approval rule names a vendor.');
        if (!Number.isInteger(r.maxCents) || r.maxCents <= 0 || r.maxCents > 100_000_00) throw new ExpenseError('EXPENSE_INVALID', 'Each auto-approval rule has a threshold between $0.01 and $100,000.');
        const categoryKey = r.categoryKey ? normalizeCategory(r.categoryKey, keys) : null;
        if (r.categoryKey && !categoryKey) throw new ExpenseError('EXPENSE_CATEGORY_NOT_FOUND');
        if (rules.some((x) => x.vendorNorm === vendorNorm && (x.categoryKey ?? null) === (categoryKey ?? null))) throw new ExpenseError('EXPENSE_INVALID', `Two rules name ${r.vendor}.`);
        rules.push({ vendorNorm, maxCents: r.maxCents, categoryKey, enabled: r.enabled !== false });
      }
      set.auto_approval_rules = JSON.stringify(rules);
    }
    if (b.billReminderDays != null) { if (!Number.isInteger(b.billReminderDays) || b.billReminderDays < 0 || b.billReminderDays > 60) throw new ExpenseError('EXPENSE_INVALID', 'Reminder days must be 0–60.'); set.bill_reminder_days = b.billReminderDays; }
    if (b.defaultBranchId !== undefined) set.default_branch_id = b.defaultBranchId ? await this.writableBranch(ctx, b.defaultBranchId) : null;
    // P2-3: the shared-cost policy — MANUAL_PERCENTAGE needs this salon's branches, each once, totalling exactly 100%
    if (b.sharedCostPolicy !== undefined || b.sharedCostShares !== undefined) {
      const policy: SharedCostPolicy = b.sharedCostPolicy ?? (cur?.shared_cost_policy === 'MANUAL_PERCENTAGE' ? 'MANUAL_PERCENTAGE' : 'NONE');
      const shares = b.sharedCostShares ?? sharesOf(cur?.shared_cost_shares);
      if (policy === 'MANUAL_PERCENTAGE') {
        const v = validSharedCostShares(shares);
        if (!v.ok) throw new ExpenseError('EXPENSE_INVALID', `Branch shares: ${v.error}.`);
        for (const x of shares) await this.writableBranch(ctx, x.branchId);   // each one is this salon's (and the caller's) branch
        // §65 (Oct 27 2026): a NEW split may not give a share to a branch that is closed / removed (the stored split keeps
        // working until the owner re-saves it — settings().sharedCostSharesNeedReview names the branch)
        const closed = await this.closedBranches(ctx.tenantId, shares.map((x) => x.branchId));
        if (closed.length) throw new ExpenseError('EXPENSE_INVALID', 'Branch shares: a closed branch cannot take a share — give its percentage to an open branch.');
      }
      set.shared_cost_policy = policy;
      set.shared_cost_shares = JSON.stringify(shares.map((x) => ({ branchId: x.branchId, basisPoints: x.basisPoints })));   // kept under NONE too, so switching back restores them
    }
    const ok = await this.repo.saveSettings(this.db, ctx.tenantId, cur ? (b.version ?? cur.version) : null, set, ctx.userId);
    if (!ok) throw new ExpenseError('EXPENSE_VERSION_CONFLICT', 'Someone else changed these settings a moment ago. Reload and try again.');
    await this.auditLog(ctx, 'expense_settings_changed', { id: ctx.tenantId, branchId: null }, { before: cur, after: set });
    return this.settings(ctx);
  }

  // ── reads ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  async list(ctx: FinanceCtx, f: ListFilters & { branchId?: string | null; period?: ReportPeriod | null }) {
    this.require(ctx, PERM.view);
    const s = await this.scope(ctx, f.branchId);
    let { from, to } = f;
    if (f.period && !from && !to) ({ from, to } = periodWindow(f.period, await this.today(ctx.tenantId), { from: f.from, to: f.to }));
    for (const d of [from, to]) if (d && !isYmd(d)) throw new ExpenseError('EXPENSE_INVALID', 'Dates must be YYYY-MM-DD.');
    const attention = f.attention === 'no_receipt' || f.attention === 'uncategorized' || f.attention === 'overdue_review' ? f.attention : undefined;
    const { items, total, page } = await this.repo.list(s, { ...f, from, to, attention, overdueBefore: attention ? this.overdueBefore() : undefined });
    const { custom } = await this.validKeys(ctx.tenantId);
    return { items: items.map((e) => this.view(e, custom)), total, page, pageSize: Math.min(Math.max(1, f.pageSize ?? 50), 200) };
  }
  /** Bill due calendar (Extras · Receipt Expense OCR 06): open bills due within `days` (1–90, default 30) of the salon's
   *  today, overdue first. Read-only — paying a bill stays the permissioned Record payment action. */
  async billsDue(ctx: FinanceCtx, f: { days?: number | null; branchId?: string | null }) {
    this.require(ctx, PERM.view);
    const s = await this.scope(ctx, f.branchId);
    const today = await this.today(ctx.tenantId);
    const days = Number.isInteger(f.days) && (f.days as number) >= 1 && (f.days as number) <= 90 ? (f.days as number) : 30;
    const until = addDays(today, days);
    const rows = await this.repo.billsDue(s, until, 201);
    const { custom } = await this.validKeys(ctx.tenantId);
    return { today, until, days, capped: rows.length > 200, items: rows.slice(0, 200).map((e) => this.view(e, custom, today)) };
  }
  /** Expenses guide (Nov 4 2026): Total · Entries · Top Category (by amount) · Categories Used over the whole filtered set, with
   *  the period the server resolved in the salon's time zone (the screen shows it; a preset is never a device-clock guess). */
  async summary(ctx: FinanceCtx, f: Pick<ListFilters, 'from' | 'to' | 'category' | 'paymentMethod' | 'q'> & { branchId?: string | null; period?: ReportPeriod | null; trend?: boolean }) {
    this.require(ctx, PERM.view);
    const s = await this.scope(ctx, f.branchId);
    const tz = await this.tz(ctx.tenantId); const today = businessDate(tz, this.now());
    let { from, to } = f; const preset = f.period ?? (from || to ? 'custom' : null);
    for (const d of [from, to]) if (d && !isYmd(d)) throw new ExpenseError('EXPENSE_INVALID', 'Dates must be YYYY-MM-DD.');
    if (from && to && from > to) throw new ExpenseError('EXPENSE_INVALID', 'The start date must be on or before the end date.');
    if (f.period && f.period !== 'custom' && !from && !to) ({ from, to } = periodWindow(f.period, today));
    const scopeF = { from, to, category: f.category, paymentMethod: f.paymentMethod, q: f.q };
    const months = f.trend ? trendMonths(today, TREND_MONTHS) : null;
    const [k, att, monthly] = await Promise.all([this.repo.summary(s, scopeF), this.repo.attention(s, scopeF, this.overdueBefore()),
      months ? this.repo.monthly(s, { category: f.category, paymentMethod: f.paymentMethod, q: f.q }, `${months[0]}-01`, today) : Promise.resolve(null)]);
    const { custom } = await this.validKeys(ctx.tenantId);
    return { period: { preset: (preset ?? 'all') as 'today' | 'week' | 'month' | 'year' | 'custom' | 'all', from: from ?? null, to: to ?? null, tz, today },
      totalCents: k.totalCents, entries: k.entries, categoriesUsed: k.categoriesUsed,
      topCategory: k.top ? { key: k.top.key, label: categoryLabel(k.top.key, custom), totalCents: k.top.totalCents } : null,
      attention: { ...att, overdueAfterDays: REVIEW_OVERDUE_DAYS },
      // Extras (Expenses Management 06): the last 12 salon months (this month so far), every month listed — $0 is a real zero
      ...(months && monthly ? { trend: months.map((m) => { const x = monthly.find((r) => r.month === m); return { month: m, totalCents: x?.totalCents ?? 0, count: x?.count ?? 0 }; }) } : {}) };
  }
  /** a review waiting longer than this (since it last changed) is overdue on the attention bar */
  private overdueBefore() { return new Date(this.now().getTime() - REVIEW_OVERDUE_DAYS * 86400000); }
  private view(e: ExpenseRow, custom: Array<{ key: string; label: string }> = [], today?: string) {
    return { ...e, categoryLabel: categoryLabel(e.category, custom), vendorDisplay: e.vendorName ?? e.vendor,
      billDue: e.kind === 'bill' ? billDueState(e.dueDate, today ?? e.dueDate ?? '9999-12-31', e.billStatus ?? 'open') : null, openCents: e.kind === 'bill' ? Math.max(0, e.amountCents - e.paidCents) : 0 };
  }
  async detail(ctx: FinanceCtx, id: string) {
    this.require(ctx, PERM.view);
    const e = await this.getScoped(ctx, id);
    const [lines, allocations, documents, payments, history, { custom }, today] = await Promise.all([
      this.repo.lines(ctx.tenantId, id), this.repo.allocations(ctx.tenantId, id), this.repo.documents(ctx.tenantId, id), this.repo.billPayments(ctx.tenantId, id),
      this.repo.listHistory(ctx.tenantId, id), this.validKeys(ctx.tenantId), this.today(ctx.tenantId)]);
    let duplicates: DupResult = { status: 'none', matches: [] };
    if (e.duplicateStatus === 'possible' || e.duplicateStatus === 'exact') duplicates = detectExpenseDuplicates(this.dupSubject(e, null), await this.repo.dupCandidates(this.db, ctx.tenantId, { totalCents: e.amountCents, incurredOn: e.incurredOn, invoiceNumber: e.invoiceNumber, receiptNumber: e.receiptNumber }));
    return { expense: this.view(e, custom, today), lineItems: lines, allocations, documents, billPayments: payments, history, duplicates,
      reconciliation: reconcileBreakdown({ subtotalCents: e.subtotalCents, taxCents: e.taxCents, tipCents: e.tipCents, feeCents: e.feeCents, discountCents: e.discountCents, totalCents: e.amountCents }) };
  }
  private dupSubject(e: Pick<ExpenseRow, 'vendor' | 'vendorId' | 'incurredOn' | 'amountCents' | 'invoiceNumber' | 'receiptNumber'> & { id?: string }, files: { fileHash?: string | null; perceptualHash?: string | null } | null) {
    return { id: e.id ?? null, vendorRaw: e.vendor, vendorId: e.vendorId, incurredOn: e.incurredOn, totalCents: e.amountCents, invoiceNumber: e.invoiceNumber, receiptNumber: e.receiptNumber, fileHash: files?.fileHash ?? null, perceptualHash: files?.perceptualHash ?? null };
  }
  /** §48: the check the UI runs before Save, and create runs again inside its transaction */
  async checkDuplicates(ctx: FinanceCtx, x: { vendor?: string | null; vendorId?: string | null; incurredOn: string; amountCents: number; invoiceNumber?: string | null; receiptNumber?: string | null; excludeId?: string | null }) {
    this.require(ctx, PERM.view);
    const cands = await this.repo.dupCandidates(this.db, ctx.tenantId, { totalCents: x.amountCents, incurredOn: x.incurredOn, invoiceNumber: x.invoiceNumber, receiptNumber: x.receiptNumber });
    return detectExpenseDuplicates({ id: x.excludeId ?? null, vendorRaw: x.vendor ?? null, vendorId: x.vendorId ?? null, incurredOn: x.incurredOn, totalCents: x.amountCents, invoiceNumber: x.invoiceNumber, receiptNumber: x.receiptNumber }, cands);
  }
  /** Extras (Expenses Management 05): tenant-scoped vendor lookup for the expense form — the salon's canonical vendor for
   *  these words (exact normalized match) or up to three similar ones to pick from. Read-only: never creates or merges. */
  async vendorMatch(ctx: FinanceCtx, x: { vendor: string }): Promise<{ query: string; exact: { id: string; name: string } | null; suggestions: Array<{ id: string; name: string; score: number }>; willCreateOnApproval: boolean }> {
    this.require(ctx, PERM.view);
    const query = String(x.vendor ?? '').trim().slice(0, 200);
    if (!normalizeVendorName(query)) return { query, exact: null, suggestions: [], willCreateOnApproval: false };
    const list = await sql<{ id: string; name: string }>`SELECT id, name FROM inventory_vendors WHERE tenant_id = ${ctx.tenantId} AND COALESCE(active, true) ORDER BY name`.execute(this.db);
    const m = matchVendor(query, list.rows);
    const suggestions = m.suggestions.map((v) => ({ id: v.id, name: v.name, score: Math.round(vendorSimilarity(query, v.name) * 100) / 100 }));
    return { query, exact: m.vendor ? { id: m.vendor.id, name: m.vendor.name } : null, suggestions, willCreateOnApproval: !m.vendor && suggestions.length === 0 };
  }
  async recommend(ctx: FinanceCtx, x: { vendor?: string | null; lines?: string[] }): Promise<CategoryRecommendation> {
    this.require(ctx, PERM.view);
    return this.recommendInternal(ctx, x.vendor ?? null, x.lines ?? []);
  }
  private async recommendInternal(ctx: FinanceCtx, vendorRaw: string | null, lines: string[]): Promise<CategoryRecommendation> {
    const [{ keys }, rules] = await Promise.all([this.validKeys(ctx.tenantId), this.repo.rules(ctx.tenantId)]);
    const first = recommendCategory({ vendorRaw, lineDescriptions: lines, rules, validKeys: keys });
    if (first.source !== 'fallback' || !this.ai) return first;
    // §40: deterministic first; the AI only for what no rule decided — and only a key from this salon's list
    let ai: { key: string; confidence: number; reason?: string } | null = null;
    try { ai = await this.ai.suggest(ctx, { vendorRaw, lines: lines.slice(0, 20), validKeys: [...keys] }); } catch { ai = null; }
    return recommendCategory({ vendorRaw, lineDescriptions: lines, rules, validKeys: keys, ai });
  }

  // ── create ────────────────────────────────────────────────────────────────────────────────────────────────────────
  private validate(i: ExpenseInput, partial = false) {
    const bad = (m: string) => { throw new ExpenseError('EXPENSE_INVALID', m); };
    if (!partial || i.amountCents !== undefined) if (!centsOk(i.amountCents) || i.amountCents == null) bad('Enter the total as whole cents (0 or more).');
    for (const k of ['subtotalCents', 'taxCents', 'tipCents', 'feeCents', 'discountCents'] as const) if (!centsOk(i[k])) bad('Amounts must be whole cents, 0 or more.');
    if (!partial || i.incurredOn !== undefined) if (!isYmd(i.incurredOn)) bad('Date must be YYYY-MM-DD.');
    if (i.dueDate != null && !isYmd(i.dueDate)) bad('Due date must be YYYY-MM-DD.');
    if (i.paymentMethod != null && !PAYMENT_METHODS.has(i.paymentMethod)) bad('Choose a payment method from the list.');
    if (i.cardLast4 != null && !/^\d{4}$/.test(i.cardLast4)) bad('Card: the last four digits only.');   // §61 — never a PAN
    if (i.kind != null && i.kind !== 'expense' && i.kind !== 'bill') bad('kind must be expense or bill.');
    if (i.lineItems && i.lineItems.length > 200) bad('Too many line items.');
    for (const l of i.lineItems ?? []) { if (!trimTo(l.description, 300)) bad('Every line item needs a description.'); if (!Number.isInteger(l.totalCents)) bad('Line totals must be whole cents.'); }
  }

  async create(ctx: FinanceCtx, i: ExpenseInput, opts: { source?: 'manual' | 'ocr' | 'import'; approvedByOcr?: { userId: string } | null; systemIdempotent?: boolean } = {}): Promise<{ expense: ReturnType<ExpenseService['view']>; duplicate: DupResult; created: boolean }> {
    this.require(ctx, PERM.manage);
    this.validate(i);
    const source = opts.source ?? 'manual';
    if (i.idempotencyKey) { const prior = await this.repo.byIdempotency(this.db, ctx.tenantId, i.idempotencyKey); if (prior) return { expense: this.view(prior), duplicate: { status: 'none', matches: [] }, created: false }; }
    if (i.receiptDocumentId) { const prior = await this.repo.byReceipt(this.db, ctx.tenantId, i.receiptDocumentId); if (prior) return { expense: this.view(prior), duplicate: { status: 'none', matches: [] }, created: false }; }

    const settings = await this.settings({ ...ctx, permissions: [...ctx.permissions, PERM.view] });
    // §74/§75 (Oct 27 2026): the owner's switches decide whether the front desk may record at all, and whether a technician may —
    // and a technician records only a reimbursement receipt (paid personally), never a salon expense
    const role = source === 'ocr' ? '' : String(ctx.role ?? '').toUpperCase();   // an approved receipt posting is the review's decision, not a front-desk entry
    if ((role === 'FRONT_DESK' || role === 'RECEPTION' || role === 'RECEPTIONIST') && !settings.receptionistUpload) throw new ExpenseError('EXPENSE_ACCESS_DENIED', 'The front desk cannot record expenses at this salon (the owner can turn it on under Expenses → Settings).');
    if (role === 'TECHNICIAN') {
      if (!settings.technicianUpload) throw new ExpenseError('EXPENSE_ACCESS_DENIED', 'Technicians cannot record expenses at this salon (the owner can turn it on under Expenses → Settings).');
      if (!(i.reimburse || i.paymentMethod === 'personal_card')) throw new ExpenseError('EXPENSE_ACCESS_DENIED', 'A technician records a receipt paid personally (for reimbursement), not a salon expense.');
    }
    // a split across branches is a salon-wide expense: with allocations and no branch named, it is filed to the whole salon,
    // never to the salon's default branch (which would refuse the split — audit F6)
    // Expenses guide screenshots (Nov 4 2026): a POS (a branch device) sends no branch — the expense belongs to the location it
    // was entered at. It used to be filed salon-wide and then vanished from that location's own list. An explicit null (the
    // Owner App's "All branches") still files it to the whole salon.
    const unnamed = !Object.prototype.hasOwnProperty.call(i, 'branchId') || i.branchId === undefined;
    const branchId = await this.writableBranch(ctx, i.allocations?.length && i.branchId == null ? null : unnamed ? (ctx.selectedBranchId ?? settings.defaultBranchId ?? null) : i.branchId ?? settings.defaultBranchId ?? null);
    const { keys, custom } = await this.validKeys(ctx.tenantId);
    const evidence = i.receiptDocumentId ? await this.repo.receiptEvidence(this.db, ctx.tenantId, i.receiptDocumentId) : null;
    if (i.receiptDocumentId && !evidence) throw new ExpenseError('RECEIPT_NOT_FOUND');

    // category: a person's explicit choice wins; otherwise the engine (§42)
    let category: string; let categorySource: CategoryRecommendation['source'];
    if (i.category) {
      const k = normalizeCategory(i.category, keys);
      if (!k) throw new ExpenseError('EXPENSE_CATEGORY_NOT_FOUND');
      category = k; categorySource = 'owner';
    } else if (settings.autoCategory) {
      const rec = await this.recommendInternal(ctx, i.vendor ?? null, (i.lineItems ?? []).map((l) => l.description));
      category = rec.key; categorySource = rec.source;
    } else { category = FALLBACK_CATEGORY; categorySource = 'fallback'; }

    // vendor: keep the receipt's words (§46), link the salon's vendor when the name matches exactly
    let vendorId = i.vendorId ?? null;
    if (!vendorId && i.vendor) {
      const list = await sql<{ id: string; name: string }>`SELECT id, name FROM inventory_vendors WHERE tenant_id = ${ctx.tenantId} AND COALESCE(active, true)`.execute(this.db);
      vendorId = matchVendor(i.vendor, list.rows).vendor?.id ?? null;
    } else if (vendorId) {
      const ok = await sql<{ id: string }>`SELECT id FROM inventory_vendors WHERE tenant_id = ${ctx.tenantId} AND id = ${vendorId}`.execute(this.db);
      if (!ok.rows.length) throw new ExpenseError('VENDOR_NOT_FOUND');
    }

    // money must add up (§33–34); a breakdown that does not is flagged — the record is never "corrected" silently
    const rec = reconcileBreakdown({ subtotalCents: i.subtotalCents, taxCents: i.taxCents, tipCents: i.tipCents, feeCents: i.feeCents, discountCents: i.discountCents, totalCents: i.amountCents as number });
    const flags: string[] = [];
    if (!rec.reconciles) flags.push('total_not_reconciled');
    if (categorySource === 'fallback') flags.push('category_unsure');
    if (evidence) for (const f of evidence.fields) if (f.confidence != null && f.confidence < 0.8 && f.state !== 'manually_corrected' && f.state !== 'manually_confirmed') flags.push(`low_confidence:${f.key}`);
    // §96 (Oct 28 2026): the same vendor charged again the same day — "review recommended" (a flag never blocks a person's
    // save; it keeps the owner's auto-approval rules from approving it without a look)
    if (await this.repo.sameVendorSameDay(this.db, ctx.tenantId, { vendorId, vendor: i.vendor ?? null, incurredOn: i.incurredOn as string })) flags.push('same_vendor_same_day');

    // duplicates (§47–50): a person's save is stopped and asked; a background OCR posting is saved and flagged
    let dup: DupResult = { status: 'none', matches: [] };
    if (settings.duplicateDetection) {
      const cands = await this.repo.dupCandidates(this.db, ctx.tenantId, { totalCents: i.amountCents as number, incurredOn: i.incurredOn as string, invoiceNumber: i.invoiceNumber, receiptNumber: i.receiptNumber, fileHash: evidence?.fileHash });
      dup = detectExpenseDuplicates({ vendorRaw: i.vendor ?? null, vendorId, incurredOn: i.incurredOn as string, totalCents: i.amountCents as number, invoiceNumber: i.invoiceNumber, receiptNumber: i.receiptNumber, fileHash: evidence?.fileHash, perceptualHash: evidence?.perceptualHash }, cands);
      if (dup.status !== 'none' && source === 'manual' && !trimTo(i.duplicateOverrideReason, 500))
        throw new ExpenseError(dup.status === 'exact' ? 'RECEIPT_DUPLICATE' : 'RECEIPT_POSSIBLE_DUPLICATE', undefined, { duplicate: dup });
    }

    // status: what the person asked for, within what they may do and what the salon requires (§82)
    // a person who may approve and enters an expense by hand is approving it (the Owner App's behaviour before this module);
    // anyone else's entry, and anything the system read, waits for review unless the caller says otherwise
    const intent = i.intent ?? (source === 'manual' && this.has(ctx, PERM.approve) ? 'approve' : 'submit');
    let status: 'draft' | 'pending_review' | 'approved' = intent === 'draft' ? 'draft' : intent === 'approve' ? 'approved' : 'pending_review';
    if (status === 'approved' && !this.has(ctx, PERM.approve) && !opts.approvedByOcr) status = 'pending_review';
    // a suspected duplicate that nobody has decided on is never approved on the way in (§49)
    const dupState = dup.status === 'none' ? 'none' : trimTo(i.duplicateOverrideReason, 500) ? 'overridden' : dup.status;
    if (status === 'approved' && (dupState === 'possible' || dupState === 'exact')) status = 'pending_review';
    // an AI total that does not reconcile is never auto-approved (§33)
    if (status === 'approved' && !rec.reconciles && source !== 'manual') status = 'pending_review';
    // §83 (Oct 27 2026): the OWNER's standing rule — a trusted vendor at or under its threshold, with receipt evidence, clean
    // money, no flag and no suspected duplicate — approves what would otherwise wait. The AI contributed the reading only.
    let autoRule: AutoApprovalRule | null = null;
    if (status === 'pending_review' && (source === 'ocr' || !!i.receiptDocumentId) && settings.autoApprovalRules.length) {
      const d = autoApprovalDecision({ vendor: i.vendor ?? null, amountCents: i.amountCents as number, category, reconciles: rec.reconciles, reviewFlags: flags, duplicate: dupState === 'possible' || dupState === 'exact', hasReceipt: true }, settings.autoApprovalRules);
      if (d.approve) { status = 'approved'; autoRule = d.rule; }
    }
    if (!(EXPENSE.initial ?? []).includes(status)) throw new ExpenseError('EXPENSE_INVALID_STATE');   // a first state the machine allows

    const kind = i.kind ?? 'expense';
    const reimburse = !!i.reimburse || i.paymentMethod === 'personal_card';
    const approvedBy = status === 'approved' && !autoRule ? (opts.approvedByOcr?.userId ?? ctx.userId) : null;

    return await this.db.transaction().execute(async (trx) => {
      const id = await this.repo.insert(trx, {
        tenant_id: ctx.tenantId, branch_id: branchId, status, kind, category, category_raw: i.category ?? null, category_source: categorySource,
        amount_cents: i.amountCents, subtotal_cents: i.subtotalCents ?? null, tax_cents: i.taxCents ?? null, tip_cents: i.tipCents ?? null, fee_cents: i.feeCents ?? null, discount_cents: i.discountCents ?? null,
        currency: evidence?.currency ?? 'USD', description: trimTo(i.description, 1000), vendor: trimTo(i.vendor, 200), vendor_id: vendorId, incurred_on: i.incurredOn,
        payment_method: i.paymentMethod ?? null, card_brand: trimTo(i.cardBrand, 20), card_last4: i.cardLast4 ?? null, receipt_number: trimTo(i.receiptNumber, 80), invoice_number: trimTo(i.invoiceNumber, 80),
        reference_number: trimTo(i.referenceNumber, 80), receipt_document_id: i.receiptDocumentId ?? null, due_date: kind === 'bill' ? i.dueDate ?? null : null, bill_status: kind === 'bill' ? 'open' : null,
        reimbursement_status: reimburse ? 'pending' : 'not_required', reimburse_user_id: reimburse ? ctx.userId : null, recurring: !!i.recurring,
        duplicate_status: dupState, duplicate_of_id: dup.matches[0]?.id ?? null, duplicate_reason: dupState === 'overridden' ? trimTo(i.duplicateOverrideReason, 500) : dup.matches[0]?.reason ?? null,
        source, tax_review_status: i.taxReviewStatus ?? 'not_reviewed', accountant_note: trimTo(i.accountantNote, 2000), extraction_confidence: evidence?.confidence ?? null, review_flags: JSON.stringify(flags),
        approved_by: approvedBy, approved_at: status === 'approved' ? this.now() : null, idempotency_key: i.idempotencyKey ?? null, created_by: ctx.userId, updated_by: ctx.userId,
      });
      if (i.lineItems?.length) await this.repo.replaceLines(trx, ctx.tenantId, id, i.lineItems.map((l) => ({ description: l.description, quantity: l.quantity, unitPriceCents: l.unitPriceCents, totalCents: l.totalCents, finalCategoryKey: l.categoryKey ? normalizeCategory(l.categoryKey, keys) : null, confidence: l.confidence })));
      if (i.allocations?.length) await this.writeAllocations(trx, ctx, id, i.amountCents as number, i.allocations);
      if (i.receiptDocumentId) await this.repo.attachDocument(trx, ctx.tenantId, id, i.receiptDocumentId, 'receipt', ctx.userId);
      const row = (await this.repo.get(trx, { tenantId: ctx.tenantId, branchId: null, allowed: null }, id))!;
      await this.repo.history(trx, ctx.tenantId, { expenseId: id, action: 'created', actor: ctx.userId, reason: dupState === 'overridden' ? trimTo(i.duplicateOverrideReason, 500) : null, after: snapshot(row), version: row.version });
      if (autoRule) await this.repo.history(trx, ctx.tenantId, { expenseId: id, action: 'auto_approved', actor: null, reason: `owner rule: ${autoRule.vendorNorm} up to ${autoRule.maxCents}c`, before: { status: 'pending_review' }, after: { status: 'approved' }, version: row.version });
      await this.emit(trx, ctx, DOMAIN_EVENTS.EXPENSE_CREATED, row, { status, kind, category, amountCents: row.amountCents, source, receiptDocumentId: row.receiptDocumentId, autoApproved: !!autoRule });
      if (status === 'approved') await this.emit(trx, ctx, DOMAIN_EVENTS.EXPENSE_APPROVED, row, { amountCents: row.amountCents, category });
      if (dupState === 'possible' || dupState === 'exact') await this.emit(trx, ctx, DOMAIN_EVENTS.EXPENSE_DUPLICATE_DETECTED, row, { duplicateStatus: dupState, matchedExpenseId: dup.matches[0]?.id ?? null });
      if (status === 'approved' && vendorId && category !== 'other') await this.repo.bumpRule(trx, ctx.tenantId, normalizeVendorName(i.vendor ?? row.vendorName));
      await this.auditLog(ctx, 'expense_created', row, { summary: `${categoryLabel(category, custom)} ${row.amountCents}c (${status})`, after: snapshot(row), reason: dupState === 'overridden' ? i.duplicateOverrideReason : null, severity: dupState === 'overridden' ? 'warning' : 'info' });
      return { expense: this.view(row, custom), duplicate: dup, created: true };
    }).catch(async (e) => {
      // the unique receipt / idempotency index: another request just made it — answer with that one (§123, §193–194)
      if (String((e as { code?: string })?.code) === '23505') {
        const prior = (i.receiptDocumentId && (await this.repo.byReceipt(this.db, ctx.tenantId, i.receiptDocumentId))) || (i.idempotencyKey && (await this.repo.byIdempotency(this.db, ctx.tenantId, i.idempotencyKey)));
        if (prior) return { expense: this.view(prior), duplicate: { status: 'none' as const, matches: [] }, created: false };
      }
      throw e;
    });
  }

  private async writeAllocations(trx: Exec, ctx: FinanceCtx, expenseId: string, totalCents: number, input: AllocationInput[]) {
    const r = allocate(totalCents, input);
    if (!r.ok) throw new ExpenseError('EXPENSE_ALLOCATION_INVALID', r.error);
    // Oct 28 2026 (Receipt mandate audit F6, §68 / §69 / §93): a split was accepted on an expense FILED TO ONE BRANCH, and then
    // ignored — the branch report groups by the expense's branch and the shared-cost view reads salon-wide expenses only, so
    // the whole amount stayed on that branch. A split is for a salon-wide expense; refused here, by name, instead of lost.
    const filed = await sql<{ branch_id: string | null }>`SELECT branch_id FROM expenses WHERE tenant_id = ${ctx.tenantId} AND id = ${expenseId}`.execute(trx);
    if (r.allocations.length && filed.rows[0]?.branch_id) throw new ExpenseError('EXPENSE_ALLOCATION_INVALID', 'A split across branches is for an expense filed to the whole salon. File this expense to the whole salon, then split it.');
    const s = await this.scopes.resolve(ctx, null);
    for (const a of r.allocations) {
      if (s.restricted) throw new ExpenseError('EXPENSE_ACCESS_DENIED', 'Only an owner splits an expense across branches.');
      if (s.allowed && !s.allowed.includes(a.branchId)) throw new ExpenseError('EXPENSE_ACCESS_DENIED', 'That branch is not one of yours.');
    }
    await this.repo.replaceAllocations(trx, ctx.tenantId, expenseId, r.allocations);
  }

  // ── update / correct ───────────────────────────────────────────────────────────────────────────────────────────────
  /**
   * Edit an expense at the version the caller read. A draft / pending / rejected one is edited freely (manage). An
   * APPROVED one only by a correction: approve permission + a reason, recorded before / after (§81, §134) — the record
   * is never silently rewritten. The category correction feeds learning (§41).
   */
  async update(ctx: FinanceCtx, id: string, patch: ExpenseInput & { version: number; reason?: string | null }) {
    this.require(ctx, PERM.manage);
    this.validate(patch, true);
    if (!Number.isInteger(patch.version)) throw new ExpenseError('EXPENSE_INVALID', 'version is required.');
    const before = await this.getScoped(ctx, id);
    if (before.status === 'voided') throw new ExpenseError('EXPENSE_INVALID_STATE', 'A voided expense cannot be changed.');
    const correction = before.status === 'approved';
    if (correction) {
      this.require(ctx, PERM.approve);
      if (!trimTo(patch.reason, 500)) throw new ExpenseError('EXPENSE_INVALID', 'Say why an approved expense is being corrected.');
    }
    if (before.version !== patch.version) throw new ExpenseError('EXPENSE_VERSION_CONFLICT', undefined, { current: this.view(before) });
    const { keys, custom } = await this.validKeys(ctx.tenantId);
    const set: Record<string, unknown> = { updated_by: ctx.userId };
    if (patch.category !== undefined && patch.category !== null) { const k = normalizeCategory(patch.category, keys); if (!k) throw new ExpenseError('EXPENSE_CATEGORY_NOT_FOUND'); set.category = k; set.category_source = 'owner'; }
    const simple: Array<[keyof ExpenseInput, string, (v: unknown) => unknown]> = [
      ['amountCents', 'amount_cents', (v) => v], ['subtotalCents', 'subtotal_cents', (v) => v], ['taxCents', 'tax_cents', (v) => v], ['tipCents', 'tip_cents', (v) => v],
      ['feeCents', 'fee_cents', (v) => v], ['discountCents', 'discount_cents', (v) => v], ['incurredOn', 'incurred_on', (v) => v], ['vendor', 'vendor', (v) => trimTo(v as string, 200)],
      ['description', 'description', (v) => trimTo(v as string, 1000)], ['paymentMethod', 'payment_method', (v) => v], ['cardBrand', 'card_brand', (v) => trimTo(v as string, 20)],
      ['cardLast4', 'card_last4', (v) => v], ['receiptNumber', 'receipt_number', (v) => trimTo(v as string, 80)], ['invoiceNumber', 'invoice_number', (v) => trimTo(v as string, 80)],
      ['referenceNumber', 'reference_number', (v) => trimTo(v as string, 80)], ['dueDate', 'due_date', (v) => v], ['recurring', 'recurring', (v) => !!v],
      ['accountantNote', 'accountant_note', (v) => trimTo(v as string, 2000)], ['taxReviewStatus', 'tax_review_status', (v) => v],
    ];
    for (const [k, col, f] of simple) if (patch[k] !== undefined) set[col] = f(patch[k]);
    if (patch.dueDate !== undefined && before.kind !== 'bill') delete set.due_date;
    if (patch.vendorId !== undefined) {
      if (patch.vendorId) { const ok = await sql<{ id: string }>`SELECT id FROM inventory_vendors WHERE tenant_id = ${ctx.tenantId} AND id = ${patch.vendorId}`.execute(this.db); if (!ok.rows.length) throw new ExpenseError('VENDOR_NOT_FOUND'); }
      set.vendor_id = patch.vendorId ?? null;
    }
    if (patch.branchId !== undefined) set.branch_id = await this.writableBranch(ctx, patch.branchId);
    if (set.amount_cents !== undefined && before.kind === 'bill' && (set.amount_cents as number) < before.paidCents) throw new ExpenseError('BILL_INVALID', 'The total cannot be less than what was already paid.');
    const merged = { subtotalCents: (set.subtotal_cents as number | null | undefined) ?? before.subtotalCents, taxCents: (set.tax_cents as number | null | undefined) ?? before.taxCents, tipCents: (set.tip_cents as number | null | undefined) ?? before.tipCents,
      feeCents: (set.fee_cents as number | null | undefined) ?? before.feeCents, discountCents: (set.discount_cents as number | null | undefined) ?? before.discountCents, totalCents: (set.amount_cents as number | undefined) ?? before.amountCents };
    const recon = reconcileBreakdown(merged);
    const flags = before.reviewFlags.filter((f) => f !== 'total_not_reconciled' && f !== 'category_unsure' && !(set.category && f.startsWith('low_confidence:category')));
    if (!recon.reconciles) flags.push('total_not_reconciled');
    for (const k of Object.keys(set)) { const fk = `low_confidence:${k === 'amount_cents' ? 'total' : k.replace(/_cents$/, '')}`; const ix = flags.indexOf(fk); if (ix >= 0) flags.splice(ix, 1); }
    set.review_flags = JSON.stringify(flags);
    if (correction && !recon.reconciles) throw new ExpenseError('EXPENSE_INVALID', 'The corrected amounts do not add up to the total.');

    const out = await this.db.transaction().execute(async (trx) => {
      if (!(await this.repo.updateAtVersion(trx, ctx.tenantId, id, before.version, set))) {
        const cur = await this.repo.get(trx, { tenantId: ctx.tenantId, branchId: null, allowed: null }, id);
        throw new ExpenseError('EXPENSE_VERSION_CONFLICT', undefined, { current: cur ? this.view(cur, custom) : null });
      }
      if (patch.lineItems) await this.repo.replaceLines(trx, ctx.tenantId, id, patch.lineItems.map((l) => ({ description: l.description, quantity: l.quantity, unitPriceCents: l.unitPriceCents, totalCents: l.totalCents, finalCategoryKey: l.categoryKey ? normalizeCategory(l.categoryKey, keys) : null, confidence: l.confidence })));
      if (patch.allocations) await this.writeAllocations(trx, ctx, id, (set.amount_cents as number | undefined) ?? before.amountCents, patch.allocations);
      else if (set.amount_cents !== undefined && set.amount_cents !== before.amountCents) {
        // §65 (Oct 27 2026): the total changed and the owner sent no new split — an expense split by hand keeps its
        // proportions at the new total (largest remainder: still sums exactly), never the old amounts that no longer add up
        const old = await this.repo.allocations(ctx.tenantId, id);
        if (old.length) {
          const r = rescaleAllocations(old, set.amount_cents as number);
          if (!r.ok) throw new ExpenseError('EXPENSE_ALLOCATION_INVALID', r.error);
          await this.repo.replaceAllocations(trx, ctx.tenantId, id, r.allocations);
        }
      }
      const after = (await this.repo.get(trx, { tenantId: ctx.tenantId, branchId: null, allowed: null }, id))!;
      const catChanged = set.category !== undefined && set.category !== before.category;
      await this.repo.history(trx, ctx.tenantId, { expenseId: id, action: correction ? 'corrected' : 'updated', actor: ctx.userId, reason: trimTo(patch.reason, 500), before: snapshot(before), after: snapshot(after), version: after.version });
      if (catChanged) await this.repo.history(trx, ctx.tenantId, { expenseId: id, action: 'category_corrected', actor: ctx.userId, reason: trimTo(patch.reason, 500), before: { category: before.category }, after: { category: after.category, vendorNorm: normalizeVendorName(after.vendor ?? after.vendorName) }, version: after.version });
      await this.emit(trx, ctx, DOMAIN_EVENTS.EXPENSE_UPDATED, after, { status: after.status, amountCents: after.amountCents, correction, version: after.version });
      return { after, catChanged };
    });

    // §41 learning: a repeated move of the same vendor to the same category becomes a tenant vendor rule (never global)
    if (out.catChanged && (await this.settings({ ...ctx, permissions: [PERM.view] })).learnFromCorrections) {
      const vendorNorm = normalizeVendorName(out.after.vendor ?? out.after.vendorName);
      if (vendorNorm) {
        const prior = await this.repo.priorCorrections(ctx.tenantId, vendorNorm, out.after.category) - 1;
        const rule = learnFromCorrection({ vendorRaw: out.after.vendor ?? out.after.vendorName, from: before.category, to: out.after.category, priorCorrectionsToSameKey: Math.max(0, prior), existing: await this.repo.rules(ctx.tenantId) });
        if (rule) await this.repo.upsertRule(this.db, ctx.tenantId, { vendorNorm: rule.vendorNorm, vendorId: out.after.vendorId, categoryKey: rule.categoryKey, kind: 'learned', actor: ctx.userId });
      }
    }
    await this.auditLog(ctx, correction ? 'expense_corrected' : 'expense_updated', out.after, { before: snapshot(before), after: snapshot(out.after), reason: patch.reason ?? null, severity: correction ? 'warning' : 'info' });
    return { expense: this.view(out.after, custom) };
  }

  // ── status moves (each through its machine, at the version read, recorded + published) ─────────────────────────────
  private async move(ctx: FinanceCtx, id: string, version: number | null | undefined, to: 'pending_review' | 'approved' | 'rejected' | 'voided' | 'draft', x: { reason?: string | null; set?: Record<string, unknown>; event?: DomainEventType; action: string }) {
    const before = await this.getScoped(ctx, id);
    if (to === 'approved' && before.status === 'approved') return { expense: this.view(before), changed: false };    // §194 idempotent
    if (to === 'voided' && before.status === 'voided') return { expense: this.view(before), changed: false };
    if (version != null && version !== before.version) throw new ExpenseError('EXPENSE_VERSION_CONFLICT', undefined, { current: this.view(before) });
    try { assertTransition(EXPENSE, before.status, to); } catch (e) { if (e instanceof InvalidStateTransitionError) throw new ExpenseError('EXPENSE_INVALID_STATE', `This expense is ${before.status.replace('_', ' ')}.`); throw e; }
    const row = await this.db.transaction().execute(async (trx) => {
      if (!(await this.repo.updateAtVersion(trx, ctx.tenantId, id, before.version, { status: to, updated_by: ctx.userId, ...(x.set ?? {}) }))) {
        const cur = await this.repo.get(trx, { tenantId: ctx.tenantId, branchId: null, allowed: null }, id);
        if (cur && to === 'approved' && cur.status === 'approved') return cur;          // the other tap won; one effect (§194)
        throw new ExpenseError('EXPENSE_VERSION_CONFLICT', undefined, { current: cur ? this.view(cur) : null });
      }
      const after = (await this.repo.get(trx, { tenantId: ctx.tenantId, branchId: null, allowed: null }, id))!;
      await this.repo.history(trx, ctx.tenantId, { expenseId: id, action: x.action, actor: ctx.userId, reason: trimTo(x.reason, 500), before: { status: before.status }, after: { status: to }, version: after.version });
      if (x.event) await this.emit(trx, ctx, x.event, after, { status: to, amountCents: after.amountCents, category: after.category, reason: trimTo(x.reason, 200) });
      return after;
    });
    await this.auditLog(ctx, `expense_${x.action}`, row, { before: { status: before.status }, after: { status: row.status }, reason: x.reason ?? null, severity: to === 'voided' ? 'warning' : 'info' });
    return { expense: this.view(row), changed: true };
  }
  async submit(ctx: FinanceCtx, id: string, version?: number) { this.require(ctx, PERM.manage); return this.move(ctx, id, version, 'pending_review', { action: 'submitted', event: DOMAIN_EVENTS.EXPENSE_UPDATED }); }
  async returnToDraft(ctx: FinanceCtx, id: string, version?: number) { this.require(ctx, PERM.manage); return this.move(ctx, id, version, 'draft', { action: 'returned_to_draft' }); }
  async approve(ctx: FinanceCtx, id: string, version?: number) {
    this.require(ctx, PERM.approve);
    const e = await this.getScoped(ctx, id);
    if (e.status === 'approved') return { expense: this.view(e), changed: false };
    if (e.duplicateStatus === 'possible' || e.duplicateStatus === 'exact') throw new ExpenseError('RECEIPT_POSSIBLE_DUPLICATE', 'Decide whether this is a duplicate before approving it.', { duplicateStatus: e.duplicateStatus });
    if (e.reviewFlags.includes('total_not_reconciled')) throw new ExpenseError('EXPENSE_INVALID', 'The amounts do not add up to the total — fix them before approving.');
    const r = await this.move(ctx, id, version, 'approved', { action: 'approved', event: DOMAIN_EVENTS.EXPENSE_APPROVED, set: { approved_by: ctx.userId, approved_at: this.now(), rejected_reason: null } });
    if (r.changed) await this.linkVendorOnApproval(ctx, r.expense.id);
    return r;
  }
  async reject(ctx: FinanceCtx, id: string, reason: string, version?: number) {
    this.require(ctx, PERM.approve);
    if (!trimTo(reason, 500)) throw new ExpenseError('EXPENSE_INVALID', 'Say why it is rejected.');
    return this.move(ctx, id, version, 'rejected', { action: 'rejected', reason, event: DOMAIN_EVENTS.EXPENSE_REJECTED, set: { rejected_reason: trimTo(reason, 500) } });
  }
  async void(ctx: FinanceCtx, id: string, reason: string, version?: number) {
    this.require(ctx, PERM.approve);
    if (!trimTo(reason, 500)) throw new ExpenseError('EXPENSE_INVALID', 'Say why this expense is being voided.');
    const e = await this.getScoped(ctx, id);
    if (e.kind === 'bill' && e.paidCents > 0) throw new ExpenseError('BILL_INVALID', 'A bill with payments recorded cannot be voided.');
    return this.move(ctx, id, version, 'voided', { action: 'voided', reason, event: DOMAIN_EVENTS.EXPENSE_VOIDED, set: { voided_by: ctx.userId, voided_at: this.now(), void_reason: trimTo(reason, 500), ...(e.kind === 'bill' ? { bill_status: 'voided' } : {}) } });
  }
  /** §85: a draft or rejected expense may be removed (it was never a business record); anything else is voided / archived */
  async deleteDraft(ctx: FinanceCtx, id: string) {
    this.require(ctx, PERM.deleteDraft);
    const e = await this.getScoped(ctx, id);
    if (e.status !== 'draft' && e.status !== 'rejected') throw new ExpenseError('EXPENSE_INVALID_STATE', 'Only a draft can be deleted. Void or archive an approved expense instead.');
    if (e.receiptDocumentId) throw new ExpenseError('EXPENSE_INVALID_STATE', 'This draft carries a receipt — archive it instead so the evidence is kept.');
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('expense_line_items').where('tenant_id', '=', ctx.tenantId).where('expense_id', '=', id).execute();
      await trx.deleteFrom('expense_allocations').where('tenant_id', '=', ctx.tenantId).where('expense_id', '=', id).execute();
      await trx.deleteFrom('expense_history').where('tenant_id', '=', ctx.tenantId).where('expense_id', '=', id).execute();
      await trx.deleteFrom('expenses').where('tenant_id', '=', ctx.tenantId).where('id', '=', id).where('status', 'in', ['draft', 'rejected']).execute();
    });
    await this.auditLog(ctx, 'expense_draft_deleted', e, { before: snapshot(e), severity: 'warning' });
    return { id, deleted: true };
  }
  async archive(ctx: FinanceCtx, id: string, restore = false) {
    this.require(ctx, PERM.archive);
    const e = await this.getScoped(ctx, id);
    if (!!e.archivedAt === !restore) return { expense: this.view(e), changed: false };
    const row = await this.db.transaction().execute(async (trx) => {
      if (!(await this.repo.updateAtVersion(trx, ctx.tenantId, id, e.version, restore ? { archived_at: null, archived_by: null, updated_by: ctx.userId } : { archived_at: this.now(), archived_by: ctx.userId, updated_by: ctx.userId })))
        throw new ExpenseError('EXPENSE_VERSION_CONFLICT');
      const after = (await this.repo.get(trx, { tenantId: ctx.tenantId, branchId: null, allowed: null }, id))!;
      await this.repo.history(trx, ctx.tenantId, { expenseId: id, action: restore ? 'restored' : 'archived', actor: ctx.userId, version: after.version });
      if (!restore) await this.emit(trx, ctx, DOMAIN_EVENTS.EXPENSE_ARCHIVED, after, { status: after.status });
      else await this.emit(trx, ctx, DOMAIN_EVENTS.EXPENSE_UPDATED, after, { status: after.status, restored: true });
      return after;
    });
    await this.auditLog(ctx, restore ? 'expense_restored' : 'expense_archived', row);
    return { expense: this.view(row), changed: true };
  }
  /** §48–49: a person decides a suspected duplicate — keep it (with a reason) or confirm it (the copy is voided, kept as evidence) */
  async resolveDuplicate(ctx: FinanceCtx, id: string, decision: 'not_duplicate' | 'duplicate', reason: string) {
    this.require(ctx, PERM.approve);
    if (!trimTo(reason, 500)) throw new ExpenseError('EXPENSE_INVALID', 'Say why.');
    const e = await this.getScoped(ctx, id);
    const to = decision === 'not_duplicate' ? 'overridden' : 'confirmed_duplicate';
    try { assertTransition(EXPENSE_DUPLICATE, e.duplicateStatus, to); } catch { throw new ExpenseError('EXPENSE_INVALID_STATE', 'This expense is not marked as a possible duplicate.'); }
    const row = await this.db.transaction().execute(async (trx) => {
      const set: Record<string, unknown> = { duplicate_status: to, duplicate_reason: trimTo(reason, 500), updated_by: ctx.userId };
      if (decision === 'duplicate' && e.status !== 'voided' && !(e.kind === 'bill' && e.paidCents > 0)) { assertTransition(EXPENSE, e.status, 'voided'); Object.assign(set, { status: 'voided', voided_by: ctx.userId, voided_at: this.now(), void_reason: `Duplicate: ${trimTo(reason, 400)}`, ...(e.kind === 'bill' ? { bill_status: 'voided' } : {}) }); }
      if (!(await this.repo.updateAtVersion(trx, ctx.tenantId, id, e.version, set))) throw new ExpenseError('EXPENSE_VERSION_CONFLICT');
      const after = (await this.repo.get(trx, { tenantId: ctx.tenantId, branchId: null, allowed: null }, id))!;
      await this.repo.history(trx, ctx.tenantId, { expenseId: id, action: decision === 'duplicate' ? 'duplicate_confirmed' : 'duplicate_overridden', actor: ctx.userId, reason, before: { duplicateStatus: e.duplicateStatus, status: e.status }, after: { duplicateStatus: to, status: after.status }, version: after.version });
      await this.emit(trx, ctx, decision === 'duplicate' ? DOMAIN_EVENTS.EXPENSE_VOIDED : DOMAIN_EVENTS.EXPENSE_UPDATED, after, { status: after.status, duplicateStatus: to });
      return after;
    });
    await this.auditLog(ctx, decision === 'duplicate' ? 'expense_duplicate_confirmed' : 'expense_duplicate_overridden', row, { reason, severity: 'warning' });
    return { expense: this.view(row) };
  }

  // ── batch review (§138–139) ────────────────────────────────────────────────────────────────────────────────────────
  /** Approve every listed expense that is clean: pending, no suspected duplicate, amounts add up, and — for a scanned
   *  receipt — read at or above the threshold. Everything else is returned as an exception with its reason. */
  async approveHighConfidence(ctx: FinanceCtx, ids: string[], threshold = 0.95) {
    this.require(ctx, PERM.approve);
    const approved: string[] = []; const exceptions: Array<{ id: string; reason: string }> = [];
    for (const id of ids.slice(0, 200)) {
      try {
        const e = await this.getScoped(ctx, id);
        if (e.status !== 'pending_review') { exceptions.push({ id, reason: `is ${e.status}` }); continue; }
        if (e.duplicateStatus === 'possible' || e.duplicateStatus === 'exact') { exceptions.push({ id, reason: 'possible duplicate' }); continue; }
        if (e.reviewFlags.length) { exceptions.push({ id, reason: e.reviewFlags.join(', ') }); continue; }
        if (e.source === 'ocr' && (e.extractionConfidence ?? 0) < threshold) { exceptions.push({ id, reason: 'low confidence' }); continue; }
        await this.approve(ctx, id, e.version); approved.push(id);
      } catch (err) { exceptions.push({ id, reason: err instanceof ExpenseError ? err.code : 'failed' }); }
    }
    return { approved, exceptions };
  }
  async bulkCategorize(ctx: FinanceCtx, ids: string[], categoryKey: string) {
    this.require(ctx, PERM.manage);
    const { keys } = await this.validKeys(ctx.tenantId);
    const key = normalizeCategory(categoryKey, keys); if (!key) throw new ExpenseError('EXPENSE_CATEGORY_NOT_FOUND');
    const done: string[] = []; const skipped: Array<{ id: string; reason: string }> = [];
    for (const id of ids.slice(0, 200)) {
      let e: ExpenseRow;
      try { e = await this.getScoped(ctx, id); }
      catch (x) { if (x instanceof ExpenseError) { skipped.push({ id, reason: x.code === 'EXPENSE_ACCESS_DENIED' ? 'no access' : 'not found' }); continue; } throw x; }
      if (e.status === 'approved' || e.status === 'voided') { skipped.push({ id, reason: 'approved records change only by a correction' }); continue; }   // §139
      await this.update(ctx, id, { category: key, version: e.version }); done.push(id);
    }
    return { updated: done, skipped };
  }

  // ── bills (§53–56) ──────────────────────────────────────────────────────────────────────────────────────────────────
  async recordBillPayment(ctx: FinanceCtx, id: string, p: { amountCents: number; paidOn?: string | null; paymentMethod?: string | null; reference?: string | null; idempotencyKey?: string | null }) {
    this.require(ctx, PERM.bills);
    if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) throw new ExpenseError('BILL_INVALID', 'Enter the amount paid.');
    if (p.paymentMethod && !PAYMENT_METHODS.has(p.paymentMethod)) throw new ExpenseError('BILL_INVALID', 'Choose a payment method from the list.');
    const today = await this.today(ctx.tenantId);
    const paidOn = p.paidOn ?? today; if (!isYmd(paidOn)) throw new ExpenseError('BILL_INVALID', 'Date must be YYYY-MM-DD.');
    const out = await this.db.transaction().execute(async (trx) => {
      const e = await this.getScoped(ctx, id, trx, true);
      if (e.kind !== 'bill') throw new ExpenseError('BILL_INVALID', 'This expense is not a bill.');
      if (e.status === 'voided' || e.billStatus === 'voided') throw new ExpenseError('EXPENSE_INVALID_STATE', 'This bill is voided.');
      if (e.status !== 'approved') throw new ExpenseError('EXPENSE_INVALID_STATE', 'Approve the bill before recording a payment.');
      const pid = await this.repo.insertBillPayment(trx, ctx.tenantId, { expenseId: id, amountCents: p.amountCents, paidOn, method: p.paymentMethod ?? null, reference: trimTo(p.reference, 80), actor: ctx.userId, idempotencyKey: p.idempotencyKey ?? null });
      if (!pid) return { expense: e, duplicateTap: true };                                                  // the same payment, sent twice
      const paid = e.paidCents + p.amountCents;
      if (paid > e.amountCents) throw new ExpenseError('BILL_INVALID', `That is more than the ${(e.amountCents - e.paidCents) / 100} still owed.`);
      const next = billStatusFor(e.amountCents, paid);
      assertTransition(EXPENSE_BILL, e.billStatus, next);
      if (!(await this.repo.updateAtVersion(trx, ctx.tenantId, id, e.version, { paid_cents: paid, bill_status: next, paid_at: next === 'paid' ? this.now() : null, updated_by: ctx.userId }))) throw new ExpenseError('EXPENSE_VERSION_CONFLICT');
      const after = (await this.repo.get(trx, { tenantId: ctx.tenantId, branchId: null, allowed: null }, id))!;
      await this.repo.history(trx, ctx.tenantId, { expenseId: id, action: next === 'paid' ? 'bill_paid' : 'bill_payment_recorded', actor: ctx.userId, before: { paidCents: e.paidCents, billStatus: e.billStatus }, after: { paidCents: paid, billStatus: next, payment: p.amountCents }, version: after.version });
      await this.emit(trx, ctx, DOMAIN_EVENTS.BILL_PAYMENT_RECORDED, after, { amountCents: p.amountCents, paidCents: paid, billStatus: next });
      return { expense: after, duplicateTap: false };
    });
    if (!out.duplicateTap) await this.auditLog(ctx, out.expense.billStatus === 'paid' ? 'bill_marked_paid' : 'bill_payment_recorded', out.expense, { metadata: { amountCents: p.amountCents } });
    return { expense: this.view(out.expense, [], today) };
  }

  /** §56: once a day per bill — due soon / due today / overdue — published for the notification consumer. Idempotent. */
  async sweepBillReminders(now: Date = this.now()): Promise<{ sent: number }> {
    let sent = 0;
    const tzCache = new Map<string, string>();
    const today0 = businessDate('UTC', now);
    for (const b of await this.repo.billsToRemind(addDays(today0, 1))) {
      const tz = tzCache.get(b.tenantId) ?? (await this.tz(b.tenantId)); tzCache.set(b.tenantId, tz);
      const today = businessDate(tz, now);
      const state = billDueState(b.dueDate, today, 'open', b.reminderDays);
      if (state !== 'overdue' && state !== 'due_today' && state !== 'due_soon') continue;
      if (b.remindedOn && b.remindedOn >= today) continue;
      await this.db.transaction().execute(async (trx) => {
        if (!(await this.repo.markReminded(trx, b.tenantId, b.id, state, today))) return;
        await this.emit(trx, { tenantId: b.tenantId }, state === 'overdue' ? DOMAIN_EVENTS.BILL_OVERDUE : DOMAIN_EVENTS.BILL_DUE_SOON, { id: b.id, branchId: b.branchId }, { dueDate: b.dueDate, dueState: state, openCents: b.openCents });
        sent++;
      });
    }
    return { sent };
  }

  // ── reimbursement (§64–66) ────────────────────────────────────────────────────────────────────────────────────────
  async reimbursement(ctx: FinanceCtx, id: string, action: 'request' | 'approve' | 'pay' | 'reject' | 'cancel', reason?: string | null) {
    const e = await this.getScoped(ctx, id);
    const to = ({ request: 'pending', approve: 'approved', pay: 'paid', reject: 'rejected', cancel: 'not_required' } as const)[action];
    this.require(ctx, action === 'request' || action === 'cancel' ? PERM.manage : PERM.reimburse);
    if ((action === 'approve' || action === 'pay') && e.status !== 'approved') throw new ExpenseError('EXPENSE_INVALID_STATE', 'Approve the expense before its reimbursement.');
    if (action === 'reject' && !trimTo(reason, 500)) throw new ExpenseError('EXPENSE_INVALID', 'Say why the reimbursement is rejected.');
    try { assertTransition(EXPENSE_REIMBURSEMENT, e.reimbursementStatus, to); } catch { throw new ExpenseError('EXPENSE_INVALID_STATE', `Reimbursement is ${e.reimbursementStatus.replace('_', ' ')}.`); }
    const row = await this.db.transaction().execute(async (trx) => {
      if (!(await this.repo.updateAtVersion(trx, ctx.tenantId, id, e.version, { reimbursement_status: to, ...(action === 'request' ? { reimburse_user_id: e.reimburseUserId ?? ctx.userId } : {}), ...(action === 'pay' ? { reimbursed_at: this.now() } : {}), updated_by: ctx.userId })))
        throw new ExpenseError('EXPENSE_VERSION_CONFLICT');
      const after = (await this.repo.get(trx, { tenantId: ctx.tenantId, branchId: null, allowed: null }, id))!;
      await this.repo.history(trx, ctx.tenantId, { expenseId: id, action: `reimbursement_${action}`, actor: ctx.userId, reason: trimTo(reason, 500), before: { reimbursementStatus: e.reimbursementStatus }, after: { reimbursementStatus: to }, version: after.version });
      await this.emit(trx, ctx, DOMAIN_EVENTS.EXPENSE_REIMBURSEMENT_CHANGED, after, { reimbursementStatus: to, amountCents: after.amountCents });
      return after;
    });
    await this.auditLog(ctx, `reimbursement_${action}`, row, { reason: reason ?? null });
    return { expense: this.view(row) };
  }

  // ── evidence ───────────────────────────────────────────────────────────────────────────────────────────────────────
  /** attach another page / invoice / supporting file; after approval a new receipt is a REPLACEMENT, never an overwrite (§84) */
  async attachDocument(ctx: FinanceCtx, id: string, documentId: string, role: 'receipt' | 'invoice' | 'supporting' | 'replacement' = 'supporting') {
    this.require(ctx, PERM.manage);
    const e = await this.getScoped(ctx, id);
    const doc = await this.repo.receiptEvidence(this.db, ctx.tenantId, documentId);
    if (!doc) throw new ExpenseError('RECEIPT_NOT_FOUND');
    const effectiveRole = e.status === 'approved' && role === 'receipt' ? 'replacement' : role;
    await this.db.transaction().execute(async (trx) => {
      await this.repo.attachDocument(trx, ctx.tenantId, id, documentId, effectiveRole, ctx.userId);
      // Oct 28 2026 re-audit: a lost version race rolls the attach back (history said "attached" while receipt_document_id was never set)
      if (!e.receiptDocumentId && effectiveRole === 'receipt' && !(await this.repo.updateAtVersion(trx, ctx.tenantId, id, e.version, { receipt_document_id: documentId, updated_by: ctx.userId }))) throw new ExpenseError('EXPENSE_VERSION_CONFLICT');
      await this.repo.history(trx, ctx.tenantId, { expenseId: id, action: 'document_attached', actor: ctx.userId, after: { documentId, role: effectiveRole } });
    });
    await this.auditLog(ctx, 'expense_document_attached', e, { metadata: { documentId, role: effectiveRole } });
    return { expenseId: id, documentId, role: effectiveRole };
  }

  /** after approval the receipt's vendor joins the salon's directory (so future receipts match it) — §44 */
  private async linkVendorOnApproval(ctx: FinanceCtx, id: string) {
    try {
      const e = await this.repo.get(this.db, { tenantId: ctx.tenantId, branchId: null, allowed: null }, id);
      if (!e || e.vendorId || !e.vendor || !this.vendors) return;
      const list = await sql<{ id: string; name: string }>`SELECT id, name FROM inventory_vendors WHERE tenant_id = ${ctx.tenantId}`.execute(this.db);
      const found = matchVendor(e.vendor, list.rows);
      let v = found.vendor;
      // Extras (Expenses Management 05): a similar vendor already exists — leave it for a person to link, never add a near-duplicate
      if (!v && found.suggestions.length) { financeLog.warn(`vendor link left for review on expense ${id}: ${found.suggestions.length} similar vendor(s)`); return; }
      if (!v) { const name = e.vendor.replace(/\s*#\s*\d+\s*$/, '').trim(); if (normalizeVendorName(name)) v = { id: (await this.vendors.create(ctx, name)).id, name }; }
      if (v) await sql`UPDATE expenses SET vendor_id = ${v.id} WHERE tenant_id = ${ctx.tenantId} AND id = ${id} AND vendor_id IS NULL`.execute(this.db);
      if (v && e.category !== 'other') await this.repo.bumpRule(this.db, ctx.tenantId, normalizeVendorName(e.vendor));
    } catch (x) { financeLog.warn(`vendor link skipped for expense ${id}: ${(x as Error).message}`); }   // a convenience; the approved expense already stands
  }

  // ── OCR posting: an approved receipt document becomes ONE approved expense (§2, §10, §193) ─────────────────────────
  /**
   * Called by the OCR posting adapter after a person approved the document in OCR review. Idempotent per document (the
   * unique receipt index): a retried posting returns the expense it already made. The OCR reviewer's approval IS the
   * approval — the expense lands `approved` unless its money does not add up or it is a suspected duplicate, in which
   * case it lands `pending_review` and waits for a person (never a silent auto-approve, §33/§49).
   */
  async postFromReceipt(ctx: FinanceCtx, documentId: string, x: { category?: string | null; description?: string | null; idempotencyKey: string }) {
    // posting authority: the expense manager, or the OCR reviewer who holds the OCR `post` permission (the receipt was
    // already approved in OCR review — that approval is what this records; nobody gains expense rights beyond it)
    if (!this.has(ctx, PERM.manage) && !this.has(ctx, 'pos.ai_ocr_receipt.post')) throw new ExpenseError('EXPENSE_ACCESS_DENIED');
    ctx = { ...ctx, permissions: [...new Set([...ctx.permissions, PERM.manage, PERM.view])] };
    const ev = await this.repo.receiptEvidence(this.db, ctx.tenantId, documentId);
    if (!ev) throw new ExpenseError('RECEIPT_NOT_FOUND');
    const field = (k: string) => ev.fields.find((f) => f.key === k);
    const total = ev.totalCents ?? field('total')?.cents ?? null;
    const date = ev.documentDate ?? field('document_date')?.text ?? null;
    if (total == null || !isYmd(date)) throw new ExpenseError('EXPENSE_INVALID', 'The receipt needs a total and a date before it can become an expense.');
    const lines = ev.lines.filter((l) => l.description && l.totalCents != null).map((l) => ({ description: l.description, quantity: l.quantity, unitPriceCents: l.unitPriceCents, totalCents: l.totalCents as number, confidence: l.confidence }));
    const type = ev.documentType;
    const isBill = type === 'invoice' || type === 'utility_bill';
    const due = field('due_date')?.text;
    // §28 (Oct 27 2026): tip (restaurant receipts), the PO / reference number — read by the adapter, carried onto the expense
    const tip = field('tip')?.cents ?? null;
    const po = field('po_number')?.text ?? null;
    const { keys } = await this.validKeys(ctx.tenantId);
    const category = x.category && normalizeCategory(x.category, keys) ? x.category : null;   // an OCR suggestion outside the salon's list → the engine decides
    const r = await this.create({ ...ctx, selectedBranchId: ev.branchId ?? ctx.selectedBranchId ?? null }, {
      kind: isBill ? 'bill' : 'expense', category, amountCents: total, subtotalCents: ev.subtotalCents, taxCents: ev.taxCents, tipCents: tip != null && tip >= 0 ? tip : null, feeCents: ev.feeCents, discountCents: ev.discountCents,
      incurredOn: date, vendor: ev.vendor, vendorId: ev.vendorId, description: x.description ?? null, branchId: ev.branchId ?? ctx.selectedBranchId ?? null,
      receiptNumber: isBill ? null : ev.documentNumber, invoiceNumber: isBill ? ev.documentNumber : null, referenceNumber: po, dueDate: isBill && isYmd(due) ? due : null,
      lineItems: lines, receiptDocumentId: documentId, intent: 'approve', idempotencyKey: x.idempotencyKey,
    }, { source: 'ocr', approvedByOcr: { userId: ctx.userId } });
    return r;
  }

  // ── §142 receipt → EXISTING expense (suggest, never auto-link) ─────────────────────────────────────────────────────
  /** The expense this receipt document could be the evidence for. The OCR pipeline calls it when a document reaches review;
   *  the reviewer links it (attachDocument role 'receipt') instead of posting a new expense. UNMATCHED is an honest answer. */
  async suggestExpenseForReceipt(ctx: FinanceCtx, documentId: string): Promise<{ verdict: MatchVerdict; expenseId: string | null; reason: string | null; candidates: Array<{ expenseId: string; score: number; reasons: string[] }> }> {
    if (!ctx?.tenantId) throw new ExpenseError('EXPENSE_ACCESS_DENIED', 'No salon context.');
    const ev = await this.repo.receiptEvidence(this.db, ctx.tenantId, documentId);
    if (!ev) throw new ExpenseError('RECEIPT_NOT_FOUND');
    const already = await this.repo.byReceipt(this.db, ctx.tenantId, documentId);
    if (already) return { verdict: 'matched', expenseId: already.id, reason: 'already_linked', candidates: [] };
    let cands = await this.repo.receiptMatchCandidates(ctx.tenantId, { totalCents: ev.totalCents, documentDate: ev.documentDate, documentNumber: ev.documentNumber, excludeDocumentId: documentId });
    // Oct 28 2026 (mandate audit F3, §72): a person's request sees only expenses in their branches (it returned other
    // branches' expense ids, scores and reasons to a branch-restricted manager); the pipeline's own system call is salon-wide
    if (!String(ctx.userId ?? '').startsWith('system:')) {
      const vis = await this.visibleBranches(ctx);
      if (vis) cands = cands.filter((c) => !!c.branchId && vis.includes(c.branchId));
    }
    return matchReceiptToExpenses({ vendor: ev.vendor, documentDate: ev.documentDate, totalCents: ev.totalCents, documentNumber: ev.documentNumber }, cands);
  }

  // ── §62/§63 expense ↔ payment / bank transaction ──────────────────────────────────────────────────────────────────
  /** Looks for the salon's own card / bank transaction behind this expense. With no transaction feed connected the verdict is
   *  UNMATCHED and says so; a MATCHED verdict needs amount + date + one more fact, and exactly one such transaction. */
  async matchPayment(ctx: FinanceCtx, id: string) {
    this.require(ctx, PERM.manage);
    const e = await this.getScoped(ctx, id);
    const feed = this.paymentFeed ? await this.paymentFeed.candidates(ctx, { amountCents: e.amountCents, incurredOn: e.incurredOn }) : [];
    const m = this.paymentFeed ? matchExpenseToPayments({ amountCents: e.amountCents, incurredOn: e.incurredOn, cardLast4: e.cardLast4, referenceNumber: e.referenceNumber, vendor: e.vendorName ?? e.vendor }, feed)
      : { verdict: 'unmatched' as const, paymentId: null, reason: 'no transaction feed connected' };
    await this.db.transaction().execute(async (trx) => {
      // Oct 28 2026 re-audit: the version check is enforced (a concurrent edit is a conflict, not a silent overwrite)
      if (!(await this.repo.updateAtVersion(trx, ctx.tenantId, id, e.version, { payment_match_status: m.verdict, matched_payment_id: m.verdict === 'matched' && m.paymentId && UUID_RE.test(m.paymentId) ? m.paymentId : null, matched_payment_ref: m.verdict === 'matched' ? m.paymentId : null, payment_match_reason: m.reason, payment_matched_at: this.now(), payment_matched_by: null, updated_by: ctx.userId }))) throw new ExpenseError('EXPENSE_VERSION_CONFLICT');
      await this.repo.history(trx, ctx.tenantId, { expenseId: id, action: 'payment_match_checked', actor: ctx.userId, after: { verdict: m.verdict, paymentId: m.paymentId, reason: m.reason }, version: e.version + 1 });
    });
    await this.auditLog(ctx, 'expense_payment_match_checked', e, { metadata: { verdict: m.verdict, paymentId: m.paymentId, reason: m.reason } });   // §80: an audited action like every other expense change
    return { expenseId: id, verdict: m.verdict, paymentId: m.paymentId, reason: m.reason, candidates: feed.length };
  }
  /** A person confirms a link (a reference from their statement, or a POSSIBLE_MATCH) or clears one. Recorded with the actor. */
  async setPaymentMatch(ctx: FinanceCtx, id: string, b: { decision: 'confirm' | 'clear'; paymentRef?: string | null; version?: number | null }) {
    this.require(ctx, PERM.manage);
    const e = await this.getScoped(ctx, id);
    if (b.version != null && b.version !== e.version) throw new ExpenseError('EXPENSE_VERSION_CONFLICT', undefined, { current: this.view(e) });
    const ref = trimTo(b.paymentRef, 120);
    if (b.decision === 'confirm' && !ref) throw new ExpenseError('EXPENSE_INVALID', 'Name the transaction (its reference or last digits) you are linking.');
    const set = b.decision === 'confirm'
      ? { payment_match_status: 'matched', matched_payment_ref: ref, payment_match_reason: 'confirmed by a person', payment_matched_at: this.now(), payment_matched_by: ctx.userId, updated_by: ctx.userId }
      : { payment_match_status: 'unmatched', matched_payment_id: null, matched_payment_ref: null, payment_match_reason: 'cleared by a person', payment_matched_at: this.now(), payment_matched_by: ctx.userId, updated_by: ctx.userId };
    const row = await this.db.transaction().execute(async (trx) => {
      if (!(await this.repo.updateAtVersion(trx, ctx.tenantId, id, e.version, set))) throw new ExpenseError('EXPENSE_VERSION_CONFLICT');
      const after = (await this.repo.get(trx, { tenantId: ctx.tenantId, branchId: null, allowed: null }, id))!;
      await this.repo.history(trx, ctx.tenantId, { expenseId: id, action: b.decision === 'confirm' ? 'payment_linked' : 'payment_unlinked', actor: ctx.userId, after: { paymentRef: ref }, version: after.version });
      return after;
    });
    await this.auditLog(ctx, b.decision === 'confirm' ? 'expense_payment_linked' : 'expense_payment_unlinked', row, { metadata: { paymentRef: ref } });
    return { expense: this.view(row) };
  }

  // ── §177–§179 weekly / monthly owner summaries ─────────────────────────────────────────────────────────────────────
  /** Once per completed period per salon (the settings row remembers what was sent): publishes `expense.summary_ready` for the
   *  in-app consumer. Skipped for a salon whose owner turned the summary off. Idempotent across replicas and restarts. */
  async sweepDigests(now: Date = this.now()): Promise<{ weekly: number; monthly: number }> {
    const out = { weekly: 0, monthly: 0 };
    for (const t of await this.repo.digestTenants()) {
      const tz = await this.tz(t.tenantId);
      const today = businessDate(tz, now);
      const due = digestsDue(today, t);
      const s: Scope = { tenantId: t.tenantId, branchId: null, allowed: null, salonWide: true };
      if (due.weekly) {
        const w = { from: due.weekly, to: addDays(due.weekly, 6) };
        const [totals, counts, receipts] = await Promise.all([this.repo.totals(s, w.from, w.to), this.repo.counts(s, today, 7, tz), this.repo.receiptsUploadedBetween(t.tenantId, w.from, w.to, tz)]);
        const text = weeklySummary({ from: w.from, to: w.to, totalCents: totals.totalCents, receipts, needsReview: counts.needsReview, billsDue: counts.billsDue + counts.billsOverdue });
        await this.db.transaction().execute(async (trx) => {
          if (!(await this.repo.markDigestSent(trx, t.tenantId, 'weekly', due.weekly!))) return;
          await this.emit(trx, { tenantId: t.tenantId }, DOMAIN_EVENTS.EXPENSE_SUMMARY_READY, { id: t.tenantId, branchId: null }, { period: 'week', from: w.from, to: w.to, totalCents: totals.totalCents, receipts, needsReview: counts.needsReview, billsDue: counts.billsDue + counts.billsOverdue, ...text });
          out.weekly++;
        });
      }
      if (due.monthly) {
        const w = monthWindow(due.monthly);
        const prev = monthWindow(lastCompletedMonth(`${due.monthly}-15`));
        const [{ custom }, totals, prevTotals, byCategory, byVendor] = await Promise.all([this.validKeys(t.tenantId), this.repo.totals(s, w.from, w.to), this.repo.totals(s, prev.from, prev.to), this.repo.groupBy(s, w.from, w.to, 'category'), this.repo.groupBy(s, w.from, w.to, 'vendor')]);
        const text = monthlySummary({ month: due.monthly, totalCents: totals.totalCents, previousTotalCents: prevTotals.totalCents, changePct: pctChange(totals.totalCents, prevTotals.totalCents),
          largestCategory: byCategory[0] ? categoryLabel(byCategory[0].key, custom) : null, largestVendor: byVendor[0] ? (byVendor[0].label ?? (byVendor[0].key.startsWith('raw:') ? byVendor[0].key.slice(4) : byVendor[0].key)) || null : null });
        await this.db.transaction().execute(async (trx) => {
          if (!(await this.repo.markDigestSent(trx, t.tenantId, 'monthly', due.monthly!))) return;
          await this.emit(trx, { tenantId: t.tenantId }, DOMAIN_EVENTS.EXPENSE_SUMMARY_READY, { id: t.tenantId, branchId: null }, { period: 'month', from: w.from, to: w.to, totalCents: totals.totalCents, previousTotalCents: prevTotals.totalCents, changePct: pctChange(totals.totalCents, prevTotals.totalCents), ...text });
          out.monthly++;
        });
      }
    }
    return out;
  }

  // ── reports (§88–95, §104–108) ─────────────────────────────────────────────────────────────────────────────────────
  async dashboard(ctx: FinanceCtx, branchId?: string | null) {
    this.require(ctx, PERM.view);
    const s = await this.scope(ctx, branchId);
    const today = await this.today(ctx.tenantId);
    const settings = await this.settings({ ...ctx, permissions: [PERM.view] });
    const tz = await this.tz(ctx.tenantId);
    const [month, year, day, counts, receiptsToday] = await Promise.all([
      this.repo.totals(s, ...Object.values(periodWindow('month', today)) as [string, string]),
      this.repo.totals(s, ...Object.values(periodWindow('year', today)) as [string, string]),
      this.repo.totals(s, today, today), this.repo.counts(s, today, settings.billReminderDays, tz), this.repo.receiptsUploadedOn(ctx.tenantId, today, tz)]);
    return { today, thisMonthCents: month.totalCents, thisYearCents: year.totalCents, todayCents: day.totalCents, todayCount: day.count, receiptsUploadedToday: receiptsToday, ...counts };
  }

  async report(ctx: FinanceCtx, q: { period?: ReportPeriod; from?: string; to?: string; branchId?: string | null }) {
    this.require(ctx, PERM.view);
    const s = await this.scope(ctx, q.branchId);
    const today = await this.today(ctx.tenantId);
    const period = q.period ?? 'month';
    let w: DateWindow;
    try { w = periodWindow(period, today, { from: q.from, to: q.to }); } catch (e) { throw new ExpenseError('EXPENSE_INVALID', (e as Error).message); }
    const prev = previousWindow(period, w);
    const settings = await this.settings({ ...ctx, permissions: [PERM.view] });
    const [{ custom }, totals, prevTotals, byCategory, prevByCategory, byVendor, byBranch, series, byPayment, counts, newVendors, charges] = await Promise.all([
      this.validKeys(ctx.tenantId), this.repo.totals(s, w.from, w.to), this.repo.totals(s, prev.from, prev.to),
      this.repo.groupBy(s, w.from, w.to, 'category'), this.repo.groupBy(s, prev.from, prev.to, 'category'), this.repo.groupBy(s, w.from, w.to, 'vendor'),
      this.repo.groupBy(s, w.from, w.to, 'branch'), this.repo.groupBy(s, w.from, w.to, period === 'year' || period === 'last_year' ? 'month' : 'day'), this.repo.groupBy(s, w.from, w.to, 'payment_method'),
      this.repo.counts(s, today, settings.billReminderDays, await this.tz(ctx.tenantId)), this.repo.newVendorCount(s, w.from, w.to), this.repo.chargeSeries(s, addDays(today, -215), today)]);
    const labels = Object.fromEntries([...DEFAULT_EXPENSE_CATEGORIES.map((c) => [c.key, c.label]), ...custom.map((c) => [c.key, c.label])]);
    const prevMap = Object.fromEntries(prevByCategory.map((c) => [c.key, c.totalCents]));
    const categories = byCategory.map((c) => ({ key: c.key, label: labels[c.key] ?? c.key, totalCents: c.totalCents, count: c.count, previousCents: prevMap[c.key] ?? 0, changePct: pctChange(c.totalCents, prevMap[c.key] ?? 0) }));
    // all ten defaults appear even at $0 so the owner sees the whole picture (§89)
    for (const d of DEFAULT_EXPENSE_CATEGORIES) if (!categories.some((c) => c.key === d.key)) categories.push({ key: d.key, label: d.label, totalCents: 0, count: 0, previousCents: prevMap[d.key] ?? 0, changePct: null });
    categories.sort((a, b) => b.totalCents - a.totalCents || (DEFAULT_EXPENSE_CATEGORIES.find((d) => d.key === a.key)?.sortOrder ?? 99) - (DEFAULT_EXPENSE_CATEGORIES.find((d) => d.key === b.key)?.sortOrder ?? 99));
    const recurring = detectRecurring(charges);
    const insights = expenseInsights({ categoryNow: Object.fromEntries(byCategory.map((c) => [c.key, c.totalCents])), categoryBefore: prevMap, labels, possibleDuplicates: counts.possibleDuplicates, needsReview: counts.needsReview, overdueBills: counts.billsOverdue, newVendorsThisPeriod: newVendors });
    // §202: the category, vendor and branch breakdowns each sum to the same total — checked here, not assumed
    const sums = { byCategory: byCategory.reduce((t, c) => t + c.totalCents, 0), byVendor: byVendor.reduce((t, c) => t + c.totalCents, 0), byBranch: byBranch.reduce((t, c) => t + c.totalCents, 0) };
    const sharedCosts = await this.sharedCosts(ctx.tenantId, s, w, settings.sharedCostPolicy, settings.sharedCostShares);
    return {
      sharedCosts,
      period, window: w, previousWindow: prev, totalCents: totals.totalCents, count: totals.count, previousTotalCents: prevTotals.totalCents, changePct: pctChange(totals.totalCents, prevTotals.totalCents),
      byCategory: categories, byVendor: byVendor.slice(0, 25).map((v) => ({ key: v.key, label: v.label ?? (v.key.startsWith('raw:') ? v.key.slice(4) || 'Unknown vendor' : v.key), totalCents: v.totalCents, count: v.count })),
      byBranch: byBranch.map((b) => ({ key: b.key, label: b.key === 'tenant' ? 'Whole salon' : b.label ?? b.key, totalCents: b.totalCents, count: b.count })),
      series: series.map((p) => ({ key: p.key, totalCents: p.totalCents, count: p.count })), byPaymentMethod: byPayment,
      recurring, insights, counts, reconciles: sums.byCategory === totals.totalCents && sums.byVendor === totals.totalCents && sums.byBranch === totals.totalCents,
      basis: 'Approved expenses dated in the period (the salon\'s own calendar). Drafts, receipts waiting for review and voided expenses are not counted. Payroll from AI PowerSalon Payroll is not added here (§90) unless an owner recorded it as an expense.',
    };
  }

  /** P2-3 (Oct 23 2026): salon-wide costs on the report. One branch selected → that branch's computed share (its own
   *  direct total is unchanged: `totalCents` stays "expenses filed to this branch", `withSharedCents` adds the share).
   *  The whole salon → every branch's share, plus what no branch carries (policy NONE / no share), which sums back to
   *  the salon-wide total to the cent. Nothing is copied into new expense rows. */
  private async sharedCosts(tenantId: string, s: Scope, w: DateWindow, policy: SharedCostPolicy, shares: SharedCostShare[]) {
    const { expenses, splits } = await this.repo.salonWideExpenses(tenantId, w.from, w.to);
    const salonWideCents = expenses.reduce((t, e) => t + e.amountCents, 0);
    const names = await this.repo.branchNames(tenantId);
    const branchIds = [...new Set([...shares.map((x) => x.branchId), ...[...splits.values()].flat().map((a) => a.branchId)])];
    const perBranch = branchIds.map((id) => ({ branchId: id, label: names.get(id) ?? id, ...branchShareOfSalonWide(expenses, splits, policy, shares, id) }));
    const allocated = perBranch.reduce((t, b) => t + b.allocatedCents, 0);
    const mine = s.branchId ? perBranch.find((b) => b.branchId === s.branchId) ?? { branchId: s.branchId, label: names.get(s.branchId) ?? s.branchId, allocatedCents: 0, expenseCount: 0, byOwnSplitCents: 0, byPolicyCents: 0 } : null;
    return {
      policy, salonWideCents, salonWideCount: expenses.length,
      ...(mine ? { branch: mine } : { perBranch, unallocatedCents: salonWideCents - allocated }),
      reconciles: allocated <= salonWideCents,
      basis: policy === 'NONE' ? 'Salon-wide costs are not split across branches (the salon\'s choice); an expense split by hand still shows its split.' : 'Salon-wide costs split by the salon\'s branch shares, to the cent; an expense split by hand keeps its own split.',
    };
  }

  async vendorSpend(ctx: FinanceCtx, vendorId: string, branchId?: string | null) {
    this.require(ctx, PERM.view);
    const s = await this.scope(ctx, branchId);
    const today = await this.today(ctx.tenantId);
    const [m, y] = [periodWindow('month', today), periodWindow('year', today)];
    const one = async (w: DateWindow) => (await sql<{ t: string; c: string; cat: string | null }>`SELECT COALESCE(SUM(e.amount_cents),0)::text AS t, count(*)::text AS c,
        mode() WITHIN GROUP (ORDER BY e.category) AS cat FROM expenses e WHERE e.tenant_id = ${s.tenantId} AND e.vendor_id = ${vendorId} AND e.status = 'approved'
        AND e.incurred_on BETWEEN ${w.from} AND ${w.to} ${s.branchId ? sql`AND e.branch_id = ${s.branchId}` : s.allowed ? sql`AND e.branch_id IN (${sql.join(s.allowed)})` : sql``}`.execute(this.db)).rows[0];
    const [mm, yy] = await Promise.all([one(m), one(y)]);
    return { vendorId, thisMonthCents: Number(mm?.t ?? 0), thisYearCents: Number(yy?.t ?? 0), thisYearCount: Number(yy?.c ?? 0), mainCategory: yy?.cat ?? null };
  }

  // ── export (§97–100, §202) ─────────────────────────────────────────────────────────────────────────────────────────
  /** Accountant export preflight (Extras · Receipt Expense OCR 09): before an export, the same rows the export would
   *  write (same period, branch scope and filters), checked for duplicates, missing categories, missing receipts,
   *  unapproved records left out, and whether the rows reconcile to the counted total. Read-only; nothing is exported. */
  async exportPreflight(ctx: FinanceCtx, q: { period?: ReportPeriod; from?: string; to?: string; branchId?: string | null; includeUnapproved?: boolean; category?: string; paymentMethod?: string; q?: string }) {
    this.require(ctx, PERM.export);
    const s = await this.scope(ctx, q.branchId);
    const today = await this.today(ctx.tenantId);
    let w: DateWindow;
    try { w = periodWindow(q.period ?? 'month', today, { from: q.from, to: q.to }); } catch (e) { throw new ExpenseError('EXPENSE_INVALID', (e as Error).message); }
    const fold = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
    const words = q.q?.trim() ? fold(q.q.trim()) : '';
    const keep = (e: { category: string | null; paymentMethod: string | null; vendorName?: string | null; vendor: string | null; description: string | null; invoiceNumber: string | null; receiptNumber?: string | null }) =>
      (!q.category || e.category === q.category) && (!q.paymentMethod || e.paymentMethod === q.paymentMethod)
      && (!words || [e.vendorName, e.vendor, e.description, e.invoiceNumber, e.receiptNumber].some((x) => fold(x).includes(words)));
    const [rowsAll, everyStatus, counted] = await Promise.all([this.repo.exportRows(s, w.from, w.to, !!q.includeUnapproved), this.repo.exportRows(s, w.from, w.to, true), this.repo.totals(s, w.from, w.to)]);
    const rows = rowsAll.filter(keep);
    const totalCents = rows.reduce((a, e) => a + e.amountCents, 0);
    const filtered = !!(q.category || q.paymentMethod || words);
    return {
      period: { from: w.from, to: w.to }, branchScope: (s.branchId ? 'branch' : 'all_allowed') as 'branch' | 'all_allowed', branchName: s.branchId ? (rows.find((e) => e.branchId === s.branchId)?.branchName ?? null) : null,
      rows: rows.length, totalCents, filtered, includeUnapproved: !!q.includeUnapproved,
      duplicates: rows.filter((e) => e.duplicateStatus === 'possible' || e.duplicateStatus === 'exact').length,
      uncategorized: rows.filter((e) => !e.category).length,
      missingReceipts: rows.filter((e) => !e.hasReceipt).length,
      unapprovedLeftOut: q.includeUnapproved ? 0 : everyStatus.filter(keep).filter((e) => e.status !== 'approved').length,
      countedTotalCents: counted.totalCents,
      // the rows reconcile to the counted total only when the export is the plain approved set (no filters, no drafts)
      reconciles: filtered || q.includeUnapproved ? null : totalCents === counted.totalCents,
      // extras Expenses 09 (round 10): the file's columns in order, which free-text columns are formula-protected, and that
      // the file carries no customer contact data (expenses hold vendors, never clients) — shown before anything is generated
      columns: [...EXPORT_COLUMN_KEYS], formulaSafeColumns: [...EXPORT_FORMULA_SAFE_KEYS], customerContactColumns: [] as string[],
    };
  }

  async exportFile(ctx: FinanceCtx, q: { format: 'csv' | 'xlsx' | 'pdf'; period?: ReportPeriod; from?: string; to?: string; branchId?: string | null; includeUnapproved?: boolean; category?: string; paymentMethod?: string; q?: string }) {
    this.require(ctx, PERM.export);
    const s = await this.scope(ctx, q.branchId);
    const today = await this.today(ctx.tenantId);
    let w: DateWindow;
    try { w = periodWindow(q.period ?? 'month', today, { from: q.from, to: q.to }); } catch (e) { throw new ExpenseError('EXPENSE_INVALID', (e as Error).message); }
    const [all, { custom, codes }] = await Promise.all([this.repo.exportRows(s, w.from, w.to, !!q.includeUnapproved), this.validKeys(ctx.tenantId)]);
    // Expenses guide (Nov 4 2026): the export honours the screen's active filters too (category, method, search words)
    const fold = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
    const words = q.q?.trim() ? fold(q.q.trim()) : '';
    const rows = all.filter((e) => (!q.category || e.category === q.category) && (!q.paymentMethod || e.paymentMethod === q.paymentMethod)
      && (!words || [e.vendorName, e.vendor, e.description, e.invoiceNumber, e.receiptNumber].some((x) => fold(x).includes(words))));
    const out: ExportRow[] = rows.map((e) => ({ date: e.incurredOn, vendor: e.vendorName ?? e.vendor ?? '', category: categoryLabel(e.category, custom), accountingCode: codes.get(e.category) ?? '', branch: e.branchName ?? (e.branchId ? '' : 'Whole salon'),
      description: e.description ?? '', subtotalCents: e.subtotalCents, taxCents: e.taxCents, totalCents: e.amountCents, paymentMethod: e.paymentMethod ?? '', receiptNumber: e.receiptNumber ?? '',
      invoiceNumber: e.invoiceNumber ?? '', receiptAttached: e.hasReceipt, status: e.status }));
    // §102: through the accounting export port (format adapters registered in expense-export.ts)
    const adapter = ACCOUNTING_EXPORT_ADAPTERS.get(q.format);
    if (!adapter) throw new ExpenseError('EXPENSE_INVALID', `Unknown export format: ${q.format}`);
    const name = `expenses-${w.from}-to-${w.to}.${adapter.extension}`;
    const bytes = await adapter.render(out, { title: 'Expenses', period: `${w.from} to ${w.to}` });
    await this.auditLog(ctx, 'expenses_exported', { id: ctx.tenantId, branchId: s.branchId }, { severity: 'warning', metadata: { format: q.format, from: w.from, to: w.to, rows: out.length, totalCents: exportTotalCents(out), branchId: s.branchId } });
    return { filename: name, contentType: adapter.contentType, bytes, rows: out.length, totalCents: exportTotalCents(out) };
  }

  // ── CSV import of historical expenses (§140) ─────────────────────────────────────────────────────────────────────
  async importRows(ctx: FinanceCtx, rows: Array<{ date?: string; vendor?: string; amount?: string | number; category?: string; branch?: string; description?: string }>, opts: { dryRun?: boolean } = {}) {
    this.require(ctx, PERM.manage); this.require(ctx, PERM.approve);
    if (rows.length > 2000) throw new ExpenseError('EXPENSE_INVALID', 'Import up to 2,000 rows at a time.');
    const { keys } = await this.validKeys(ctx.tenantId);
    const branches = (await sql<{ id: string; name: string }>`SELECT id, name FROM branches WHERE tenant_id = ${ctx.tenantId}`.execute(this.db)).rows;
    const accepted: number[] = []; const rejected: Array<{ row: number; reason: string }> = []; let created = 0;
    const seen = new Map<string, number>();   // content → how many times it occurred so far in THIS file
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const date = String(r.date ?? '').trim(); const vendor = trimTo(r.vendor, 200);
      const cents = typeof r.amount === 'number' ? Math.round(r.amount * 100) : (() => { const s = String(r.amount ?? '').replace(/[$,\s]/g, ''); return /^\d+(\.\d{1,2})?$/.test(s) ? Math.round(Number(s) * 100) : NaN; })();
      const cat = normalizeCategory(r.category ?? '', keys);
      const br = r.branch ? branches.find((b) => b.name.toLowerCase() === String(r.branch).trim().toLowerCase() || b.id === r.branch) : null;
      if (!isYmd(date)) { rejected.push({ row: i + 1, reason: 'date must be YYYY-MM-DD' }); continue; }
      if (!vendor) { rejected.push({ row: i + 1, reason: 'vendor is required' }); continue; }
      if (!Number.isInteger(cents) || cents < 0) { rejected.push({ row: i + 1, reason: 'amount is not a valid number' }); continue; }
      if (!cat) { rejected.push({ row: i + 1, reason: `unknown category "${r.category ?? ''}"` }); continue; }
      if (r.branch && !br) { rejected.push({ row: i + 1, reason: `unknown branch "${r.branch}"` }); continue; }
      accepted.push(i + 1);
      if (opts.dryRun) continue;
      try {
        // Oct 28 2026 (Receipt mandate audit F4, §48 / §49 / §140): the import used to send duplicateOverrideReason 'historical
        // import' on EVERY row — a row duplicating an expense already recorded (from a receipt, say) was saved "overridden"
        // and APPROVED: counted twice, nobody asked. Now the real duplicate check runs: a suspected duplicate is saved for
        // review (flagged), never approved on the way in. And the key ended in the row index — re-importing the same file
        // reordered created everything again; now it is the row's CONTENT plus which occurrence of that content it is in the
        // file (two identical purchases on one day stay two; the same file twice, in any order, is the same rows).
        const content = `${date}:${vendor.toLowerCase()}:${cents}:${cat}:${br?.id ?? ''}`;
        const nth = (seen.get(content) ?? 0) + 1; seen.set(content, nth);
        const key = `import:${content}:${nth}`;
        const res = await this.create(ctx, { category: cat, amountCents: cents, incurredOn: date, vendor, description: trimTo(r.description, 1000), branchId: br?.id ?? null, intent: 'approve', idempotencyKey: key }, { source: 'import' });
        if (res.created) created++;
      } catch (e) { accepted.pop(); rejected.push({ row: i + 1, reason: e instanceof ExpenseError ? e.message : 'could not be saved' }); }
    }
    return { accepted: accepted.length, created, rejected, dryRun: !!opts.dryRun };
  }

  /** the Owner App's P&L total (OwnerService.getFinanceSummary) reads THIS — approved expenses only (§108) */
  async approvedTotalCents(tenantId: string, scope: { branchId: string | null; allowed: string[] | null }, from: string, to: string) {
    return (await this.repo.totals({ tenantId, ...scope }, from, to)).totalCents;
  }
}
