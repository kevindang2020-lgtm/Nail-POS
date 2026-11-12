// expense.list-queries.ts — the declared filters, search and date-range cap of the expense list (Constitution 5 §47–52).
import type { ListQuerySpec } from '@aipowersalon/database';

export const ExpenseControllerListQueries = {
  list: {
    filters: { tab: { type: 'text' }, category: { type: 'text' }, vendorId: { type: 'id' }, status: { type: 'text' }, paymentMethod: { type: 'text' }, branchId: { type: 'id' }, period: { type: 'text' }, minCents: { type: 'text' }, maxCents: { type: 'text' } },
    search: { params: ['q'] },
    // the handler orders by these itself (expense.repository: created = newest added first, date = expense date, amount)
    sorts: { created: null, date: null, amount: null },
  },
  summary: {
    filters: { category: { type: 'text' }, paymentMethod: { type: 'text' }, branchId: { type: 'id' }, period: { type: 'text' } },
    search: { params: ['q'] },
  },
  // Bill due calendar (Extras · Receipt Expense OCR 06): the window in days (1–90) and the branch
  billsDue: { filters: { days: { type: 'int', min: 1, max: 90 }, branchId: { type: 'id' } } },
  // Accountant export preflight (Extras · Receipt Expense OCR 09): the SAME filters as the export it checks
  exportPreflight: {
    filters: { period: { type: 'text' }, branchId: { type: 'id' }, includeUnapproved: { type: 'text' }, category: { type: 'text' }, paymentMethod: { type: 'text' } },
    search: { params: ['q'] },
    dateRange: { maxDays: 'analytics' },
  },
} satisfies Record<string, ListQuerySpec>;
