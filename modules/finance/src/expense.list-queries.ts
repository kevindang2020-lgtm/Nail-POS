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
} satisfies Record<string, ListQuerySpec>;
