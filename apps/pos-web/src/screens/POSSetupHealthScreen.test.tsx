// POSSetupHealthScreen — Four-Module Completion Guide §13: counts + overall from the server, a never-verified salon is
// Unknown (not Ready), rows say what to do next and link to the fixing module, the technical view only when allowed,
// Run Health Check refreshes, acknowledge calls the API, branch scope is sent as a filter.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
const { api, navigate } = vi.hoisted(() => ({ api: { summary: vi.fn(), run: vi.fn(), runs: vi.fn(), acknowledge: vi.fn() }, navigate: vi.fn() }));
vi.mock('../api/posSetupHealthApi', () => ({ posSetupHealthApi: api }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<any>()), useNavigate: () => navigate }));
import { POSSetupHealthScreen } from './POSSetupHealthScreen';

const row = (o: Record<string, unknown>) => ({ key: 'twilio.account', area: 'twilio', branchId: null, branchName: null, status: 'ready', stale: false, severity: 'info', code: '', verifiedAt: '2026-10-30T07:10:00Z',
  expiresAt: '2026-10-31T07:10:00Z', lastGoodAt: '2026-10-30T07:10:00Z', action: null, technical: null, ...o });
const counts = { ready: 1, warning: 1, action_required: 1, pending_external: 1, unknown: 0, disabled: 0, error: 0 };
const SUM = (o: Record<string, unknown> = {}) => ({ branches: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Main' }, { id: '22222222-2222-4222-8222-222222222222', name: 'Uptown' }], branchId: null, canRun: true, technical: true,
  run: { id: 'r1', trigger: 'nightly', runDate: '2026-10-30', status: 'succeeded', startedAt: '2026-10-30T07:10:00Z', finishedAt: '2026-10-30T07:10:05Z', stale: false },
  nightly: { status: 'succeeded', runDate: '2026-10-30', finishedAt: '2026-10-30T07:10:05Z', failed: false }, overall: 'action_required', counts,
  checks: [row({ technical: { source: 'tenant_messaging_health_checks', detail: { code: 'connected' } } }),
    row({ key: 'sms.status_callback', area: 'sms_transport', status: 'warning', code: 'traffic_without_callbacks', action: { code: 'open_diagnostics', route: '/tenant/communications/phone#diagnostics' } }),
    row({ key: 'registration.carrier', area: 'registration', status: 'pending_external', code: 'in_review' }),
    row({ key: 'booking.verification', area: 'booking', status: 'action_required', code: 'verification_off', lastGoodAt: null, action: { code: 'open_booking_verification', route: '/tenant/communications/booking-phone-verification' } })],
  alerts: [{ id: 'a1', key: 'booking.verification', branchId: null, severity: 'high', status: 'action_required', occurrences: 2, firstSeenAt: '2026-10-29T07:10:00Z', lastSeenAt: '2026-10-30T07:10:00Z', escalatedAt: null, acknowledgedAt: null }], ...o });
beforeEach(() => { for (const f of [...Object.values(api), navigate]) f.mockReset(); api.summary.mockResolvedValue(SUM()); api.run.mockResolvedValue(SUM()); api.acknowledge.mockResolvedValue({ ok: true });
  api.runs.mockResolvedValue({ items: [{ id: 'r1', trigger: 'nightly', runDate: '2026-10-30', status: 'succeeded', startedAt: '2026-10-30T07:10:00Z', finishedAt: null, overall: 'warning', counts: { action_required: 1 } }], page: 1, pageSize: 8, totalItems: 1, totalPages: 1 }); });

describe('POSSetupHealthScreen', () => {
  it('shows the server overall and counts, and each row says what is wrong and what to do', async () => {
    render(<POSSetupHealthScreen />);
    expect(await screen.findByTestId('hs-overall')).toHaveTextContent('Action required');
    expect(screen.getByTestId('hs-count-ready')).toHaveTextContent('1');
    expect(screen.getByTestId('hs-nightly')).toHaveTextContent(/Nightly check 2026-10-30 finished/);
    const sms = within(screen.getByTestId('hs-area-sms_transport'));
    expect(sms.getByText(/no delivery receipts came back/)).toBeTruthy();
    fireEvent.click(sms.getByTestId('hs-action'));
    expect(navigate).toHaveBeenCalledWith('/tenant/communications/phone#diagnostics');
    expect(within(screen.getByTestId('hs-area-registration')).getAllByText('Waiting on outside setup').length).toBeGreaterThan(0);
  });

  it('a salon that was never checked shows Unknown, never Ready', async () => {
    api.summary.mockResolvedValue(SUM({ run: null, nightly: null, overall: 'unknown', counts: { ...counts, ready: 0 }, checks: [], alerts: [] }));
    render(<POSSetupHealthScreen />);
    expect(await screen.findByTestId('hs-overall')).toHaveTextContent('Unknown');
    expect(screen.getAllByText('No health check has run yet').length).toBeGreaterThan(0);
  });

  it('technical details are hidden until toggled and absent without permission', async () => {
    const { unmount } = render(<POSSetupHealthScreen />);
    await screen.findByTestId('hs-overall');
    expect(screen.queryByTestId('hs-tech-detail')).toBeNull();
    fireEvent.click(screen.getByTestId('hs-tech'));
    expect(screen.getByTestId('hs-tech-detail')).toHaveTextContent('tenant_messaging_health_checks');
    unmount();
    api.summary.mockResolvedValue(SUM({ technical: false, canRun: false }));
    render(<POSSetupHealthScreen />);
    await screen.findByTestId('hs-overall');
    expect(screen.queryByTestId('hs-tech')).toBeNull(); expect(screen.queryByTestId('hs-run')).toBeNull(); expect(screen.queryByTestId('hs-ack')).toBeNull();
  });

  it('runs a check, acknowledges an alert, scopes by branch and opens history', async () => {
    render(<POSSetupHealthScreen />);
    fireEvent.click(await screen.findByTestId('hs-run'));
    await waitFor(() => expect(api.run).toHaveBeenCalledWith());
    expect(await screen.findByText(/Health check finished/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('hs-ack'));
    await waitFor(() => expect(api.acknowledge).toHaveBeenCalledWith('a1'));
    fireEvent.change(screen.getByTestId('hs-branch'), { target: { value: '22222222-2222-4222-8222-222222222222' } });
    await waitFor(() => expect(api.summary).toHaveBeenLastCalledWith('22222222-2222-4222-8222-222222222222'));
    fireEvent.click(screen.getByTestId('hs-history'));
    expect(await within(await screen.findByTestId('hs-runs')).findByText('Finished')).toBeTruthy();
  });
});
