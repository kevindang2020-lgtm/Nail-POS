import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ kpis: vi.fn(), bankAccounts: vi.fn(), settlements: vi.fn(), deposits: vi.fn(), search: vi.fn() }));
vi.mock('../api/posDepositReconApi', () => ({ posDepositReconApi: api }));
vi.mock('../components/usePermissions', () => ({ useCan: () => () => false }));
vi.mock('./access/accessUi', () => ({ useStepUp: () => ({ run: (fn: () => Promise<unknown>) => fn(), prompt: null }), isStepUpCancelled: () => false }));
import { POSDepositReconScreen } from './POSDepositReconScreen';

describe('POSDepositReconScreen — permissions', () => {
  it('a 403 shows an access message; Record a Deposit is not offered', async () => {
    for (const f of Object.values(api)) f.mockRejectedValue({ status: 403 });
    render(<MemoryRouter><POSDepositReconScreen /></MemoryRouter>);
    expect((await screen.findAllByText('Your role cannot see this information.')).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('record-deposit')).toBeNull();
    expect(screen.queryByText(/\$\d/)).toBeNull();
  });
});
