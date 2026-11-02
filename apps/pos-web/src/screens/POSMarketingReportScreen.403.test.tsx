import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { stateMock } = vi.hoisted(() => ({ stateMock: vi.fn() }));
vi.mock('../api/posMarketingReportApi', () => ({ posMarketingReportApi: { state: stateMock } }));
import { POSMarketingReportScreen } from './POSMarketingReportScreen';
describe('Marketing report permissions', () => {
  it('shows a permission message on 403', async () => { stateMock.mockRejectedValue({ status: 403 }); render(<MemoryRouter><POSMarketingReportScreen /></MemoryRouter>); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
