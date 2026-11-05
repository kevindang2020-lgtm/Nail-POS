import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/customerApi', () => ({ customerApi: { paymentMethods: vi.fn(), addPaymentMethod: vi.fn(), deletePaymentMethod: vi.fn(), setDefaultPaymentMethod: vi.fn() } }));
import { customerApi } from '../api/customerApi';
import { PaymentMethodsScreen } from './PaymentMethodsScreen';

describe('PaymentMethodsScreen', () => {
  beforeEach(() => vi.clearAllMocks());
  it('lists saved cards (brand •••• last4)', async () => {
    (customerApi.paymentMethods as any).mockResolvedValue([{ id: 'pm1', brand: 'Visa', last4: '4242', expMonth: 12, expYear: 2030, isDefault: true }]);
    render(<MemoryRouter><PaymentMethodsScreen /></MemoryRouter>);
    expect(await screen.findByText('Visa •••• 4242')).toBeInTheDocument();
    expect(screen.getByText(/Expires 12\/30/)).toBeInTheDocument();
  });
  it('adds a card with cardholder name and zip code', async () => {
    (customerApi.paymentMethods as any).mockResolvedValue([]);
    (customerApi.addPaymentMethod as any).mockResolvedValue({ id: 'pm2', brand: 'Visa', last4: '1111', expMonth: 12, expYear: 2030, isDefault: true });
    render(<MemoryRouter><PaymentMethodsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '+ Add card' }));
    fireEvent.change(screen.getByLabelText('Card number'), { target: { value: '4111 1111 1111 1111' } });
    fireEvent.change(screen.getByLabelText('Cardholder name'), { target: { value: 'Sarah Connor' } });
    fireEvent.change(screen.getByLabelText('Expiry'), { target: { value: '12/30' } });
    fireEvent.change(screen.getByLabelText('Zip Code'), { target: { value: '90210' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save card' }));
    await waitFor(() => expect(customerApi.addPaymentMethod).toHaveBeenCalledWith(expect.objectContaining({
      token: expect.stringMatching(/^(4111111111111111|9111111111111111)$/),
      last4: '1111',
      brand: 'Visa',
      cardholderName: 'Sarah Connor',
      zipCode: '90210',
    })));
  });

  it('renders Debit Card header by default, cardholder name, zip code, card logos, and secure token notice', async () => {
    (customerApi.paymentMethods as any).mockResolvedValue([]);
    render(<MemoryRouter><PaymentMethodsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '+ Add card' }));

    expect(screen.getByText('Debit Card')).toBeInTheDocument();
    expect(screen.queryByText('Debit or Credit Card')).not.toBeInTheDocument();
    expect(screen.getByText('Card number:')).toBeInTheDocument();
    expect(screen.getByText('Cardholder name:')).toBeInTheDocument();
    expect(screen.getByText('Expiry date:')).toBeInTheDocument();
    expect(screen.getByText('CVC/CVV:')).toBeInTheDocument();
    expect(screen.getByText('Zip Code:')).toBeInTheDocument();

    expect(screen.getByTitle('Visa')).toBeInTheDocument();
    expect(screen.getByTitle('Mastercard')).toBeInTheDocument();
    expect(screen.getByTitle('American Express')).toBeInTheDocument();
    expect(screen.getByTitle('JCB')).toBeInTheDocument();

    expect(screen.getByText(/Stored securely as a token via your salon's payment provider/i)).toBeInTheDocument();
  });

  it('interactively opens the dropdown with options 1. Debit Card and 2. Credit Card and toggles selection', async () => {
    (customerApi.paymentMethods as any).mockResolvedValue([]);
    render(<MemoryRouter><PaymentMethodsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '+ Add card' }));

    // Click the dropdown toggle (currently displaying Debit Card)
    fireEvent.click(screen.getByRole('button', { name: /Debit Card/ }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Debit Card/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Credit Card/ })).toBeInTheDocument();

    // Select Credit Card
    fireEvent.click(screen.getByRole('option', { name: /Credit Card/ }));
    expect(screen.getByRole('button', { name: /Credit Card/ })).toBeInTheDocument();
    expect(screen.queryByText('Debit or Credit Card')).not.toBeInTheDocument();
  });

  it('does not display an Edit button on saved cards, only Default and Remove actions', async () => {
    (customerApi.paymentMethods as any).mockResolvedValue([
      { id: 'pm1', brand: 'Amex', last4: '3415', expMonth: 12, expYear: 2034, isDefault: false, cardholderName: 'Sarah Connor', zipCode: '90210' },
    ]);
    render(<MemoryRouter><PaymentMethodsScreen /></MemoryRouter>);

    expect(await screen.findByText(/Amex •••• 3415/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Default' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('restricts card number to 16 digits max with 4-digit grouping', async () => {
    (customerApi.paymentMethods as any).mockResolvedValue([]);
    render(<MemoryRouter><PaymentMethodsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '+ Add card' }));

    const cardInput = screen.getByLabelText('Card number');
    // Attempt to enter 20 digits
    fireEvent.change(cardInput, { target: { value: '41112222333344449999' } });
    expect(cardInput).toHaveValue('4111 2222 3333 4444');
  });
});

