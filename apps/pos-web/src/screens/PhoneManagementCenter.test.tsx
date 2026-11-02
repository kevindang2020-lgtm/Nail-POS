// PhoneManagementCenter.test — Phone Number Management Complete Build Guide: the center renders the SERVER's numbers, hides what the
// server says this user cannot do, keeps search out of the URL, and the overlay never claims a pending number is active.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/posPhoneCenterApi', () => ({ posPhoneCenterApi: { summary: vi.fn(), health: vi.fn(), history: vi.fn(), pending: vi.fn(), sync: vi.fn(), detail: vi.fn(), customers: vi.fn() } }));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: { phoneStart: vi.fn(), phoneSend: vi.fn(), phoneVerify: vi.fn(), phoneCancel: vi.fn(), phoneApprove: vi.fn(), phoneRetrySync: vi.fn(), phoneManualConfirm: vi.fn() } }));
vi.mock('./POSCustomerPhoneSettingsScreen', () => ({ PhoneSettingsPanel: ({ canEdit }: { canEdit: boolean }) => <div data-testid="phone-settings">{canEdit ? 'editable' : 'read-only'}</div> }));
import { posPhoneCenterApi as api } from '../api/posPhoneCenterApi';
import { PhoneManagementCenter } from './PhoneManagementCenter';

const kpi = (value: number | string) => ({ value, source: 'test' });
const summary = (can = { startChange: true, editSettings: true, retrySync: true }) => ({ timezone: 'America/New_York', generatedAt: '2026-10-31T12:00:00Z', syncAttention: 1,
  kpis: { verified: kpi(35), pending: kpi(3), failed: kpi(1), today: kpi(6), shared: kpi(2), smsHealth: kpi('unchecked') }, can });
const row = { id: 'r1', customerId: 'c1', customerName: 'Hoa Nguyen', avatarUrl: null, oldPhoneMasked: '•••• 7004', newPhoneMasked: '•••• 7054', state: 'verification_sent', status: 'code_sent',
  source: 'staff_pos', requestedBy: 'Fiona', requestedByRole: 'RECEPTION', branchId: null, branchName: null, createdAt: '2026-10-31T11:58:00Z', updatedAt: null, expiresAt: '2026-10-31T12:06:00Z',
  completedAt: null, verifiedAt: null, appliedAt: null, verificationMethod: null, sharedWith: 0, attempts: 0, lastAttemptAt: null, ageMinutes: 2, sync: { state: 'not_needed', attempts: 0, nextAttemptAt: null, lastError: null } };
const page = (items: unknown[]) => ({ items, page: 1, pageSize: 10, totalItems: items.length, totalPages: 1 });
const ui = (path = '/tenant/customers/phone-management') => render(<MemoryRouter initialEntries={[path]}><PhoneManagementCenter /></MemoryRouter>);

beforeEach(() => {
  vi.mocked(api.summary).mockReset().mockResolvedValue(summary() as never);
  vi.mocked(api.health).mockReset().mockResolvedValue({ checkedAt: '', items: [{ key: 'sender', state: 'unchecked', message: 'never checked' }], limits: { codeDigits: 6, codeTtlSeconds: 600, maxAttempts: 5, resendCooldownSeconds: 60, syncMaxAttempts: 8 } } as never);
  vi.mocked(api.pending).mockReset().mockResolvedValue(page([row]) as never);
  vi.mocked(api.history).mockReset().mockResolvedValue(page([row]) as never);
  vi.mocked(api.detail).mockReset().mockResolvedValue({ ...row, reason: null, trustedStillActive: true, message: 'x', current: { phoneMasked: '•••• 7004', proof: 'sms_verified', since: null, verifiedAt: null },
    verification: { status: 'sent', digits: 6, attemptsUsed: 0, attemptsLeft: 5, resends: 0, lastSentAt: null, deliveredAt: null, codeExpiresAt: null, resendAvailableInSeconds: 0, failure: null, sender: { state: 'ready', kind: 'internal_otp', lastCheckedAt: null, message: 'ok' } },
    oldNumberNotice: { state: 'not_due' }, recent: [], actions: { sendCode: true, verifyCode: true, cancel: true, approve: false, resolveDuplicate: false, manualException: false, retrySync: false, startNew: false } } as never);
});

describe('Phone Number Management center', () => {
  it('shows the six KPIs from the server and the pending queue', async () => {
    ui();
    expect(await screen.findByTestId('pm-kpi-verified')).toHaveTextContent('35');
    expect(screen.getByTestId('pm-kpi-pending')).toHaveTextContent('3');
    expect(screen.getByTestId('pm-kpi-sms')).toHaveTextContent('Not checked');
    expect(await screen.findByText('Hoa Nguyen')).toBeTruthy();
    expect(screen.getByTestId('phone-settings')).toHaveTextContent('editable');
  });
  it('hides Update Phone and makes the policy read-only when the server says so', async () => {
    vi.mocked(api.summary).mockResolvedValue(summary({ startChange: false, editSettings: false, retrySync: false }) as never);
    ui();
    await screen.findByTestId('pm-kpi-verified');
    expect(screen.queryByTestId('pm-update')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('phone-settings')).toHaveTextContent('read-only'));
  });
  it('the overlay says the current phone stays active while a change is pending', async () => {
    ui();
    fireEvent.click(await screen.findByText('Hoa Nguyen'));
    expect(await screen.findByTestId('pm-ov-banner')).toHaveTextContent('remains active until the new phone is verified');
    expect(screen.getByTestId('pm-ov-attempts')).toHaveTextContent('Tries left: 5 of 5');
  });
  it('a 403 shows the permission notice, not an empty page', async () => {
    vi.mocked(api.summary).mockRejectedValue(Object.assign(new Error('no'), { status: 403 }) as never);
    ui();
    expect(await screen.findByTestId('pm-forbidden')).toBeTruthy();
  });
});
