import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { api } from '../api/client';
import { MemoryRouter } from 'react-router-dom';
import { POSAccountScreen } from './POSAccountScreen';

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ principal: { userId: 'u1', tenantId: 't1', branchId: null, role: 'OWNER', permissions: ['a', 'b', 'c'], subscriptionStatus: 'active', fullName: 'Sophia Nguyen' }, loading: false, setPrincipal: vi.fn(), logout: vi.fn() }),
}));
vi.mock('../api/posSettingsApi', () => ({
  posSettingsApi: {
    getState: vi.fn().mockResolvedValue({
      businessBranch: { salonName: 'Luxe Nails & Spa', legalName: 'Luxe Nails LLC', branchName: 'Downtown Branch', address: '1234 Market St', city: 'San Francisco', state: 'CA', zip: '94103', email: 'sophia@luxenails.com', phone: '(415) 555-0198', timezone: 'America/Los_Angeles' },
      notifications: { smsConfirmation: true, emailConfirmation: true, pushConfirmation: true, noShowFollowUp: true, a2pStatus: 'registered' },
      receiptsBranding: { showLogo: true, header: 'Luxe Nails & Spa' },
      subscriptionPlan: { plan: 'Gold', tier: 'Premium', billingStatus: 'active', aiPackageIncluded: true, aiPackage: 'Growth', aiFeatures: {}, customerCount: 120, technicianCount: 8, smsThisMonth: 340 },
    }),
  },
}));
vi.mock('../api/posAiApi', () => ({
  posAiApi: { packages: vi.fn().mockResolvedValue({ packages: [{ code: 'ai_booking_assistant', name: 'AI Booking Assistant', description: '', usageUnit: 'b', subscription: { status: 'active', usageLimit: 500 }, used: 0, remainingUsage: 500, accessible: true, lockReason: null, lockLabel: null, trialAvailable: false }] }) },
}));
vi.mock('../api/posLocationsApi', () => ({
  posLocationsApi: { list: vi.fn().mockResolvedValue({ locations: [{ id: 'l1', name: 'Downtown Branch', status: 'active' }, { id: 'l2', name: 'Uptown Branch', status: 'active' }, { id: 'l3', name: 'Westside Branch', status: 'active' }], summary: { total: 3, active: 3, published: 3, unverified: 0, missingPins: 0, acceptingBookings: 3 } }) },
}));
vi.mock('../api/posAuditApi', () => ({
  posAuditApi: { events: vi.fn().mockResolvedValue({ items: [{ id: 'a1', occurredAt: '2026-05-06T14:21:00Z', actorUserId: 'u1', actorRole: 'OWNER', actorName: 'Sophia Nguyen', module: 'settings', action: 'notification.settings_updated', resourceType: 'settings', summary: 'Updated email and SMS preferences', status: 'success', severity: 'info', ip: '10.0.0.1', device: 'Chrome' }], pagination: { page: 1, pageSize: 6, totalItems: 1, totalPages: 1 } }) },
}));
vi.mock('../api/posSessionsApi', () => ({
  posSessionsApi: { list: vi.fn().mockResolvedValue({ sessions: [
    { id: 's1', device: 'Chrome on macOS', ip: '10.0.0.5', signedInAt: '2026-05-06T14:21:00Z', status: 'active', active: true },
    { id: 's2', device: 'Safari on iOS', ip: '10.0.0.6', signedInAt: '2026-05-05T21:47:00Z', status: 'expired', active: false },
  ] }) },
}));
vi.mock('../api/client', () => ({
  api: {
    get: vi.fn().mockImplementation((url: string) => {
      if (url === '/auth/mfa/status') return Promise.resolve({ enrolled: true, confirmed: true });
      // the server's overview is built from real rows (pos-account-overview.core); unsourced fields are null
      if (url === '/pos/account/overview') return Promise.resolve({
        profile: { email: 'sophia@luxenails.com', phone: null, loyaltyId: 'LUXE01', language: 'en-US', memberSince: '2024-01-12T00:00:00Z', lastLogin: null, ownerTitle: 'Owner' },
        business: { name: 'Luxe Nails LLC', branch: null, address: null, phone: null, timezone: null, display: 'Luxe Nails & Spa', receipts: 'Luxe Nails & Spa' },
        security: { passwordChanged: null, loginAlerts: null, trustedDevices: null },
        billing: { plan: 'Premium', renewal: '2026-05-28T00:00:00Z', renewalShort: 'Next: 2026-05-28', method: null, expires: null, fee: '$499.00', locations: '3', users: '8', features: [] },
        role: { level: 'Owner', scope: 'All assigned locations', branches: [], totals: { users: 8, admins: 1, managers: 2, staff: 5 } },
        backup: { last: null, status: null, next: null },
        notifications: [{ l: 'SMS Notifications', d: 'Receipts, reminders & alerts' }, { l: 'Weekly Report Summaries', d: 'Performance summary emails' }],
      });
      // noon UTC: the same calendar day in every US time zone (midnight UTC dates rendered as Jan 11 under TZ=America/New_York)
      if (url === '/pos/me/profile') return Promise.resolve({ userId: 'u1', role: 'OWNER', avatarUrl: null, email: 'sophia@luxenails.com', fullName: 'Sophia Nguyen', memberSince: '2024-01-12T12:00:00Z', passwordChangedAt: '2026-04-18T12:00:00Z', lastLoginAt: '2026-05-06T14:21:00Z' });
      return Promise.resolve({});
    }),
    patch: vi.fn(),
  },
}));

