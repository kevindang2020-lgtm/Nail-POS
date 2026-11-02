import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { compareMock } = vi.hoisted(() => ({ compareMock: vi.fn() }));
vi.mock('../api/posAiBusinessApi', () => ({ posAiBusinessApi: { compareBranches: compareMock } }));
import { POSAiBranchCompareScreen } from './POSAiBranchCompareScreen';

describe('AI Branch Comparison permissions', () => {
  it('shows a permission message on 403', async () => {
    compareMock.mockRejectedValue({ status: 403 });
    render(<MemoryRouter><POSAiBranchCompareScreen /></MemoryRouter>);
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
  });
});
