// finance.ts — the Receipt / Expense / OCR / Accounting mandate's wire shapes (Oct 21 2026): /owner/finance/* as the POS
// "Receipts & Expenses" screen and the Owner App see it. Money is integer cents; dates are YYYY-MM-DD in the salon's own
// calendar. A status never moves through a field — only through its own route (submit / approve / reject / void …).

export type FinanceExpenseStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'voided';
export type FinanceExpenseKind = 'expense' | 'bill';
export type FinanceInboxTab = 'inbox' | 'needs_review' | 'approved' | 'bills' | 'duplicates' | 'archived' | 'reimbursements' | 'voided' | 'all';
export type FinancePaymentMethod = 'business_card' | 'cash' | 'check' | 'ach' | 'bank_transfer' | 'personal_card' | 'other';
export type FinanceReportPeriod = 'today' | 'week' | 'month' | 'year' | 'last_month' | 'last_year' | 'custom';

/** One expense (or bill) as every finance route returns it. */
export interface FinanceExpense {
  id: string; branchId: string | null; kind: string; status: string;
  /** §62/§63 (Oct 27 2026): the payment / bank transaction behind the expense — null = never looked for */
  paymentMatchStatus?: 'matched' | 'possible_match' | 'unmatched' | null; matchedPaymentRef?: string | null; paymentMatchReason?: string | null;
  category: string; categoryLabel: string; categorySource: string;
  amountCents: number; subtotalCents: number | null; taxCents: number | null; tipCents: number | null; feeCents: number | null; discountCents: number | null;
  vendor: string | null; vendorId: string | null; vendorDisplay: string | null; description: string | null; incurredOn: string;
  paymentMethod: string | null; cardBrand: string | null; cardLast4: string | null;
  receiptNumber: string | null; invoiceNumber: string | null; receiptDocumentId: string | null;
  dueDate: string | null; billStatus: string | null; billDue: string | null; paidCents: number; openCents: number;
  reimbursementStatus: string; duplicateStatus: string; source: string; taxReviewStatus: string; accountantNote: string | null;
  extractionConfidence: number | null; reviewFlags: string[]; archivedAt: string | null; voidReason: string | null; rejectedReason: string | null;
  createdAt: string; updatedAt: string; version: number;
}
export interface FinanceExpensePage { items: FinanceExpense[]; total: number; page: number; pageSize: number }
/** GET expenses/summary (Expenses guide, Nov 4 2026) — the four KPIs over the whole filtered set (approved expenses only) and the
 *  period the server resolved in the salon's time zone. */
export interface FinanceExpenseSummary {
  period: { preset: 'today' | 'week' | 'month' | 'year' | 'custom' | 'all'; from: string | null; to: string | null; tz: string; today: string };
  totalCents: number; entries: number; categoriesUsed: number;
  topCategory: { key: string; label: string; totalCents: number } | null;
}
export interface FinanceDuplicateMatch { id: string; status: 'exact' | 'possible'; reason: string }
export interface FinanceDuplicateResult { status: 'exact' | 'possible' | 'none'; matches: FinanceDuplicateMatch[] }
/** GET expenses/:id — the expense with its lines, branch split, documents, bill payments, history and duplicate matches. */
export interface FinanceExpenseDetail { expense: FinanceExpense; lineItems: unknown[]; allocations: unknown[]; documents: unknown[]; billPayments: unknown[]; history: unknown[]; duplicates: FinanceDuplicateResult }
/** POST expenses (and the actions that change one): the expense as it now stands. */
export interface FinanceExpenseResult { expense: FinanceExpense }
export interface FinanceExpenseCreateResult extends FinanceExpenseResult { duplicate: FinanceDuplicateResult; created: boolean }
export interface FinanceArchiveResult extends FinanceExpenseResult { changed: boolean }
export interface FinanceDeleteResult { id: string; deleted: boolean }
export interface FinanceAttachResult { expenseId: string; documentId: string; role: 'receipt' | 'invoice' | 'supporting' | 'replacement' }

