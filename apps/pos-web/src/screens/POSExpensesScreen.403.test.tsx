import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { expensesMock, kpisMock, catsMock } = vi.hoisted(() => ({ expensesMock: vi.fn(), kpisMock: vi.fn(), catsMock: vi.fn() }));
vi.mock('../api/posExpensesApi', () => ({ posExpensesApi: { expenses: expensesMock, kpis: kpisMock, categories: catsMock, report: vi.fn() }, saveExportFile: vi.fn() }));
vi.mock('../api/posAiOcrReceiptApi', () => ({ posAiOcrReceiptApi: { upload: vi.fn() } }));
import { POSExpensesScreen } from './POSExpensesScreen';
describe('Expenses permissions', () => {
  it('a 403 is the role message (never a false $0.00)', async () => {
    for (const m of [expensesMock, kpisMock, catsMock]) m.mockRejectedValue({ status: 403 });
    render(<MemoryRouter><POSExpensesScreen /></MemoryRouter>);
    expect((await screen.findAllByText(/your role cannot see this information/i)).length).toBeGreaterThan(0);
    expect(screen.queryByText('$0.00')).toBeNull();
  });
});
