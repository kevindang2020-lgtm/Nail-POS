// SalonSwitcher.test.tsx — the control that makes one owner account work across many salons.
//
// Two things are being defended here:
//
//   1. **Switching is a server operation.** The client asks; the server verifies the membership and re-issues the
//      session. A refused switch must leave the owner exactly where they were — never optimistically moved.
//   2. **Nothing from the previous salon may survive the switch.** Stale data from Salon A rendered under Salon
//      B's name is a data-leak-shaped bug: it looks right and is wrong. The switch bumps an epoch every screen
//      keys on, and aborts in-flight requests from the salon we left.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const get = vi.fn();
const post = vi.fn();
vi.mock('../api/client', () => ({ api: { get: (p: string) => get(p), post: (p: string, b: any) => post(p, b) } }));

import { OwnerSalonProvider, useOwnerSalon } from './OwnerSalonContext';
import { SalonSwitcher } from './SalonSwitcher';

const T_LUXE = 'luxe-tenant-id';
const T_BELLE = 'belle-tenant-id';
const T_RADIANT = 'radiant-tenant-id';

const PORTFOLIO = {
  salons: [
    { salonId: T_LUXE, salonName: 'Luxe Nails & Spa', storeCode: 'LUXE01', status: 'active', selectable: true,
      accessLevel: 'owner', isPrimaryOwner: true,
      branches: [
        { branchId: 'b-downtown', name: 'Downtown', city: 'Marlton', state: 'NJ', isActive: true },
        { branchId: 'b-marlton', name: 'Marlton', city: 'Marlton', state: 'NJ', isActive: true },
      ] },
    { salonId: T_BELLE, salonName: 'Belle Palace', storeCode: 'BELLE01', status: 'active', selectable: true,
      accessLevel: 'manager', isPrimaryOwner: false,
      branches: [{ branchId: 'b-cherry', name: 'Cherry Hill', city: 'Cherry Hill', state: 'NJ', isActive: true }] },
    { salonId: T_RADIANT, salonName: 'Radiant Nail Bar', storeCode: 'RAD01', status: 'suspended', selectable: false,
      accessLevel: 'report_only', isPrimaryOwner: false,
      branches: [{ branchId: 'b-west', name: 'West End', city: 'Camden', state: 'NJ', isActive: true }] },
  ],
};

beforeEach(() => {
  // Favourites/recents live in localStorage. Without this, a salon visited in one test shows up under
  // "Recently Viewed" in the next — the same name renders twice and the failure looks like a product bug.
  try { localStorage.clear(); } catch { /* ignore */ }
  get.mockReset(); post.mockReset();
  get.mockImplementation(async (p: string) => {
    if (p === '/owner/portfolio') return PORTFOLIO;
    if (p === '/owner/context') return { activeSalonId: T_LUXE };
    return {};
  });
});

const ui = () => render(<OwnerSalonProvider><SalonSwitcher /></OwnerSalonProvider>);

describe('one login, every salon', () => {
  it('lists every salon the owner may enter, with their role at each', async () => {
    ui();
    fireEvent.click(await screen.findByRole('button', { name: /change salon/i }));
    const list = await screen.findByRole('listbox', { name: /your salons/i });

    expect(within(list).getByText('Luxe Nails & Spa')).toBeInTheDocument();
    expect(within(list).getByText('Belle Palace')).toBeInTheDocument();
    expect(within(list).getByText('Radiant Nail Bar')).toBeInTheDocument();

    // the role is shown PER SALON — owner at one, manager at another
    expect(within(list).getByText('OWNER')).toBeInTheDocument();
    expect(within(list).getByText('MANAGER')).toBeInTheDocument();
    expect(within(list).getByText('REPORTS ONLY')).toBeInTheDocument();
  });

  it('offers an All Salons portfolio view', async () => {
    ui();
    fireEvent.click(await screen.findByRole('button', { name: /change salon/i }));
    const list = await screen.findByRole('listbox', { name: /your salons/i });
    expect(within(list).getByText('All Salons')).toBeInTheDocument();
    expect(within(list).getByText('Portfolio overview')).toBeInTheDocument();
  });

  it('shows each salon\'s own Store Code — they are separate businesses', async () => {
    ui();
    fireEvent.click(await screen.findByRole('button', { name: /change salon/i }));
    expect(await screen.findByText(/LUXE01/)).toBeInTheDocument();
    expect(screen.getByText(/BELLE01/)).toBeInTheDocument();
  });

  it('lists locations for a salon that has more than one', async () => {
    ui();
    fireEvent.click(await screen.findByRole('button', { name: /change salon/i }));
    expect(await screen.findByText(/Downtown — Marlton/)).toBeInTheDocument();
    expect(screen.getByText(/^Marlton — Marlton/)).toBeInTheDocument();
  });

  it('search finds a salon by name, store code, or location', async () => {
    ui();
    fireEvent.click(await screen.findByRole('button', { name: /change salon/i }));
    fireEvent.change(await screen.findByLabelText('Search your salons'), { target: { value: 'cherry' } });
    const list = screen.getByRole('listbox', { name: /your salons/i });
    expect(within(list).getByText('Belle Palace')).toBeInTheDocument();
    // Luxe is filtered OUT of the list (the trigger button still names the active salon — that is correct)
    expect(within(list).queryByText('Luxe Nails & Spa')).toBeNull();
  });
});

