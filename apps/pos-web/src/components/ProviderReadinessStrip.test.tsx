// extras Communications SMS Inbox 04: the inbox shows the five provider readiness facts from the ONE server readiness.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readinessFixture } from '../screens/phoneMessagingTestKit';

const phone = vi.hoisted(() => ({ readiness: vi.fn() }));
const navTo = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('../api/posPhoneApi', () => ({ posPhoneApi: phone }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useNavigate: () => navTo.fn }));
import { ProviderReadinessStrip, readinessItems } from './ProviderReadinessStrip';

beforeEach(() => { phone.readiness.mockReset(); navTo.fn.mockReset(); });

describe('ProviderReadinessStrip (extras Communications 04)', () => {
  it('shows account, sender, carrier registration, incoming texts and delivery reports with the server state; a chip opens its fix', async () => {
    phone.readiness.mockResolvedValue(readinessFixture());
    render(<MemoryRouter><ProviderReadinessStrip branchId="b1" /></MemoryRouter>);
    expect(await screen.findByTestId('ci-provider')).toBeInTheDocument();
    expect(phone.readiness).toHaveBeenCalledWith('b1');
    expect(screen.getByTestId('ci-prov-account')).toHaveTextContent('Account: Connected');
    expect(screen.getByTestId('ci-prov-sender')).toHaveTextContent('Sender number: Assigned');
    expect(screen.getByTestId('ci-prov-registration')).toHaveTextContent('Carrier registration: Not started');
    expect(screen.getByTestId('ci-prov-inbound')).toHaveTextContent('Incoming texts: Set up, no report yet');
    expect(screen.getByTestId('ci-prov-status')).toHaveTextContent('Delivery reports: Set up, no report yet');
    expect(screen.getByTestId('ci-prov-account').className).toContain('ok');
    expect(screen.getByTestId('ci-prov-registration').className).toContain('warn');
    fireEvent.click(screen.getByTestId('ci-prov-registration'));
    expect(navTo.fn).toHaveBeenCalledWith('/tenant/communications/messaging-setup#registration');
  });
  it('a toll-free sender reads its toll-free verification instead of A2P; a failed read is said, never "ready"', async () => {
    const r = readinessFixture({ a2p: { ...readinessFixture().a2p, applicable: false } });
    r.tollFree = { ...r.tollFree!, state: 'rejected', reasonCode: 'TF_REJECTED', fixLink: '/tenant/communications/messaging-setup#toll-free' } as typeof r.tollFree;
    expect(readinessItems(r)[2]).toMatchObject({ key: 'registration', state: 'rejected', reasonCode: 'TF_REJECTED' });
    phone.readiness.mockRejectedValue(new Error('down'));
    render(<MemoryRouter><ProviderReadinessStrip /></MemoryRouter>);
    expect(await screen.findByTestId('ci-provider-error')).toHaveTextContent('could not be read');
    expect(screen.queryByTestId('ci-provider')).toBeNull();
  });
});