export interface FinanceLineItemInput { description: string; quantity?: number | null; unitPriceCents?: number | null; totalCents: number; categoryKey?: string | null; confidence?: number | null }
export interface FinanceAllocationInput { branchId: string; amountCents?: number | null; basisPoints?: number | null }
interface FinanceExpenseFields {
  kind?: FinanceExpenseKind | null; category?: string | null; amountCents?: number | null; subtotalCents?: number | null; taxCents?: number | null; tipCents?: number | null; feeCents?: number | null; discountCents?: number | null;
  incurredOn?: string | null; vendor?: string | null; vendorId?: string | null; description?: string | null; branchId?: string | null; paymentMethod?: FinancePaymentMethod | null;
  cardBrand?: string | null; cardLast4?: string | null; receiptNumber?: string | null; invoiceNumber?: string | null; referenceNumber?: string | null; dueDate?: string | null;
  recurring?: boolean | null; reimburse?: boolean | null; lineItems?: FinanceLineItemInput[] | null; allocations?: FinanceAllocationInput[] | null;
  receiptDocumentId?: string | null; accountantNote?: string | null; taxReviewStatus?: 'not_reviewed' | 'reviewed' | 'question' | null;
}
/** POST expenses — intent: draft (keep), submit (send for review) or approve (needs owner.expenses.approve). */
export interface FinanceExpenseCreateRequest extends FinanceExpenseFields { amountCents: number; incurredOn: string; intent?: 'draft' | 'submit' | 'approve' | null; duplicateOverrideReason?: string | null; idempotencyKey?: string | null }
/** PATCH expenses/:id — version is the one the editor saw; a correction to an approved expense needs a reason. */
export interface FinanceExpenseUpdateRequest extends FinanceExpenseFields { version: number; reason?: string | null }
export interface FinanceVersionRequest { version?: number | null }
export interface FinanceReasonRequest { reason: string; version?: number | null }
export interface FinanceDuplicateDecisionRequest { decision: 'not_duplicate' | 'duplicate'; reason: string }
export interface FinanceBillPaymentRequest { amountCents: number; paidOn?: string | null; paymentMethod?: FinancePaymentMethod | null; reference?: string | null; idempotencyKey?: string | null }
export interface FinanceReimbursementRequest { action: 'request' | 'approve' | 'pay' | 'reject' | 'cancel'; reason?: string | null }
export interface FinanceAttachRequest { documentId: string; role?: 'receipt' | 'invoice' | 'supporting' | 'replacement' | null }
export interface FinanceIdsRequest { ids: string[]; categoryKey?: string | null; threshold?: number | null }
/** batch approve → { approved, exceptions }; batch categorize → { updated, skipped } */
export interface FinanceBatchResult { approved?: string[]; exceptions?: Array<{ id: string; reason: string }>; updated?: string[]; skipped?: Array<{ id: string; reason: string }> }
export interface FinanceDuplicateCheckRequest { vendor?: string | null; vendorId?: string | null; incurredOn: string; amountCents: number; invoiceNumber?: string | null; receiptNumber?: string | null; excludeId?: string | null }
export interface FinanceRecommendRequest { vendor?: string | null; lines?: string[] | null }
export interface FinanceCategoryRecommendation { key: string; source: string; reason: string; confidence: number }
export interface FinanceImportRow { date?: string | null; vendor?: string | null; amount?: string | number | null; category?: string | null; branch?: string | null; description?: string | null }
export interface FinanceImportRequest { rows: FinanceImportRow[]; dryRun?: boolean | null }
export interface FinanceImportResult { accepted: number; created: number; rejected: Array<{ row: number; reason: string }>; dryRun: boolean }

export interface FinanceCategory { key: string; label: string; isDefault: boolean; accountingCode: string | null; active: boolean; sortOrder: number }
export interface FinanceCategoryList { categories: FinanceCategory[] }
export interface FinanceCategoryRequest { label?: string | null; accountingCode?: string | null; active?: boolean | null }
export interface FinanceCategoryResult { key: string; label?: string }
export interface FinanceRule { id: string; vendorNorm: string; vendorId: string | null; keyword: string | null; categoryKey: string; kind: 'owner_lock' | 'learned'; hitCount: number; active: boolean }
export interface FinanceRuleList { rules: FinanceRule[] }
export interface FinanceRuleRequest { vendor: string; categoryKey: string; keyword?: string | null; vendorId?: string | null }
export interface FinanceRuleResult { id: string; [k: string]: unknown }
export interface FinanceSettings {
  requireApproval: boolean; autoReady: boolean; autoCategory: boolean; learnFromCorrections: boolean; duplicateDetection: boolean;
  billReminderDays: number; defaultBranchId: string | null; receptionistUpload: boolean; technicianUpload: boolean; version: number;
  /** P2-3 (Oct 23 2026): how salon-wide costs show on one branch's report — NONE (default) or the owner's shares (100% = 10 000) */
  sharedCostPolicy: 'NONE' | 'MANUAL_PERCENTAGE'; sharedCostShares: Array<{ branchId: string; basisPoints: number }>;
  /** §65 (Oct 27 2026): branches holding a share that are now closed / removed — the owner moves their percentage (read-only) */
  sharedCostSharesNeedReview?: string[];
  /** §177 (Oct 27 2026): what the owner is told about (in-app; push / SMS / e-mail follow the platform's providers) */
  notifyNeedsReview: boolean; notifyBillDue: boolean; notifyDuplicate: boolean; notifyWeeklySummary: boolean; notifyMonthlySummary: boolean;
  /** §178/§179: the last completed week (its Monday) / month (YYYY-MM) summarised — read-only */
  weeklySummarySentFor: string | null; monthlySummarySentFor: string | null;
  /** §83: the owner's low-risk auto-approval rules — a trusted vendor (normalised name) at or under a threshold, optionally one category */
  autoApprovalRules: FinanceAutoApprovalRule[];
}
export interface FinanceAutoApprovalRule { vendorNorm: string; maxCents: number; categoryKey?: string | null; enabled?: boolean }
export type FinanceSettingsRequest = Partial<Omit<FinanceSettings, 'autoApprovalRules' | 'weeklySummarySentFor' | 'monthlySummarySentFor' | 'sharedCostSharesNeedReview'>> & { autoApprovalRules?: Array<{ vendor: string; maxCents: number; categoryKey?: string | null; enabled?: boolean }> | null };
/** §62/§63: MATCHED / POSSIBLE_MATCH / UNMATCHED — never a fabricated link */
export type FinanceMatchVerdict = 'matched' | 'possible_match' | 'unmatched';
export interface FinancePaymentMatch { expenseId: string; verdict: FinanceMatchVerdict; paymentId: string | null; reason: string | null; candidates: number }
export interface FinancePaymentLinkRequest { decision: 'confirm' | 'clear'; paymentRef?: string | null; version?: number | null }
/** §142: the existing expense a receipt could be the evidence for (a person links it; an uncertain match is never auto-linked) */
export interface FinanceReceiptSuggestion { verdict: FinanceMatchVerdict; expenseId: string | null; reason: string | null; candidates: Array<{ expenseId: string; score: number; reasons: string[] }> }

