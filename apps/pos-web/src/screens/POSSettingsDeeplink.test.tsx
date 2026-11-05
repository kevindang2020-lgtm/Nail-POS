import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
const mockFetch = (s: unknown) => (async () => ({ ok: true, status: 200, json: async () => s, headers: { get: () => null } } as any));

describe('POSSettingsScreen deep-link', () => {
  it('renders section anchors that ?section= targets (Management deep-link)', async () => {
    globalThis.fetch = mockFetch(state) as any;
    render(<MemoryRouter initialEntries={['/settings?section=business-branch']}><POSSettingsScreen /></MemoryRouter>);
    expect(await screen.findByText('Settings')).toBeInTheDocument();
    expect(document.getElementById('sec-business-branch')).not.toBeNull();
    expect(document.getElementById('sec-booking-appointments')).not.toBeNull();
    expect(document.getElementById('sec-tax')).not.toBeNull();
  });
});
