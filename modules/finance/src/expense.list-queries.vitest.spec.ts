// The Expenses list's declared sorts (SUNMI Expenses addendum §09 "working records", Nov 2026). The global
// ListQueryInterceptor refuses any `sort` a route does not declare; the screen's default "Newest added first" sends
// sort=created, which used to fail EVERY default load with 400 "created is not a sort order here".
import { describe, expect, it } from 'vitest';
import { assertListQuerySpec, parseListQuery, ListQueryError } from '@aipowersalon/database';
import { ExpenseControllerListQueries } from './expense.list-queries';

describe('expense list query spec', () => {
  it('is a valid spec', () => { expect(() => assertListQuerySpec(ExpenseControllerListQueries.list, 'expenses.list')).not.toThrow(); });
  it.each(['created', 'date', 'amount'])('accepts the screen sort "%s" (handler-ordered)', (sort) => {
    const p = parseListQuery({ sort, tab: 'all', page: '1', pageSize: '10' }, ExpenseControllerListQueries.list);
    expect(p.sort.map((s) => s.field)).toEqual([sort]);
    expect(p.sort[0].column).toBeNull();   // the repository orders it; the interceptor only allow-lists
  });
  it('still refuses an undeclared sort', () => {
    expect(() => parseListQuery({ sort: 'vendor_secret' }, ExpenseControllerListQueries.list)).toThrow(ListQueryError);
  });
});
