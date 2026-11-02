// Browser/interaction QA for the Super Admin per-tenant payment-gateway panel.
// Renders in jsdom and drives every interaction against a mocked, isolated superAdminApi: initial masked load, the
// edit form, save (request-body correctness + write-only credential clearing), test-connection, and the load-error path.
// It also locks two defects this QA pass fixed:
//   1. the Save body must carry the tenant's ACTUAL gateway status (no silent re-activation of a disabled/pending tenant);
//   2. the processor dropdown must only offer backend-supported processors; controls must have accessible names.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PaymentGatewayPanel } from './PaymentGatewayPanel';
import { superAdminApi } from '../api/superAdminApi';

vi.mock('../api/superAdminApi', () => ({
  superAdminApi: { getGateway: vi.fn(), setGateway: vi.fn(), testGateway: vi.fn(),
    listBranchMerchants: vi.fn(async () => []), setBranchMerchant: vi.fn(), testBranchMerchant: vi.fn(), branchMerchantStatus: vi.fn() },
}));
const getGateway = superAdminApi.getGateway as unknown as ReturnType<typeof vi.fn>;
const setGateway = superAdminApi.setGateway as unknown as ReturnType<typeof vi.fn>;
const testGateway = superAdminApi.testGateway as unknown as ReturnType<typeof vi.fn>;

const TENANT = 'tnt_42';
const masked = (over: Record<string, unknown> = {}) => ({
  processorType: 'fiserv', environment: 'sandbox', merchantIdMasked: '****1', status: 'active', setupRequired: false, ...over,
});

// Locate controls without relying on the (newly added) accessible names, so the behavioural tests are fix-agnostic.
const selectWithOption = (root: HTMLElement, value: string) =>
  (Array.from(root.querySelectorAll('select')) as HTMLSelectElement[])
    .find((el) => Array.from(el.options).some((o) => o.value === value)) ||
  (() => { throw new Error(`no <select> offering "${value}"`); })();
const firstPassword = (root: HTMLElement) => {
  const el = root.querySelector('input[type="password"]') as HTMLInputElement | null;
  if (!el) throw new Error('no password input'); return el;
};

beforeEach(() => { vi.clearAllMocks(); });

