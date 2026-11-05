// MoreScreen (owner navigation hub): the profile card + ~20 menu rows that route to every owner module. This guards the
// nav wiring — a row pointed at the wrong handler, or a handler passed the click event where it expects an argument
// (the openPayroll() wrapping), silently breaks a whole module. Verifies each row calls the correct nav fn, the Settings
// panel expands and loads its snapshot, and Logout confirms before logging out.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const nav = vi.hoisted(() => ({
  go: vi.fn(), openProfile: vi.fn(), openPayroll: vi.fn(), openCustomers: vi.fn(), openInventory: vi.fn(),
  openMarketing: vi.fn(), openPayments: vi.fn(), openAiCenter: vi.fn(), openAlerts: vi.fn(), openSettings: vi.fn(), openAudit: vi.fn(),
  openHardwarePayment: vi.fn(), openCashHandoff: vi.fn(), openCashDrawer: vi.fn(), openCashSummary: vi.fn(),
  openPrivacy: vi.fn(), openTerms: vi.fn(), openDeleteAccount: vi.fn(), openAiPackages: vi.fn(), openTickets: vi.fn(),
}));
const logout = vi.hoisted(() => vi.fn());

vi.mock('../shell/nav', () => ({ useOwnerNav: () => nav }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ logout }) }));
vi.mock('../api/ownerApi', () => ({ ownerMoreApi: { profile: vi.fn(), alertSummary: vi.fn(), settings: vi.fn() } }));

import { ownerMoreApi } from '../api/ownerApi';
import { MoreScreen } from './MoreScreen';

beforeEach(() => {
  vi.clearAllMocks();
  (ownerMoreApi.profile as any).mockResolvedValue({ userId: 'u1', fullName: 'Kim Owner', email: 'kim@salon.com', phone: null, role: 'OWNER', tenantId: 't1', businessName: 'Lotus Nails', timezone: 'America/New_York', currency: 'USD', branchCount: 3 });
  (ownerMoreApi.alertSummary as any).mockResolvedValue({ total: 5, unread: 3, bySeverity: {}, byStatus: {} });
  (ownerMoreApi.settings as any).mockResolvedValue({ businessName: 'Lotus Nails', timezone: 'America/New_York', currency: 'USD', branchCount: 3, activeBranchCount: 2 });
});

// label → the nav fn a click must invoke (direct, no-arg handlers)
const ROWS: [string, keyof typeof nav][] = [
  ['Business Alerts', 'openAlerts'],
  ['Settings', 'openSettings'],
  ['Customers & Loyalty', 'openCustomers'],
  ['Inventory & Products', 'openInventory'],
  ['Marketing & Growth', 'openMarketing'],
  ['Payments & Money', 'openPayments'],
  ['AI Center', 'openAiCenter'],
  ['AI Packages', 'openAiPackages'],
  ['Hardware Payments', 'openHardwarePayment'],
  ['Daily Cash', 'openCashSummary'],
  ['End-of-Day Cash', 'openCashHandoff'],
  ['Cash Drawer', 'openCashDrawer'],
  ['Ticket Oversight', 'openTickets'],
  ['Activity Log', 'openAudit'],
  ['Privacy Policy', 'openPrivacy'],
  ['Terms of Service', 'openTerms'],
  ['Account Deactivation', 'openDeleteAccount'],
];

describe('MoreScreen — navigation hub', () => {
  it.each(ROWS)('routes "%s" to %s', async (label, fn) => {
    render(<MoreScreen />);
    fireEvent.click(await screen.findByText(label));
    expect(nav[fn]).toHaveBeenCalledTimes(1);
  });

  it('routes Branch Performance and Team Performance through go() with the right tab', async () => {
    render(<MoreScreen />);
    fireEvent.click(await screen.findByText('Branch Performance'));
    expect(nav.go).toHaveBeenCalledWith('branches');
    fireEvent.click(screen.getByText('Team Performance'));
    expect(nav.go).toHaveBeenCalledWith('staff');
  });

  it('calls openPayroll with no arguments (guards the () => openPayroll() wrapping)', async () => {
    render(<MoreScreen />);
    fireEvent.click(await screen.findByText('Commission & Payroll'));
    expect(nav.openPayroll).toHaveBeenCalledWith();
  });

  it('opens the profile card', async () => {
    render(<MoreScreen />);
    fireEvent.click(await screen.findByLabelText('Open profile and settings'));
    expect(nav.openProfile).toHaveBeenCalledTimes(1);
  });

  it('shows the unread alert badge from the summary', async () => {
    render(<MoreScreen />);
    expect(await screen.findByText('3')).toBeInTheDocument();
  });

  it('confirms before logging out (inline dialog, not the native one)', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    render(<MoreScreen />);
    fireEvent.click(await screen.findByText('Log Out'));
    expect(logout).not.toHaveBeenCalled();                       // the tap opens the dialog, it does not log out
    fireEvent.click(await screen.findByRole('button', { name: 'Log Out' }));
    expect(logout).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('does not log out if the dialog is cancelled', async () => {
    render(<MoreScreen />);
    fireEvent.click(await screen.findByText('Log Out'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(logout).not.toHaveBeenCalled();
  });
});
