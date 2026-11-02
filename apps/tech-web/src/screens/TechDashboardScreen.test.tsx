// TechDashboardScreen.test.tsx — the home screen loads /tech and renders the technician's name + today overview,
// with explicit loading and error states. The API client is mocked so no backend is needed.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../api/techApi', async (orig) => ({
  ...(await orig<typeof import('../api/techApi')>()),
  techApi: { dashboard: vi.fn(), accept: vi.fn(), startService: vi.fn(), cashPending: vi.fn().mockResolvedValue({ items: [] }) },
}));
import { techApi } from '../api/techApi';
import { TechDashboardScreen } from './TechDashboardScreen';
import { expectNoA11yViolations } from '@aipowersalon/testing/a11y';   // §220 (Oct 21 2026): axe over the rendered screen
import { TechNavProvider } from '../shell/nav';

const state = (over: Record<string, unknown> = {}) => ({
  technician: { fullName: 'Mia Tran', initials: 'MT', avatarUrl: null },
  overview: { bookings: 7, inService: 5, completed: 9, totalSalesCents: 184000, totalSalesTrendPercent: 12 },
  earnings: { tipsCents: 22000, estimatedCommissionCents: 64000 },
  notificationsCount: 0, availableActions: {}, assignedTicketId: null, ...over,
});

describe('TechDashboardScreen', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a loading state, then the tech name and today overview counts', async () => {
    (techApi.dashboard as any).mockResolvedValue(state());
    render(<TechNavProvider><TechDashboardScreen /></TechNavProvider>);
    expect(screen.getByText(/Loading today/)).toBeInTheDocument();
    // Reference greeting shows the first name with a wave ("Mia 👋"), not the full legal name
    expect(await screen.findByText(/^Mia/)).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument(); // today's tickets
    expect(screen.getByText('5')).toBeInTheDocument(); // in service
    expect(screen.getByText('9')).toBeInTheDocument(); // completed
  });

  it('shows an error state when the dashboard fails to load', async () => {
    (techApi.dashboard as any).mockRejectedValue(new Error('network down'));
    render(<TechNavProvider><TechDashboardScreen /></TechNavProvider>);
    expect(await screen.findByRole('alert')).toHaveTextContent('network down');
  });

  // ONE-PAY F1: the commission / tips are the payroll authority's; when it cannot be read the API sends null + a note
  it('shows "—" and the note when commission and tips are unknown (never a computed estimate)', async () => {
    (techApi.dashboard as any).mockResolvedValue(state({ earnings: { todaySalesCents: 184000, tipsCents: null, estimatedCommissionCents: null, note: 'Commission and tips come from payroll.' } }));
    render(<TechNavProvider><TechDashboardScreen /></TechNavProvider>);
    expect(await screen.findByText('Commission and tips come from payroll.')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/NaN|\$0\.00/)).toBeNull();
  });

  it('§220: no accessibility violations (axe)', async () => {
    (techApi.dashboard as any).mockResolvedValue(state());
    const { container } = render(<TechNavProvider><TechDashboardScreen /></TechNavProvider>);
    await screen.findByText(/^Mia/);
    await expectNoA11yViolations(container);
  });
});
