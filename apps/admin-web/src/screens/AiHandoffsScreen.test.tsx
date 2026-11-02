import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockHandoffs } = vi.hoisted(() => ({ mockHandoffs: vi.fn() }));
vi.mock('../api/superAdminBookingCheckinApi', () => ({ superAdminBookingCheckinApi: { aiHandoffs: (q: any) => mockHandoffs(q) } }));

import AiHandoffsScreen from './AiHandoffsScreen';

const ho = (i: number, over: Partial<any> = {}) => ({
  id: `h${i}`, callCode: `CALL-770${i}`, branch: 'Downtown', transferredTo: 'front_desk', reason: 'complex_request',
  status: 'completed', requestedAt: '2026-06-30T14:31:00Z', connectedAt: '2026-06-30T14:32:00Z', waitSeconds: 60,
  failureReason: '—', bookingResult: 'booked', ...over,
});
const pageResp = (rows: any[], total = rows.length, page = 1, pageSize = 25) => ({ ok: true, scope: { tenantId: null, branchId: null, label: 'All tenants' }, range: { start: '', endInclusive: '' }, page, pageSize, total, rows });
const renderScreen = () => render(<MemoryRouter initialEntries={['/booking-checkin/ai-handoffs']}><AiHandoffsScreen /></MemoryRouter>);
beforeEach(() => { mockHandoffs.mockReset(); });

describe('AiHandoffsScreen', () => {
  it('renders handoff rows', async () => {
    mockHandoffs.mockResolvedValue(pageResp([ho(1), ho(2, { transferredTo: 'stylist', callCode: 'CALL-7702' })]));
    renderScreen();
    await waitFor(() => expect(screen.getByText('CALL-7701')).toBeInTheDocument());
    expect(screen.getByText('CALL-7702')).toBeInTheDocument();
    expect(screen.getByText('2 handoffs')).toBeInTheDocument();
  });

  it('opens a detail drawer with no transcript fields', async () => {
    mockHandoffs.mockResolvedValue(pageResp([ho(1)]));
    renderScreen();
    await waitFor(() => expect(screen.getByText('CALL-7701')).toBeInTheDocument());
    fireEvent.click(screen.getByText('CALL-7701'));
    await waitFor(() => expect(screen.getByText('Booking Result')).toBeInTheDocument());
    expect(screen.getByText('Wait')).toBeInTheDocument();
    expect(screen.getByText(/not exposed here/)).toBeInTheDocument();
  });

  it('re-queries on destination filter change', async () => {
    mockHandoffs.mockResolvedValue(pageResp([ho(1)]));
    renderScreen();
    await waitFor(() => expect(mockHandoffs).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Transferred to'), { target: { value: 'stylist' } });
    await waitFor(() => expect(mockHandoffs).toHaveBeenCalledWith(expect.objectContaining({ transferredTo: 'stylist' })));
  });

  it('shows an empty state', async () => {
    mockHandoffs.mockResolvedValue(pageResp([], 0));
    renderScreen();
    await waitFor(() => expect(screen.getByText('No handoffs match these filters.')).toBeInTheDocument());
  });
});
