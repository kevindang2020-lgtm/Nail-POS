import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockDevices } = vi.hoisted(() => ({ mockDevices: vi.fn() }));
vi.mock('../api/superAdminBookingCheckinApi', () => ({ superAdminBookingCheckinApi: { devices: (q: any) => mockDevices(q) } }));

import DeviceStatusScreen from './DeviceStatusScreen';

const dev = (i: number, over: Partial<any> = {}) => ({
  id: `d${i}`, deviceName: `Kiosk ${i}`, deviceType: 'kiosk', branch: 'Downtown', state: 'online',
  registeredStatus: 'active', lastSeenAt: new Date(Date.now() - 60000).toISOString(), disabledAt: null,
  registeredAt: '2026-06-01T00:00:00Z', ...over,
});
const pageResp = (rows: any[], total = rows.length, page = 1, pageSize = 25) => ({ ok: true, scope: { tenantId: null, branchId: null, label: 'All tenants' }, page, pageSize, total, rows });
const renderScreen = () => render(<MemoryRouter initialEntries={['/booking-checkin/device-status']}><DeviceStatusScreen /></MemoryRouter>);
beforeEach(() => { mockDevices.mockReset(); });

describe('DeviceStatusScreen', () => {
  it('renders devices with heartbeat states', async () => {
    mockDevices.mockResolvedValue(pageResp([dev(1), dev(2, { state: 'offline', deviceName: 'Tablet 2' })]));
    renderScreen();
    await waitFor(() => expect(screen.getByText('Kiosk 1')).toBeInTheDocument());
    expect(screen.getByText('Tablet 2')).toBeInTheDocument();
    expect(screen.getByText('2 devices')).toBeInTheDocument();
    expect(screen.getAllByText('Offline').length).toBeGreaterThanOrEqual(1);
  });

  it('re-queries when the state filter changes', async () => {
    mockDevices.mockResolvedValue(pageResp([dev(1)]));
    renderScreen();
    await waitFor(() => expect(mockDevices).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'offline' } });
    await waitFor(() => expect(mockDevices).toHaveBeenCalledWith(expect.objectContaining({ status: 'offline' })));
  });

  it('opens a detail drawer with heartbeat detail on row click', async () => {
    mockDevices.mockResolvedValue(pageResp([dev(1)]));
    renderScreen();
    await waitFor(() => expect(screen.getByText('Kiosk 1')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Kiosk 1'));
    await waitFor(() => expect(screen.getByText('Registered Status')).toBeInTheDocument());
    expect(screen.getByText('Disabled At')).toBeInTheDocument();
  });

  it('shows an empty state', async () => {
    mockDevices.mockResolvedValue(pageResp([], 0));
    renderScreen();
    await waitFor(() => expect(screen.getByText('No devices match these filters.')).toBeInTheDocument());
  });

  it('shows a live auto-refresh indicator after loading', async () => {
    mockDevices.mockResolvedValue(pageResp([dev(1)]));
    renderScreen();
    await waitFor(() => expect(screen.getByText(/Live/)).toBeInTheDocument());
    expect(screen.getByText(/auto-refresh 15s/)).toBeInTheDocument();
  });

  it('auto-refreshes device state in the background on the interval', async () => {
    vi.useFakeTimers();
    try {
      mockDevices.mockResolvedValue(pageResp([dev(1)]));
      renderScreen();
      await vi.advanceTimersByTimeAsync(0);
      const initial = mockDevices.mock.calls.length;
      await vi.advanceTimersByTimeAsync(15_000);
      expect(mockDevices.mock.calls.length).toBeGreaterThan(initial);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves last device state and flags stale when a background refresh fails', async () => {
    vi.useFakeTimers();
    try {
      mockDevices.mockResolvedValueOnce(pageResp([dev(1)]));
      renderScreen();
      await vi.advanceTimersByTimeAsync(0);
      mockDevices.mockRejectedValueOnce(new Error('blip'));
      await vi.advanceTimersByTimeAsync(15_000);
      expect(screen.getByText(/Reconnecting/)).toBeInTheDocument();
      expect(screen.getByText('Kiosk 1')).toBeInTheDocument(); // last state preserved
    } finally {
      vi.useRealTimers();
    }
  });

});
