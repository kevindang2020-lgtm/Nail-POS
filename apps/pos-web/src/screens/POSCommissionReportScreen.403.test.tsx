import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { cm } = vi.hoisted(() => ({ cm: { summary: vi.fn(), technicians: vi.fn(), payouts: vi.fn(), lines: vi.fn(), tips: vi.fn(), adjustments: vi.fn(), exportCsv: vi.fn(), exportHistory: vi.fn() } }));
vi.mock('../api/posTeamScreensApi', () => ({ posCommissionScreenApi: cm, posCommissionReviewApi: { list: vi.fn(async () => { throw { status: 403 }; }) } }));
vi.mock('../api/posCommissionReportApi', () => ({ posCommissionReportApi: { state: vi.fn(async () => null) } }));
import { POSCommissionReportScreen } from './POSCommissionReportScreen';
describe('Commission report permissions', () => {
  it('shows a permission message on 403', async () => {
    for (const f of Object.values(cm)) f.mockRejectedValue({ status: 403 });
    render(<POSCommissionReportScreen />);
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
  });
});