describe('PaymentGatewayPanel', () => {
  it('renders the masked gateway summary after load', async () => {
    getGateway.mockResolvedValue(masked({ environment: 'production', merchantIdMasked: '****9911' }));
    const { container } = render(<PaymentGatewayPanel tenantId={TENANT} />);
    expect(await screen.findByText('active')).toBeInTheDocument();
    expect(getGateway).toHaveBeenCalledWith(TENANT);
    expect(container).toHaveTextContent('Processor:');
    expect(container).toHaveTextContent('fiserv');
    expect(container).toHaveTextContent('Merchant:');
    expect(container).toHaveTextContent('****9911');
  });

  it('preserves the loaded gateway status on save (no silent re-activation)', async () => {
    getGateway.mockResolvedValue(masked({ status: 'disabled' }));
    setGateway.mockResolvedValue(masked({ status: 'disabled' }));
    render(<PaymentGatewayPanel tenantId={TENANT} />);
    await screen.findByText('disabled');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save gateway' }));
    await waitFor(() => expect(setGateway).toHaveBeenCalledTimes(1));
    expect(setGateway.mock.calls[0][1]).toMatchObject({ status: 'disabled' });
  });

  it('hydrates a not-configured tenant to the "pending" status (valid option, not "active")', async () => {
    getGateway.mockResolvedValue(masked({ processorType: 'none', merchantIdMasked: '', status: 'not_configured', setupRequired: true }));
    const { container } = render(<PaymentGatewayPanel tenantId={TENANT} />);
    await screen.findByText('setup required');
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    await screen.findByRole('button', { name: 'Save gateway' });
    expect(selectWithOption(container, 'disabled').value).toBe('pending');
  });

  it('sends only the typed credentials, omits blanks, and clears write-only fields after save', async () => {
    getGateway.mockResolvedValue(masked({ environment: 'production', merchantIdMasked: '****9911' }));
    setGateway.mockResolvedValue(masked({ environment: 'production', merchantIdMasked: '****7777' }));
    const { container } = render(<PaymentGatewayPanel tenantId={TENANT} />);
    await screen.findByText('active');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(await screen.findByPlaceholderText('MID / account id'), { target: { value: 'MID-NEW-777' } });
    fireEvent.change(firstPassword(container), { target: { value: 's3cret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save gateway' }));
    await waitFor(() => expect(setGateway).toHaveBeenCalledTimes(1));
    const body = setGateway.mock.calls[0][1] as Record<string, unknown>;
    expect(body).toMatchObject({ merchantId: 'MID-NEW-777', apiPassword: 's3cret', processorType: 'fiserv', environment: 'production', status: 'active' });
    expect(body).not.toHaveProperty('baseUrl');
    expect(body).not.toHaveProperty('apiUsername');
    expect(body).not.toHaveProperty('webhookSecret');
    // form closes on success…
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save gateway' })).not.toBeInTheDocument());
    // …and reopening shows EMPTY credential inputs (write-only, never pre-filled)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect((await screen.findByPlaceholderText('MID / account id') as HTMLInputElement).value).toBe('');
    expect(firstPassword(container).value).toBe('');
  });

  it('loads and submits the underwriting status', async () => {
    getGateway.mockResolvedValue(masked({ onboardingStatus: 'under_review' }));
    setGateway.mockResolvedValue(masked({ onboardingStatus: 'approved' }));
    render(<PaymentGatewayPanel tenantId={TENANT} />);
    await screen.findByText('active');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const sel = await screen.findByLabelText('Underwriting status') as HTMLSelectElement;
    expect(sel.value).toBe('under_review');                       // pre-filled from the masked gateway
    fireEvent.change(sel, { target: { value: 'approved' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save gateway' }));
    await waitFor(() => expect(setGateway).toHaveBeenCalledTimes(1));
    expect((setGateway.mock.calls[0][1] as Record<string, unknown>).onboardingStatus).toBe('approved');
  });

  it('only offers backend-supported processors (no out-of-contract "manual")', async () => {
    getGateway.mockResolvedValue(masked({ status: 'pending', setupRequired: true }));
    const { container } = render(<PaymentGatewayPanel tenantId={TENANT} />);
    await screen.findByText('pending');
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    await screen.findByRole('button', { name: 'Save gateway' });
    const values = Array.from(selectWithOption(container, 'fiserv').options).map((o) => o.value);
    expect(values).not.toContain('manual');
    expect(values).toEqual(expect.arrayContaining(['fiserv', 'cardpointe', 'clover', 'none']));
  });

  it('runs a test connection and surfaces the result note', async () => {
    getGateway.mockResolvedValue(masked({ environment: 'production', merchantIdMasked: '****9911' }));
    testGateway.mockResolvedValue({ ok: true, configured: true, status: 'active', environment: 'production', merchantIdMasked: '****9911', tested: false, note: 'Credentials present and a tenant-bound processor was built.' });
    const { container } = render(<PaymentGatewayPanel tenantId={TENANT} />);
    await screen.findByText('active');
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    await waitFor(() => expect(testGateway).toHaveBeenCalledWith(TENANT));
    expect(container).toHaveTextContent('Credentials present and a tenant-bound processor was built.');
    expect(container).toHaveTextContent('✓');
  });

  it('shows an error and stays usable when the gateway fails to load', async () => {
    getGateway.mockRejectedValue(new Error('gateway load boom'));
    render(<PaymentGatewayPanel tenantId={TENANT} />);
    expect(await screen.findByText('gateway load boom')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeEnabled();
  });

  it('gives the form controls accessible names', async () => {
    getGateway.mockResolvedValue(masked({ status: 'pending', setupRequired: true }));
    render(<PaymentGatewayPanel tenantId={TENANT} />);
    await screen.findByText('pending');
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    expect(await screen.findByLabelText('Status')).toBeInTheDocument();
    expect(screen.getByLabelText('Merchant ID')).toBeInTheDocument();
    expect(screen.getByLabelText('API password')).toBeInTheDocument();
  });
});
