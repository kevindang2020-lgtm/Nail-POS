import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TechNavProvider } from '../shell/nav';
vi.mock('../lib/useTechStream', () => ({ useTechStream: () => {} }));
vi.mock('../api/techApi', async (orig) => ({ ...(await orig<typeof import('../api/techApi')>()), techApi: { cashPending: vi.fn(), confirmCashReceived: vi.fn(), reportCashNotPaid: vi.fn() } }));
import { techApi } from '../api/techApi';
import { CashPendingScreen } from './CashPendingScreen';

const item = (over: Record<string, unknown> = {}) => ({ confirmationId: 'cc1', ticketId: 'tk1', paymentIntentId: 'pi1', amountCents: 5150, customerName: 'Grace Kim', ticketNumber: '#000124', services: [{ serviceLineId: 'l1', serviceName: 'Manicure', priceCents: 2500 }, { serviceLineId: 'l2', serviceName: 'Gel Polish', priceCents: 1500 }], ...over });
const renderScreen = () => render(<TechNavProvider><CashPendingScreen /></TechNavProvider>);

describe('CashPendingScreen (Tech cash confirmation)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists a pending cash payment with amount and actions', async () => {
    (techApi.cashPending as any).mockResolvedValue({ items: [item()] });
    renderScreen();
    expect(await screen.findByText('Grace Kim')).toBeTruthy();
    expect(screen.getByText('$51.50')).toBeTruthy();
    expect(screen.getByText('Confirm Cash Received')).toBeTruthy();
    expect(screen.getByText('Customer Did Not Pay')).toBeTruthy();
  });

  it('confirm closes the item and shows a toast', async () => {
    (techApi.cashPending as any).mockResolvedValue({ items: [item()] });
    (techApi.confirmCashReceived as any).mockResolvedValue({ paid: true, paymentId: 'p1', amountCents: 5150, ticketStatus: 'paid' });
    renderScreen();
    fireEvent.click(await screen.findByText('Confirm Cash Received'));
    expect(await screen.findByText(/Confirmed \$51.50 from Grace Kim/)).toBeTruthy();
    expect(techApi.confirmCashReceived).toHaveBeenCalledWith('tk1');
  });

  it('did-not-pay reports to the front desk', async () => {
    (techApi.cashPending as any).mockResolvedValue({ items: [item()] });
    (techApi.reportCashNotPaid as any).mockResolvedValue({ reported: true, status: 'cash_issue_needs_front_desk' });
    renderScreen();
    fireEvent.click(await screen.findByText('Customer Did Not Pay'));
    fireEvent.click(await screen.findByText('Confirm: not paid'));
    expect(await screen.findByText(/front desk/i)).toBeTruthy();
    expect(techApi.reportCashNotPaid).toHaveBeenCalled();
  });

  it('shows an empty state when nothing is pending', async () => {
    (techApi.cashPending as any).mockResolvedValue({ items: [] });
    renderScreen();
    expect(await screen.findByText(/No cash payments waiting/)).toBeTruthy();
  });
});
