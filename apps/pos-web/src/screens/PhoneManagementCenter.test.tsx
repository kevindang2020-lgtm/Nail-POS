// PhoneManagementCenter.test — Phone Number Management Complete Build Guide: the center renders the SERVER's numbers, hides what the
// server says this user cannot do, keeps search out of the URL, and the overlay never claims a pending number is active.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/posPhoneCenterApi', () => ({ posPhoneCenterApi: { summary: vi.fn(), health: vi.fn(), history: vi.fn(), pending: vi.fn(), sync: vi.fn(), detail: vi.fn(), customers: vi.fn() } }));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: { phoneStart: vi.fn(), phoneSend: vi.fn(), phoneVerify: vi.fn(), phoneCancel: vi.fn(), phoneApprove: vi.fn(), phoneRetrySync: vi.fn(), phoneManualConfirm: vi.fn() } }));
vi.mock('./POSCustomerPhoneSettingsScreen', () => ({ PhoneSettingsPanel: ({ canEdit }: { canEdit: boolean }) => <div data-testid="phone-settings">{canEdit ? 'editable' : 'read-only'}</div> }));
import { posPhoneCenterApi as api } from '../api/posPhoneCenterApi';
import { posCustomersApi } from '../api/posCustomersApi';
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
  it('PHONE NUMBER MANAGEMENT 4 · 05: a number already on another profile shows who (masked) and that profiles stay separate; "shared family phone" retries with the flag; a recorded family share is shown before the request opens', async () => {
    vi.mocked(api.customers).mockResolvedValue(page([{ customerId: 'c9', name: 'Lan Tran', phoneMasked: '•••• 1111', proof: 'sms_verified', sharedWith: 0, openRequestId: null }]) as never);
    vi.mocked(api.detail).mockResolvedValue(undefined as never);
    vi.mocked(posCustomersApi.phoneStart).mockReset()
      .mockRejectedValueOnce(Object.assign(new Error('in use'), { code: 'duplicate_conflict', details: { duplicates: { outcome: 'phone_in_use', requiresResolution: true, requiresManager: false, matches: [{ customerId: 'c2', maskedName: 'Minh T.', status: 'active_verified' }] } } }) as never)
      .mockResolvedValueOnce({ sessionId: 's1', state: 'pending_phone_saved', maskedPhone: '•••• 2222', duplicates: { outcome: 'shared_family_phone', requiresResolution: false, requiresManager: false, matches: [{ customerId: 'c2', maskedName: 'Minh T.', status: 'active_verified' }] } } as never);
    ui();
    fireEvent.click(await screen.findByTestId('pm-update'));
    fireEvent.click(await screen.findByTestId('pm-up-pick'));
    fireEvent.change(screen.getByTestId('pm-up-phone'), { target: { value: '6095552222' } });
    fireEvent.click(screen.getByTestId('pm-up-review'));
    fireEvent.click(screen.getByTestId('pm-up-confirm'));
    const g = await screen.findByTestId('pm-up-dupguard');
    expect(g).toHaveTextContent('already on another customer profile');
    expect(screen.getByTestId('pm-up-dupmatches')).toHaveTextContent('Minh T.');
    expect(screen.getByTestId('pm-up-dupreminder')).toHaveTextContent('Individual profiles remain separate');
    expect(screen.queryByRole('alert')).toBeNull();                       // a guard, not a failure
    expect(vi.mocked(posCustomersApi.phoneStart).mock.calls[0][1]).not.toHaveProperty('sharedFamilyPhone', true);
    fireEvent.click(screen.getByTestId('pm-up-dup-family'));
    await waitFor(() => expect(vi.mocked(posCustomersApi.phoneStart).mock.calls[1][1]).toMatchObject({ phone: '6095552222', sharedFamilyPhone: true }));
    expect(vi.mocked(posCustomersApi.phoneStart).mock.calls[1][1].idempotencyKey).not.toBe(vi.mocked(posCustomersApi.phoneStart).mock.calls[0][1].idempotencyKey);
    expect(await screen.findByTestId('pm-up-dupguard')).toHaveTextContent('Recorded as a shared family phone');
    fireEvent.click(screen.getByTestId('pm-up-dup-continue'));
    await waitFor(() => expect(api.detail).toHaveBeenCalledWith('s1'));
  });
});
