import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSSettingsScreen } from './POSSettingsScreen';

const state = {
  context: { role: 'OWNER', permissions: [] },
  businessBranch: { salonName: 'Palace', legalName: 'Palace LLC', businessType: 'salon', branchName: 'Main', currency: 'USD', timezone: 'America/New_York', multiBranchEnabled: false },
  paymentsCheckout: { methods: { card: true, cash: true, giftCard: true, split: true }, creditCardSurchargeEnabled: false, creditCardSurchargePercent: 0, cashDiscountEnabled: false, customerDisplayMode: 'review_only', managerApprovalOverCents: 0 },
  tips: { defaultTipPercents: [15, 18, 20], allowCustomTip: true, allowNoTip: true, maxTipPercent: 30, tipBase: 'pretax' },
  tax: { enabled: true, taxRatePercent: 7, taxLabel: 'Sales Tax', mode: 'exclusive', appliesToServices: true, appliesToProducts: true },
  notifications: { smsConfirmation: true, emailConfirmation: true, pushConfirmation: false, reminderHours: [24], receiptDelivery: ['sms'], senderBrand: 'Palace', a2pStatus: 'pending' },
  onlineGoogleAiBooking: { onlineBookingEnabled: true, tenantSlug: 'palace', aiPhoneEnabled: false, aiActions: { findAvailability: true, create: true, reschedule: true, cancel: true, sendReminder: true } },
  sectionStatuses: [],
  moduleStatus: { completionPercent: 0, status: 'in_progress', missingReasons: [], goLivePending: [] },
};
const mockFetch = (s: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => s, headers: { get: () => null } } as any));
beforeEach(() => { vi.restoreAllMocks(); });

describe('POSSettingsScreen', () => {
  it('mounts and renders the settings board + empty section state', async () => {
    globalThis.fetch = mockFetch(state) as any;
    render(<MemoryRouter><POSSettingsScreen /></MemoryRouter>);
    expect(await screen.findByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('No section status reported.')).toBeInTheDocument();
    expect(screen.getByTestId('alg-unverified')).toBeInTheDocument();   // no saved policy in the payload → no invented numbers
  });

  it('Auto-Logout shows the SAVED policy values (Nov 9 guide)', async () => {
    globalThis.fetch = mockFetch({ ...state, storeHoursAutoLogout: { autoLogoutEnabled: true, warningMinutes: [5, 1], gracePeriodMinutes: 7, afterCloseExtensionMinutes: 30, exemptRoles: [], timezone: 'America/New_York' } }) as any;
    render(<MemoryRouter><POSSettingsScreen /></MemoryRouter>);
    expect((await screen.findByTestId('alg-grace')).textContent).toBe('7 min');
    expect(screen.getByTestId('alg-ext').textContent).toBe('30 min');
    expect(screen.getByTestId('alg-warn').textContent).toBe('5 min · 1 min');
  });
});

describe('Booking & Appointments — double-booking policy (Smooth Refresh spec §11)', () => {
  it('offers the three policies, defaults to Block, and saves the chosen one with the section', async () => {
    const bodies: any[] = [];
    globalThis.fetch = vi.fn(async (url: any, init: any = {}) => {
      if (String(init.method || 'GET').toUpperCase() !== 'GET') bodies.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
      return { ok: true, status: 200, json: async () => ({ ...state, bookingAppointments: { slotIntervalMinutes: 15, bufferMinutes: 10, noDoubleBooking: true } }), headers: { get: () => null } } as any;
    }) as any;
    render(<MemoryRouter><POSSettingsScreen /></MemoryRouter>);
    await screen.findByText('Settings');
    const heading = screen.getByText('Booking & Appointments', { selector: 'h2' });
    fireEvent.click(heading.parentElement!.querySelector('button')!);            // the section's Edit button
    const select = (await screen.findByLabelText('Double-booking policy')) as HTMLSelectElement;
    expect(select.value).toBe('BLOCK');
    expect([...select.options].map((o) => o.value)).toEqual(['BLOCK', 'WARN_REQUIRE_CONFIRMATION', 'ALLOW_AUTHORIZED_ROLE']);
    fireEvent.change(select, { target: { value: 'ALLOW_AUTHORIZED_ROLE' } });
    fireEvent.click(screen.getByText('Save Booking & Appointments'));
    await waitFor(() => expect(bodies.some((b) => /booking-appointments/.test(b.url))).toBe(true));
    const saved = bodies.find((b) => /booking-appointments/.test(b.url))!.body;
    expect(JSON.stringify(saved)).toContain('"overbookingPolicy":"ALLOW_AUTHORIZED_ROLE"');
  });
});

// BUILD_PLAN Phase 6 (audit "parallel implementations" 3): the Queue & Workflow "auto-assign" and "assign by" toggles
// were two of three auto-assign switches nothing read. They are gone; the section points to AI Queue Assignment.
describe('Queue & Workflow — retired auto-assign toggles', () => {
  it('no longer offers auto-assign / assign by, never sends them, and links to the AI Queue settings', async () => {
    const bodies: any[] = [];
    globalThis.fetch = vi.fn(async (url: any, init: any = {}) => {
      if (String(init.method || 'GET').toUpperCase() !== 'GET') bodies.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
      return { ok: true, status: 200, json: async () => ({ ...state, autoAssign: true, assignBy: 'round_robin', avgServiceMinutes: 30, showWaitToGuest: true }), headers: { get: () => null } } as any;
    }) as any;
    render(<MemoryRouter><POSSettingsScreen /></MemoryRouter>);
    await screen.findByText('Settings');
    const heading = screen.getByText('Queue & Workflow', { selector: 'h2' });
    expect(screen.getAllByText('Open AI Queue settings →').length).toBeGreaterThan(0);
    fireEvent.click(heading.parentElement!.querySelector('button')!);
    await screen.findByText('Save Queue & Workflow');
    expect(screen.queryByText('auto-assign')).toBeNull();
    expect(screen.queryByText(/assign by/i)).toBeNull();
    fireEvent.click(screen.getByText('Save Queue & Workflow'));
    await waitFor(() => expect(bodies.some((b) => /queue-workflow/.test(b.url))).toBe(true));
    const saved = bodies.find((b) => /queue-workflow/.test(b.url))!.body;
    expect(saved).not.toHaveProperty('autoAssign');
    expect(saved).not.toHaveProperty('assignBy');
    expect(saved).toMatchObject({ avgServiceMinutes: 30 });
  });
});
