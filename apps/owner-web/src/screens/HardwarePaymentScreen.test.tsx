// HardwarePaymentScreen (owner money screen): read-only hardware plan + monthly statements, plus self-service autopay
// (save tokenized card -> record consent). Verifies the plan summary, the "card on file ending ••••" now shows the last4
// (it lives in the response's savedPaymentMethod, not on plan — the fix), the authorize flow + validation, the owner-safe
// invoice rendering, that id-less owner invoices render without a React key warning (the key fix), the no-plan state, and 403.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../shell/nav', () => ({ useOwnerNav: () => ({ back: vi.fn() }) }));
vi.mock('../api/ownerApi', () => ({ ownerHardwarePaymentApi: { plan: vi.fn(), invoices: vi.fn(), addMethod: vi.fn(), consent: vi.fn() } }));

import { ownerHardwarePaymentApi as HP } from '../api/ownerApi';
import { HardwarePaymentScreen } from './HardwarePaymentScreen';

const planResp = (over: any = {}, method: any = { brand: 'card', last4: '4242', status: 'active' }) => ({
  plan: { id: 'plan1', status: 'active', monthlyPaymentCents: 25000, remainingBalanceCents: 150000, autoChargeShortfallEnabled: true, savedPaymentMethodId: 'pm1', ...over },
  savedPaymentMethod: method,
});
const invoices = () => [
  { billingMonth: '2026-06', hardwareMonthlyDueCents: 25000, salonHardwareCreditCents: 18000, shortfallCents: 7000, autoChargeAmountCents: 7000, status: 'paid' },
  { billingMonth: '2026-05', hardwareMonthlyDueCents: 25000, salonHardwareCreditCents: 25000, shortfallCents: 0, autoChargeAmountCents: 0, status: 'paid' },
];

beforeEach(() => {
  vi.clearAllMocks();
  (HP.plan as any).mockResolvedValue(planResp());
  (HP.invoices as any).mockResolvedValue(invoices());
  (HP.addMethod as any).mockResolvedValue({ ok: true });
  (HP.consent as any).mockResolvedValue({ ok: true });
});

describe('HardwarePaymentScreen', () => {
  it('renders the plan summary', async () => {
    render(<HardwarePaymentScreen />);
    expect(await screen.findByText('$250.00')).toBeInTheDocument();      // monthly payment
    expect(screen.getByText('$1,500.00')).toBeInTheDocument();          // remaining balance
    expect(screen.getByText('On')).toBeInTheDocument();                 // auto-charge
  });

  it('shows the saved card last4 (from savedPaymentMethod, not plan)', async () => {
    render(<HardwarePaymentScreen />);
    expect(await screen.findByText(/A card is on file ending 4242/)).toBeInTheDocument();
  });

  it('saves the card then records consent on authorize', async () => {
    (HP.plan as any).mockResolvedValue(planResp({ savedPaymentMethodId: null }, null));   // no card yet -> form shows
    render(<HardwarePaymentScreen />);
    const tokenInput = await screen.findByPlaceholderText(/Card token/);
    fireEvent.change(tokenInput, { target: { value: 'tok_123' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Save card & authorize autopay'));
    await waitFor(() => expect(HP.addMethod).toHaveBeenCalledWith(expect.objectContaining({ gatewayPaymentMethodToken: 'tok_123', brand: 'card' })));
    await waitFor(() => expect(HP.consent).toHaveBeenCalledWith('plan1'));
    expect(await screen.findByText(/Autopay authorized/)).toBeInTheDocument();
  });

  it('blocks authorize without a token or without consent', async () => {
    (HP.plan as any).mockResolvedValue(planResp({ savedPaymentMethodId: null }, null));
    render(<HardwarePaymentScreen />);
    await screen.findByPlaceholderText(/Card token/);
    fireEvent.click(screen.getByText('Save card & authorize autopay'));               // no token
    expect(await screen.findByText(/Enter the card token/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Card token/), { target: { value: 'tok_9' } });
    fireEvent.click(screen.getByText('Save card & authorize autopay'));               // token but not agreed
    expect(await screen.findByText(/check the authorization box/)).toBeInTheDocument();
    expect(HP.addMethod).not.toHaveBeenCalled();
  });

  it('renders owner-safe invoices (credit/due/shortfall/auto-charged) with no React key warning', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<HardwarePaymentScreen />);
    expect(await screen.findByText('2026-06')).toBeInTheDocument();
    expect(screen.getByText('2026-05')).toBeInTheDocument();
    expect(screen.getByText('Hardware credit: $180.00')).toBeInTheDocument();
    expect(screen.getByText('Shortfall: $70.00')).toBeInTheDocument();
    const keyWarnings = spy.mock.calls.filter((c) => String(c[0]).toLowerCase().includes('unique') && String(c[0]).toLowerCase().includes('key'));
    expect(keyWarnings).toHaveLength(0);
    spy.mockRestore();
  });

  it('shows a no-plan message when the salon has no plan', async () => {
    (HP.plan as any).mockResolvedValue({ plan: null, savedPaymentMethod: null });
    render(<HardwarePaymentScreen />);
    expect(await screen.findByText(/No hardware payment plan is on file/)).toBeInTheDocument();
  });

  it('shows a friendly message on a 403', async () => {
    (HP.plan as any).mockRejectedValue({ status: 403 });
    render(<HardwarePaymentScreen />);
    expect(await screen.findByText('You do not have access to hardware payments.')).toBeInTheDocument();
  });
});