export interface FinanceDashboard {
  today: string; thisMonthCents: number; thisYearCents: number; todayCents: number; todayCount: number; receiptsUploadedToday: number;
  needsReview: number; drafts: number; possibleDuplicates: number; billsDue: number; billsOverdue: number; billsOpenCents: number; reimbursementsOpen: number; createdToday: number;
}
export interface FinanceBreakdownRow { key: string; label: string; totalCents: number; count: number }
export interface FinanceReport {
  period: string; window: { from: string; to: string }; previousWindow: { from: string; to: string };
  totalCents: number; count: number; previousTotalCents: number; changePct: number | null;
  byCategory: Array<FinanceBreakdownRow & { previousCents: number; changePct: number | null }>;
  byVendor: FinanceBreakdownRow[]; byBranch: FinanceBreakdownRow[]; series: Array<{ key: string; totalCents: number; count: number }>;
  insights: string[]; reconciles: boolean; basis: string;
  /** P2-3: salon-wide costs — one branch's computed share (`branch`), or every branch's share + the unallocated rest */
  sharedCosts: FinanceSharedCosts;
}
export interface FinanceSharedCostShare { branchId: string; label: string; allocatedCents: number; expenseCount: number; byOwnSplitCents: number; byPolicyCents: number }
export interface FinanceSharedCosts { policy: 'NONE' | 'MANUAL_PERCENTAGE'; salonWideCents: number; salonWideCount: number; branch?: FinanceSharedCostShare; perBranch?: FinanceSharedCostShare[]; unallocatedCents?: number; reconciles: boolean; basis: string }
/** GET expenses/export — the file, base64 (an @AsyncExport: a large export answers 202 and is fetched when ready). */
export interface FinanceExportPayload { filename: string; contentType: string; encoding: 'base64'; content: string; rowCount: number; totalCents: number }
export interface FinanceVendorSpend { vendorId: string; thisMonthCents: number; thisYearCents: number; thisYearCount: number; mainCategory: string | null }

/** POST /pos/ai-ocr-receipt/documents/:id/post and /retry-post (M3, Oct 23 2026): an approved receipt booked once —
 *  idempotent per document + posting version (a retry answers the same record, never a second expense). */
export interface OcrPostingResult { idempotencyKey: string; status: 'posted' | 'failed'; externalRef: string | null; errorCode?: string | null }
/** §25/§26 (Oct 27 2026): the pre-OCR quality verdict — advice for "Retake / Process anyway", never a rejection */
export interface OcrQualityVerdict { flags: string[]; difficult: boolean }
/** POST /pos/ai-ocr-receipt/upload */
export interface OcrUploadResult { documentId: string; pipelineState: string; quality: OcrQualityVerdict; thumbnailKey: string | null; pageCount: number }
/** §17/§18: POST /pos/ai-ocr-receipt/documents/{id}/pages — one more page under the SAME document */
export interface OcrPageAppendResult { documentId: string; pageCount: number; pipelineState: string; quality: OcrQualityVerdict }
/** POST …/extract and …/retry-extract (§115: a person restarts the ladder of a reading that gave up) */
export interface OcrExtractionResult { pipelineState: string; providerKey: string | null; unavailable: boolean }

