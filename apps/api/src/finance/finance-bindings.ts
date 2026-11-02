// finance-bindings.ts — the finance module's port bindings as plain functions (no Nest module graph), so the API's
// composition root (finance-wiring.ts) and the PGlite harnesses bind them the same way. See finance-wiring.ts for the map.
import { Logger } from '@nestjs/common';
import { ExpenseError, type ExpenseService, type FinanceCtx, type ExpenseInput } from '@aipowersalon/finance';
import type { OwnerService, OwnerExpensesPort, OwnerFinanceCtx } from '@aipowersalon/analytics';
import type { InventoryService, InvCtx, ReceiptExpenseWriter } from '@aipowersalon/inventory';
import type { AuditService } from '@aipowersalon/audit';

const wiringLog = new Logger('FinanceWiring');
/** finance speaks info / warning / critical; the audit trail low / medium / high / critical */
const SEVERITY = { info: 'low', warning: 'medium', critical: 'critical' } as const;
const ownerCtx = (c: FinanceCtx) => ({ tenantId: c.tenantId, userId: c.userId, role: c.role, permissions: c.permissions, selectedBranchId: c.selectedBranchId ?? undefined });

/** an OwnerError ('forbidden' | 'not_found' | 'invalid') → the finance vocabulary, so the finance routes answer 403/404 */
export function ownerToExpenseError(e: unknown): unknown {
  const x = e as { name?: string; code?: string; message?: string } | null;
  if (x?.name !== 'OwnerError') return e;
  if (x.code === 'forbidden') return new ExpenseError('EXPENSE_ACCESS_DENIED', x.message);
  if (x.code === 'not_found') return new ExpenseError('EXPENSE_ACCESS_DENIED', 'That branch is not available to you.');
  return new ExpenseError('EXPENSE_ACCESS_DENIED', x.message);
}

/** the scanned-receipt writer: a receptionist who can scan but not approve files the expense for review, never approved */
export function receiptWriterFor(svc: ExpenseService): ReceiptExpenseWriter {
  return {
    async createFromScan(ctx: InvCtx, x) {
      const canApprove = ctx.permissions.includes('owner.expenses.approve');
      const fctx: FinanceCtx = { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role, permissions: [...new Set([...ctx.permissions, 'owner.expenses.manage'])], selectedBranchId: ctx.branchId || null };
      const r = await svc.create(fctx, { amountCents: x.amountCents, incurredOn: x.incurredOn, vendor: x.vendor, category: x.category, description: x.description, branchId: ctx.branchId || null, intent: canApprove ? 'approve' : 'submit' }, { source: 'ocr' });
      return { id: r.expense.id, status: r.expense.status, category: r.expense.category, amountCents: r.expense.amountCents, vendor: r.expense.vendor, incurredOn: r.expense.incurredOn, duplicate: r.duplicate.status === 'none' ? null : r.duplicate };
    },
  };
}

/** ExpenseService seen through the Owner App's port (shapes are a superset; the adapter only narrows) */
export function ownerExpensesFor(svc: ExpenseService): OwnerExpensesPort {
  const f = (c: OwnerFinanceCtx): FinanceCtx => ({ ...c, selectedBranchId: c.selectedBranchId ?? null });
  return {
    list: (c, q) => svc.list(f(c), q),
    report: (c, q) => svc.report(f(c), q),
    create: (c, i) => svc.create(f(c), i as ExpenseInput),
    detail: (c, id) => svc.detail(f(c), id),
    update: (c, id, p) => svc.update(f(c), id, { ...(p as ExpenseInput), version: Number(p.version), reason: typeof p.reason === 'string' ? p.reason : null }),
    deleteDraft: (c, id) => svc.deleteDraft(f(c), id),
    void: (c, id, reason) => svc.void(f(c), id, reason),
  };
}

/** The bindings, as a plain function (the Nest provider below calls it; the harnesses call it with their own objects). */
export function bindFinancePorts(expenses: ExpenseService, owner: Pick<OwnerService, 'resolveBranchScope' | 'recordOwnerAudit' | 'expenses'>, inventory: Pick<InventoryService, 'createVendor' | 'receiptExpenses'> | null, audit: Pick<AuditService, 'record'> | null): void {
  expenses.bindBranchScope({
    async resolve(ctx, requested) {
      try { return await owner.resolveBranchScope(ownerCtx(ctx), requested ?? null); } catch (e) { throw ownerToExpenseError(e); }
    },
  });
  expenses.audit = {
    async record(ctx, e) {
      if (audit) await audit.record({ tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, userId: ctx.userId ?? null, role: ctx.role ?? null }, { ...e, severity: SEVERITY[e.severity ?? 'info'] });
      // the Owner App's Activity screen reads its own trail; mirror the headline so expense work shows there too
      if (ctx.userId) await owner.recordOwnerAudit({ tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role ?? 'OWNER', permissions: [] }, { action: e.action, entityType: e.resourceType ?? 'expense', entityId: e.resourceId ?? null, branchId: ctx.branchId ?? null, metadata: { summary: e.summary ?? null, reason: e.reason ?? null } }).catch((x: Error) => wiringLog.warn(`owner activity mirror failed: ${x.message}`));
      return null;
    },
  };
  if (inventory) {
    expenses.vendors = { async create(ctx, name) { return inventory.createVendor({ tenantId: ctx.tenantId, branchId: ctx.selectedBranchId ?? '', userId: ctx.userId, role: ctx.role, permissions: ctx.permissions }, { name }); } };
    inventory.receiptExpenses = receiptWriterFor(expenses);
  }
  owner.expenses = ownerExpensesFor(expenses);
}

