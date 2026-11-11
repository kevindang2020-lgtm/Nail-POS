// POSEmailScreen.test.tsx — Communications → Email (Email Management & Delivery Center). The photographed settings keep
// their meaning (sender name + two toggles + Save), the email sender name is saved as emailSenderName (never into the SMS
// brand), other receipt channels are preserved, and Delivered reads N/A when no verified provider event exists.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const m = vi.hoisted(() => ({ getCat: vi.fn(), update: vi.fn(), settings: vi.fn(), summary: vi.fn(), health: vi.fn(), history: vi.fn() }));
vi.mock('../api/posSettingsApi', () => ({ posSettingsApi: { getCategory: m.getCat, updateCategory: m.update } }));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: { quickSearch: vi.fn().mockResolvedValue({ items: [] }) } }));
vi.mock('../api/posEmailCenterApi', () => ({ posEmailCenterApi: { settings: m.settings, summary: m.summary, health: m.health, history: m.history, check: vi.fn(), detail: vi.fn(), resend: vi.fn(), test: vi.fn(), compose: vi.fn() } }));
import { POSEmailScreen } from './POSEmailScreen';

const W = { preset: 'month', from: '2026-10-01', to: '2026-10-31', tz: 'America/New_York', today: '2026-10-31' };
beforeEach(() => {
  try { sessionStorage.clear(); } catch { /* jsdom */ }
  Object.values(m).forEach((f) => f.mockReset());
  m.getCat.mockResolvedValue({ senderBrand: 'SMS Brand LLC', emailConfirmation: false, receiptDelivery: ['SMS'] });
  m.settings.mockResolvedValue({ senderName: 'Glow Bar', replyTo: null, bookingConfirmations: false, receipts: false, source: 'tenant', fromAddress: 'nailsalons@aipowersalon.com', savedAt: null, canEdit: true });
  m.summary.mockResolvedValue({ window: W, provider: 'unknown', accepted: 3, delivered: null, failed: 1, bounced: 0, blocked: 0, simulated: 0, bookingConfirmations: 1, receipts: 2, deliveryRate: null, deliveryRateDenominator: null });
  m.health.mockResolvedValue({ overall: 'unknown', layers: [{ key: 'provider_health', state: 'not_checked', detail: 'Never checked.', next: 'retry_health_check' }], fromAddress: 'nailsalons@aipowersalon.com', lastCheckedAt: null, lastSuccessAt: null });
  m.history.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 1, basis: 'created', window: W, masked: false });
});
const mount = () => render(<MemoryRouter><POSEmailScreen /></MemoryRouter>);

describe('POSEmailScreen', () => {
  it('shows the EMAIL sender name (not the SMS brand) and the saved toggles', async () => {
    mount();
    expect(await screen.findByDisplayValue('Glow Bar')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('SMS Brand LLC')).toBeNull();
    expect((screen.getByTestId('emc-booking') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId('emc-receipts') as HTMLInputElement).checked).toBe(false);
  });
  it('Delivered is N/A — never 0 — without verified provider events', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('emc-kpi-delivered').textContent).toMatch(/N\/A/));
  });
  it('saves emailSenderName + toggles, preserving the SMS receipt channel; Save is disabled until something changes', async () => {
    m.update.mockResolvedValue({});
    mount();
    await screen.findByDisplayValue('Glow Bar');
    expect((screen.getByTestId('emc-save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('emc-booking')); fireEvent.click(screen.getByTestId('emc-receipts'));
    expect(screen.getByTestId('emc-save-state').textContent).toMatch(/Unsaved/);
    fireEvent.click(screen.getByTestId('emc-save'));
    await waitFor(() => expect(m.update).toHaveBeenCalled());
    const [cat, body] = m.update.mock.calls[0];
    expect(cat).toBe('notifications-reminders');
    expect(body).toMatchObject({ emailSenderName: 'Glow Bar', emailConfirmation: true });
    expect(body.senderBrand).toBeUndefined();
    expect(body.receiptDelivery).toEqual(['SMS', 'Email']);
  });
  it('Draft autosave: subject and message survive closing and reopening the composer; the recipient is not kept', async () => {
    render(<MemoryRouter><POSEmailScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('emc-compose'));
    fireEvent.change(screen.getByTestId('emc-c-subject'), { target: { value: 'Holiday hours' } });
    expect(screen.queryByTestId('emc-c-restored')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('emc-composer')).toBeNull());
    fireEvent.click(screen.getByTestId('emc-compose'));
    expect((screen.getByTestId('emc-c-subject') as HTMLInputElement).value).toBe('Holiday hours');
    expect(screen.getByTestId('emc-c-restored')).toBeInTheDocument();
    expect(sessionStorage.getItem('aps.emc.draft')).not.toMatch(/customer|@/);
  });
});
