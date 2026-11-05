import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { listMock, createMock, getMock } = vi.hoisted(() => ({ listMock: vi.fn(), createMock: vi.fn(), getMock: vi.fn() }));
vi.mock('../api/posAiBusinessApi', () => ({ posAiBusinessApi: { reportsList: listMock, reportCreate: createMock, reportGet: getMock } }));
import { POSAiReportsScreen } from './POSAiReportsScreen';

const completed = (o: any = {}) => ({ id: 'rj1', reportType: 'monthly_review', preset: 'month', status: 'completed', content: { revenue: { available: true, netSalesCents: 84200 }, appointments: { funnel: { completed: 30 } }, customers: { newCustomers: 12 }, branches: { branches: [{}, {}] } }, error: null, createdAt: '2026-07-01', completedAt: '2026-07-01T10:00:00Z', expiresAt: '2026-07-08', expired: false, ...o });

beforeEach(() => {
  listMock.mockReset().mockResolvedValue([]);
  createMock.mockReset();
  getMock.mockReset();
});

describe('POSAiReportsScreen', () => {
  it('generates a report and shows its headline numbers', async () => {
    const job = completed();
    createMock.mockResolvedValue(job);
    listMock.mockResolvedValueOnce([]).mockResolvedValue([job]); // empty on mount, then the created job
    render(<POSAiReportsScreen />);
    await screen.findByText(/No reports yet/);
    fireEvent.click(screen.getByText('Monthly review'));
    await waitFor(() => expect(createMock).toHaveBeenCalledWith('monthly_review'));
    // The created job is open by default → headline numbers render
    expect(await screen.findByText('$842.00')).toBeInTheDocument();
    expect(screen.getByText('Completed appts')).toBeInTheDocument();
  });

  it('lists a failed report with its error', async () => {
    listMock.mockResolvedValue([completed({ id: 'rj2', status: 'failed', content: null, error: 'You do not have permission to generate this report.' })]);
    render(<POSAiReportsScreen />);
    expect(await screen.findByText('Failed')).toBeInTheDocument();
    expect(screen.getByText(/do not have permission/i)).toBeInTheDocument();
  });

  it('shows a permission message on 403', async () => {
    listMock.mockRejectedValue({ status: 403 });
    render(<POSAiReportsScreen />);
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
  });
});
