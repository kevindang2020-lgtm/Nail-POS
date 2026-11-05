// POSWalkInScreen.vi.test — English + Vietnamese POS mandate (WP-C1): Add Walk-In and New Booking read in Vietnamese — the
// "All Services" chip (a sentinel, labelled at render), validation messages (kept as keys, so a switch re-labels them),
// the date strip and time buttons in the Vietnamese clock — with no English left. Service names stay as the salon typed.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage, useLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { leftoverEnglish } from './viScan.testkit';

vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: { userId: 'u1', tenantId: 't1', branchId: 'b1', role: 'OWNER', permissions: undefined } }) }));
const state = vi.fn();
vi.mock('../api/posBookingApi', async (orig) => ({ ...(await orig<any>()), posBookingApi: { state: (...a: any[]) => state(...a), availability: vi.fn(async () => [{ technicianId: 't1', slots: ['14:30', '15:00'] }]), drafts: { list: vi.fn(async () => ({ drafts: [] })) }, technicians: vi.fn(async () => ({ date: '', technicians: [], total: 0, totalAll: 0, workingCount: 0, page: 1, pageSize: 12, totalPages: 1 })) } }));
vi.mock('../api/posCheckInApi', () => ({ posCheckInApi: { walkIn: vi.fn(), createCustomer: vi.fn(), waitEstimate: vi.fn(async () => ({ configured: true, quotedWaitMinutes: 20 })) } }));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: { quickSearch: vi.fn(async () => []) } }));
import { POSWalkInScreen } from './POSWalkInScreen';
import { POSNewBookingScreen } from './POSNewBookingScreen';

const gel = { serviceId: 's1', name: 'Gel Manicure', category: 'Manicure', priceCents: 4500, durationMinutes: 45 };
beforeEach(() => { state.mockResolvedValue({ filters: { services: [gel], serviceCategories: ['Manicure'], technicians: [] } }); });
afterEach(async () => { await act(async () => { await setLanguage('en'); }); });
const NAMES = ['Gel Manicure', 'Manicure', 'CN'];   // CN = Chủ nhật (Sunday) in the date strip

describe.each([['Walk-In', POSWalkInScreen], ['New Booking', POSNewBookingScreen]])('%s in Vietnamese (WP-C1)', (_n, Screen) => {
  it('the screen and its validation message read in Vietnamese; a switch re-labels the message in place', async () => {
    await setLanguage('vi');
    function Live() { useLanguage(); return <Screen />; }
    const { container } = render(<MemoryRouter><Live /></MemoryRouter>);
    expect(await screen.findByText('Gel Manicure')).toBeInTheDocument();
    expect(screen.getByText('Tất cả dịch vụ')).toBeInTheDocument();
    expect(screen.queryByText('All Services')).toBeNull();
    expect(leftoverEnglish(container, NAMES).join(' | ')).toBe('');
    // submit with nothing picked → the validation message, in Vietnamese, and in English after a switch
    const submit = screen.getAllByRole('button').find((b) => /Thêm vào hàng chờ khách|Xác nhận đặt lịch/.test(b.textContent || ''))!;
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByText(/Vui lòng chọn/)).toBeInTheDocument());
    await act(async () => { await setLanguage('en'); });
    expect(screen.getByText(/Please select/)).toBeInTheDocument();
  });
});