describe('POSAccountScreen', () => {
  it('renders the account screen from real data only — unsourced values say Not connected, no sample fill', async () => {
    render(<MemoryRouter><POSAccountScreen /></MemoryRouter>);
    expect(await screen.findByText('Account')).toBeInTheDocument();

    // identity (real) — name appears in profile + activity rows
    expect(screen.getAllByText('Sophia Nguyen').length).toBeGreaterThanOrEqual(1);

    // business + brand (real)
    expect((await screen.findAllByText('Luxe Nails & Spa')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('sophia@luxenails.com')).toBeInTheDocument();

    // every module header from the mockup is present
    ['Account Profile', 'Business & Brand Details', 'Security & Access', 'Notification Preferences', 'Subscription & Billing', 'Role & Access Overview', 'Recent Account Activity', 'Account Health Score', 'Compliance Score', 'Backup & Data Health', 'Quick Actions'].forEach((h) => expect(screen.getByText(h)).toBeInTheDocument());

    // real wiring intact: 2FA + linked branches
    expect((await screen.findAllByText('Enabled')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Linked Branches')).toBeInTheDocument();

    // LIVE account activity from the audit feed (GET /pos/audit/events), humanized
    expect(await screen.findByText('Notification Settings Updated')).toBeInTheDocument();
    expect(screen.getByText('Updated email and SMS preferences')).toBeInTheDocument();

    // LIVE sign-in sessions from GET /pos/me/sessions
    expect(await screen.findByText('Chrome on macOS')).toBeInTheDocument();
    expect(screen.getByText('Safari on iOS')).toBeInTheDocument();
    expect(screen.getByText('10.0.0.5')).toBeInTheDocument();

    // LIVE identity from GET /pos/me/profile (users row): member-since + password age (relative)
    expect(await screen.findByText('Jan 12, 2024')).toBeInTheDocument();
    expect(screen.getByText(/Apr 18, 2026 \(\d+ days ago\)/)).toBeInTheDocument();

    // DERIVED health & compliance checklists (computed from real signals, not hardcoded)
    expect(screen.getByText('Profile Complete')).toBeInTheDocument();
    expect(screen.getByText('Login Security (2FA)')).toBeInTheDocument();
    expect(screen.getByText('Messaging Compliance (A2P)')).toBeInTheDocument();

    // sample-filled content still matching the picture
    expect(screen.getByText('All Premium Features')).toBeInTheDocument();
    expect(screen.getByText('Weekly Report Summaries')).toBeInTheDocument();
    // Sep 2026 merge: no fake controls — 'Run Backup Now' (it opened support) is gone; the logs link says what it does
    expect(screen.queryByText('Run Backup Now')).toBeNull();
    expect(screen.getByText('View Activity Logs')).toBeInTheDocument();
    // unsourced values say so instead of showing invented ones
    expect(screen.getAllByText('Not connected').length).toBeGreaterThanOrEqual(3);   // last / status / next backup
    expect(screen.getByText('Held by the card processor')).toBeInTheDocument();      // no 'VISA ending 4242'
    expect(screen.queryByText(/ending 4242/)).toBeNull();   // no invented card
    expect(screen.queryByText('12 / 20')).toBeNull();        // no invented user count / plan limit

    // REAL subscription wiring (super-admin-controlled settings.subscriptionPlan), not sample
    expect(screen.getByText('Premium Plan')).toBeInTheDocument();   // from tier
    expect(screen.getAllByText('8').length).toBeGreaterThanOrEqual(1);   // Active Users = the real technicianCount (no invented plan limit)
  });

  it('Nov 9 guides: no sample KPIs, the eight switches are the saved prefs and only move when the server confirms', async () => {
    const get = vi.mocked(api.get);
    const base = get.getMockImplementation()!;
    get.mockImplementation((url: string, q?: Record<string, unknown>) => {
      if (url === '/pos/me/notification-prefs') return Promise.resolve({ smsNotifications: true, emailNotifications: true, pushNotifications: false, missedCallAlerts: true, bookingAlerts: true, lowStockAlerts: false, payrollApprovals: true, weeklyReportSummaries: true }) as never;
      if (url === '/pos/me/login-alerts') return Promise.resolve({ enabled: false }) as never;
      if (url === '/tenant/messaging/readiness') return Promise.reject(Object.assign(new Error('Forbidden'), { status: 403 })) as never;
      return base(url, q) as never;
    });
    vi.mocked(api.patch).mockResolvedValue({ smsNotifications: true, emailNotifications: true, pushNotifications: false, missedCallAlerts: true, bookingAlerts: true, lowStockAlerts: true, payrollApprovals: true, weeklyReportSummaries: true } as never);
    render(<MemoryRouter><POSAccountScreen /></MemoryRouter>);
    const low = await screen.findByTestId('acx-ntoggle-lowStockAlerts');
    expect(low.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('acx-ntoggle-pushNotifications').getAttribute('aria-checked')).toBe('false');   // real saved value, not a fake "on"
    fireEvent.click(low);
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/pos/me/notification-prefs', { lowStockAlerts: true }));
    await waitFor(() => expect(screen.getByTestId('acx-ntoggle-lowStockAlerts').getAttribute('aria-checked')).toBe('true'));
    // no placeholders: storage / notification health / brand swatches / login alerts / trusted devices
    expect(screen.queryByText('42%')).toBeNull();
    expect(screen.queryByText(/4\.2 GB/)).toBeNull();
    expect(within(screen.getByTestId('acx-kpi-notif')).queryByText('Healthy')).toBeNull();
    expect(within(screen.getByTestId('acx-kpi-notif')).getByText('—')).toBeInTheDocument();
    expect(screen.getByTestId('acx-brand-colors').textContent).toBe('Not configured');
    expect(screen.getByTestId('acx-login-alerts').textContent).toBe('Disabled');
    expect(screen.getByTestId('acx-trusted').textContent).toBe('No trusted-device registry');
    expect(screen.getAllByTestId(/^acx-kpi-/)).toHaveLength(8);
    // full activity: canonical audit, server-paged
    fireEvent.click(screen.getByText('View all'));
    expect(await screen.findByTestId('acx-activity-dialog')).toBeInTheDocument();
  });
});