describe('switching', () => {
  it('asks the SERVER to switch, and trusts the salon the server returns', async () => {
    post.mockResolvedValue({ activeSalonId: T_BELLE, salonName: 'Belle Palace' });
    ui();
    fireEvent.click(await screen.findByRole('button', { name: /change salon/i }));
    const list = await screen.findByRole('listbox', { name: /your salons/i });
    fireEvent.click(within(list).getByText('Belle Palace'));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/owner/context/switch', { salonId: T_BELLE, branchId: null }));
    // the header now reflects the salon the SERVER approved
    await waitFor(() => expect(screen.getByRole('button', { name: /Active salon: Belle Palace/i })).toBeInTheDocument());
  });

  it('can switch straight to a specific LOCATION', async () => {
    post.mockResolvedValue({ activeSalonId: T_LUXE, salonName: 'Luxe Nails & Spa' });
    ui();
    fireEvent.click(await screen.findByRole('button', { name: /change salon/i }));
    fireEvent.click(await screen.findByText(/^Marlton — Marlton/));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/owner/context/switch', { salonId: T_LUXE, branchId: 'b-marlton' }));
  });

  it('an INACTIVE salon is shown but cannot be selected', async () => {
    ui();
    fireEvent.click(await screen.findByRole('button', { name: /change salon/i }));
    const radiant = (await screen.findByText('Radiant Nail Bar')).closest('button')!;

    expect(radiant).toBeDisabled();                    // …but still listed: suspended ≠ deleted
    fireEvent.click(radiant);
    expect(post).not.toHaveBeenCalled();
  });

  it('A REFUSED SWITCH LEAVES THE OWNER WHERE THEY WERE — never optimistically moved', async () => {
    post.mockRejectedValue(new Error('That salon is not available for your account.'));
    ui();
    fireEvent.click(await screen.findByRole('button', { name: /change salon/i }));
    fireEvent.click(await screen.findByText('Belle Palace'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/not available for your account/i);
    // still on the original salon — the UI did not move ahead of the server
    expect(screen.getByRole('button', { name: /Active salon: Luxe Nails & Spa/i })).toBeInTheDocument();
  });
});

describe('nothing from the previous salon survives a switch', () => {
  function Probe() {
    const { epoch, activeSalon, canHere } = useOwnerSalon();
    return (
      <div>
        <span data-testid="epoch">{epoch}</span>
        <span data-testid="salon">{activeSalon?.salonName ?? '—'}</span>
        <span data-testid="payroll">{canHere('payroll') ? 'yes' : 'no'}</span>
      </div>
    );
  }

  it('the epoch bumps on every switch — every screen re-fetches for the new salon', async () => {
    post.mockResolvedValue({ activeSalonId: T_BELLE, salonName: 'Belle Palace' });
    render(<OwnerSalonProvider><SalonSwitcher /><Probe /></OwnerSalonProvider>);

    await waitFor(() => expect(screen.getByTestId('epoch').textContent).toBe('0'));

    fireEvent.click(screen.getByRole('button', { name: /change salon/i }));
    fireEvent.click(await screen.findByText('Belle Palace'));

    // a bumped epoch is what invalidates every cached screen — stale Salon A data under Salon B's name would be a
    // leak-shaped bug: it looks right and is wrong.
    await waitFor(() => expect(screen.getByTestId('epoch').textContent).toBe('1'));
  });

  it('PERMISSIONS FOLLOW THE SALON — owner at Luxe, manager at Belle', async () => {
    post.mockResolvedValue({ activeSalonId: T_BELLE, salonName: 'Belle Palace' });
    render(<OwnerSalonProvider><SalonSwitcher /><Probe /></OwnerSalonProvider>);

    // owner at Luxe → may run payroll
    await waitFor(() => expect(screen.getByTestId('payroll').textContent).toBe('yes'));

    fireEvent.click(screen.getByRole('button', { name: /change salon/i }));
    fireEvent.click(await screen.findByText('Belle Palace'));

    // manager at Belle → may NOT. Being an owner elsewhere buys nothing here.
    await waitFor(() => expect(screen.getByTestId('salon').textContent).toBe('Belle Palace'));
    expect(screen.getByTestId('payroll').textContent).toBe('no');
  });
});

describe('empty and error states', () => {
  it('an owner with no salons is told so plainly', async () => {
    get.mockImplementation(async (p: string) => (p === '/owner/portfolio' ? { salons: [] } : { activeSalonId: null }));
    ui();
    fireEvent.click(await screen.findByRole('button', { name: /change salon/i }));
    expect(await screen.findByText(/No salons are assigned to your account yet/i)).toBeInTheDocument();
  });

  it('a failed load surfaces an error rather than an empty list pretending to be the truth', async () => {
    get.mockRejectedValue(new Error('network'));
    ui();
    fireEvent.click(await screen.findByRole('button', { name: /change salon/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('favourites and recently viewed (reference image)', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });

  it('a salon can be PINNED, and pinned salons sort to the top', async () => {
    ui();
    fireEvent.click(await screen.findByRole('button', { name: /change salon/i }));

    // pin Belle Palace (second in the list)
    fireEvent.click(await screen.findByRole('button', { name: /Pin Belle Palace/i }));

    // it is now pinned…
    expect(await screen.findByRole('button', { name: /Unpin Belle Palace/i })).toHaveAttribute('aria-pressed', 'true');

    // …and it sorts above Luxe in the list
    const list = screen.getByRole('listbox', { name: /your salons/i });
    const names = within(list).getAllByText(/Luxe Nails & Spa|Belle Palace|Radiant Nail Bar/).map((n) => n.textContent);
    expect(names[0]).toBe('Belle Palace');
  });

  it('pinning is a device convenience — it can NEVER widen what the server authorized', async () => {
    // A salon id in localStorage grants nothing: only salons the server returned are ever rendered.
    try { localStorage.setItem('aps.owner.favoriteSalons', JSON.stringify(['a-salon-she-does-not-own'])); } catch { /* ignore */ }
    ui();
    fireEvent.click(await screen.findByRole('button', { name: /change salon/i }));

    const list = await screen.findByRole('listbox', { name: /your salons/i });
    expect(within(list).queryByText(/a-salon-she-does-not-own/)).toBeNull();
    expect(within(list).getAllByRole('option').length).toBeGreaterThan(0);   // only her real salons
  });

  it('switching a salon records it under RECENTLY VIEWED', async () => {
    post.mockResolvedValue({ activeSalonId: T_BELLE, salonName: 'Belle Palace' });
    ui();

    fireEvent.click(await screen.findByRole('button', { name: /change salon/i }));
    fireEvent.click(await screen.findByText('Belle Palace'));
    await waitFor(() => expect(post).toHaveBeenCalled());

    // reopen — Belle is now in Recently Viewed
    fireEvent.click(screen.getByRole('button', { name: /change salon/i }));
    expect(await screen.findByText('RECENTLY VIEWED')).toBeInTheDocument();
  });

  it('a REVOKED salon never reappears in Recently Viewed', async () => {
    // She visited it before; her membership has since been removed. The SERVER list is the authority — a
    // remembered id must not resurrect a salon she can no longer enter.
    try { localStorage.setItem('aps.owner.recentSalons', JSON.stringify(['a-revoked-salon'])); } catch { /* ignore */ }
    ui();
    fireEvent.click(await screen.findByRole('button', { name: /change salon/i }));

    await screen.findByRole('listbox', { name: /your salons/i });
    expect(screen.queryByText('RECENTLY VIEWED')).toBeNull();   // nothing recent SURVIVES the portfolio check
  });
});
