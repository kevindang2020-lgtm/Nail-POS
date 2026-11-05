import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const { reconMock } = vi.hoisted(() => ({ reconMock: vi.fn() }));
vi.mock('../api/posPaymentsApi', () => ({ posPaymentsApi: { overview: vi.fn(), reconciliation: reconMock } }));
import { POSSettlementsScreen } from './POSSettlementsScreen';

describe('POSSettlementsScreen — permissions', () => {
  it('shows a permission message on 403', async () => {
    reconMock.mockRejectedValue({ status: 403 });
    render(<POSSettlementsScreen />);
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
  });
});
