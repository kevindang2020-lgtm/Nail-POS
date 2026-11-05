import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { expensesMock, dashMock, reportMock, catsMock } = vi.hoisted(() => ({ expensesMock: vi.fn(), dashMock: vi.fn(), reportMock: vi.fn(), catsMock: vi.fn() }));
vi.mock('../api/posExpensesApi', () => ({ posExpensesApi: { expenses: expensesMock, dashboard: dashMock, report: reportMock, categories: catsMock }, saveExportFile: vi.fn() }));
vi.mock('../api/posAiOcrReceiptApi', () => ({ posAiOcrReceiptApi: { upload: vi.fn() } }));
import { POSExpensesScreen } from './POSExpensesScreen';
describe('Expenses permissions', () => {
  it('shows a permission message on 403', async () => {
    for (const m of [expensesMock, dashMock, reportMock, catsMock]) m.mockRejectedValue({ status: 403 });
    render(<MemoryRouter><POSExpensesScreen /></MemoryRouter>);
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
  });
});
