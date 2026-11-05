import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/skipLineApi', () => ({ skipLineApi: { activeBill: vi.fn(), payCashToTech: vi.fn(), startPayment: vi.fn(), confirmPayment: vi.fn(), paymentStatus: vi.fn() } }));
import { skipLineApi } from '../api/skipLineApi';
import { PayScreen } from './PayScreen';

const bill = { ticketId: 't1', invoiceId: 't1', ticketNumber: '#000124', customerId: 'c1', customerName: 'Grace', technicianId: 'tech1', technicianName: 'Ava Nguyen', services: [{ serviceLineId: 'l1', serviceName: 'Manicure', technicianId: 'tech1', priceCents: 2500 }, { serviceLineId: 'l2', serviceName: 'Gel Polish', technicianId: 'tech1', priceCents: 1500 }], subtotalCents: 4000, discountCents: 0, taxCents: 350, tipCents: 800, totalDueCents: 5150, ticketStatus: 'ready_for_checkout', paid: false };
const resp = { bill, enabledMethods: ['card', 'apple_pay', 'google_pay', 'cash_to_technician'], settings: { allowCashToTechnician: true, featureEnabled: true } };
const renderPay = () => render(<MemoryRouter><PayScreen /></MemoryRouter>);

describe('PayScreen (Skip-the-Line Checkout)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows the server-computed bill', async () => {
    (skipLineApi.activeBill as any).mockResolvedValue(resp);
    renderPay();
    expect(await screen.findByText('#000124')).toBeTruthy();
    expect(screen.getByText('Manicure')).toBeTruthy();
    expect(screen.getByText('$51.50')).toBeTruthy();
  });

  it('card payment success shows the success screen', async () => {
    (skipLineApi.activeBill as any).mockResolvedValue(resp);
    (skipLineApi.startPayment as any).mockResolvedValue({ intentId: 'i1', ticketId: 't1', method: 'card', amountCents: 5150, gateway: 'sandbox', configured: true, status: 'processing' });
    (skipLineApi.confirmPayment as any).mockResolvedValue({ paid: true, status: 'succeeded', paymentId: 'p1', amountCents: 5150, processorTransactionId: 'SBX-1' });
    renderPay();
    fireEvent.click(await screen.findByText('Pay Now'));
    fireEvent.click(await screen.findByText('Credit / Debit Card'));
    fireEvent.change(screen.getByPlaceholderText('1234 5678 9012 3456'), { target: { value: '4111111111111111' } });
    fireEvent.change(screen.getByPlaceholderText('MM/YY'), { target: { value: '12/30' } });
    fireEvent.change(screen.getByPlaceholderText('123'), { target: { value: '123' } });
    fireEvent.click(screen.getByText('Pay $51.50'));
    expect(await screen.findByText('Payment Successful!')).toBeTruthy();
    expect(skipLineApi.confirmPayment).toHaveBeenCalled();
  });

  it('offers cash to technician and enters the waiting state', async () => {
    (skipLineApi.activeBill as any).mockResolvedValue(resp);
    (skipLineApi.payCashToTech as any).mockResolvedValue({ intentId: 'i2', confirmationId: 'c2', technicianId: 'tech1', technicianName: 'Ava Nguyen', amountCents: 5150, status: 'cash_pending_tech_confirmation' });
    (skipLineApi.paymentStatus as any).mockResolvedValue({ intentId: 'i2', status: 'cash_pending_tech_confirmation', amountCents: 5150, method: 'cash_to_technician' });
    renderPay();
    fireEvent.click(await screen.findByText('Pay Cash to Technician'));
    expect(await screen.findByText(/Hand .* to Ava Nguyen/)).toBeTruthy();
    fireEvent.click(screen.getByText(/pay cash now/i));
    expect(await screen.findByText(/Waiting for Ava Nguyen/)).toBeTruthy();
    expect(skipLineApi.payCashToTech).toHaveBeenCalledWith('t1');
  });

  it('declined card returns to the card step with a message', async () => {
    (skipLineApi.activeBill as any).mockResolvedValue(resp);
    (skipLineApi.startPayment as any).mockResolvedValue({ intentId: 'i1', ticketId: 't1', method: 'card', amountCents: 5150, gateway: 'sandbox', configured: true, status: 'processing' });
    (skipLineApi.confirmPayment as any).mockResolvedValue({ paid: false, status: 'failed', declineReason: 'Declined (sandbox)' });
    renderPay();
    fireEvent.click(await screen.findByText('Pay Now'));
    fireEvent.click(await screen.findByText('Credit / Debit Card'));
    fireEvent.change(screen.getByPlaceholderText('1234 5678 9012 3456'), { target: { value: '4111111111111111' } });
    fireEvent.change(screen.getByPlaceholderText('MM/YY'), { target: { value: '12/30' } });
    fireEvent.change(screen.getByPlaceholderText('123'), { target: { value: '123' } });
    fireEvent.click(screen.getByText('Pay $51.50'));
    expect(await screen.findByText(/Declined/)).toBeTruthy();
  });

  // Customer-added tip (mobile ecosystem Customer pass, Jul 29 2026)
  it('a $10 tip preset flows into startPayment and into the displayed total', async () => {
    (skipLineApi.activeBill as any).mockResolvedValue(resp);
    (skipLineApi.startPayment as any).mockResolvedValue({ intentId: 'i1', ticketId: 't1', method: 'card', amountCents: 6150, tipCents: 1000, gateway: 'sandbox', configured: true, status: 'processing' });
    (skipLineApi.confirmPayment as any).mockResolvedValue({ paid: true, status: 'succeeded', paymentId: 'p1', amountCents: 6150, processorTransactionId: 'SBX-2' });
    renderPay();
    fireEvent.click(await screen.findByText('$10'));
    expect(await screen.findByText('$61.50')).toBeTruthy();               // total = bill + tip
    fireEvent.click(screen.getByText('Pay Now'));
    fireEvent.click(await screen.findByText('Credit / Debit Card'));
    fireEvent.change(screen.getByPlaceholderText('1234 5678 9012 3456'), { target: { value: '4111111111111111' } });
    fireEvent.change(screen.getByPlaceholderText('MM/YY'), { target: { value: '12/30' } });
    fireEvent.change(screen.getByPlaceholderText('123'), { target: { value: '123' } });
    fireEvent.click(screen.getByText('Pay $61.50'));
    expect(await screen.findByText('Payment Successful!')).toBeTruthy();
    expect(skipLineApi.startPayment).toHaveBeenCalledWith('t1', 'card', 1000);
  });

  it('Other with no amount blocks at Pay Now and starts nothing', async () => {
    (skipLineApi.activeBill as any).mockResolvedValue(resp);
    renderPay();
    fireEvent.click(await screen.findByText('Other'));
    fireEvent.click(screen.getByText('Pay Now'));
    expect(await screen.findByText(/valid tip amount/i)).toBeTruthy();
    expect(skipLineApi.startPayment).not.toHaveBeenCalled();
  });
});
