import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { accountFinderPlaces, searchAccountFinder, foldText, AccountFinder, type AccountFinderPlace } from './accountFinder';

const acc = (permissions: string[], subscriptionStatus = 'active') => ({ permissions, features: [], aiPackages: [], subscriptionStatus });
const ids = (ps: AccountFinderPlace[]) => ps.map((p) => p.id);

describe('Account Finder — places and gating (the sidebar gate, gateFor)', () => {
  it('lists ACCOUNT pages only when the person holds their keys; panels on the Account page are always listed', () => {
    const none = ids(accountFinderPlaces(acc([])));
    expect(none.filter((i) => !i.startsWith('panel-'))).toEqual([]);
    expect(none).toContain('panel-profile');
    const viewer = ids(accountFinderPlaces(acc(['settings.view'])));
    expect(viewer).toContain('acc-security');
    expect(viewer).toContain('acc-activity');
    expect(viewer).not.toContain('acc-invoices');        // needs subscription.manage too
    expect(viewer).not.toContain('team-members');        // needs technicians.edit + technicians.view
    const owner = ids(accountFinderPlaces(acc(['settings.view', 'subscription.manage', 'technicians.edit', 'technicians.view'])));
    expect(owner).toContain('acc-invoices');
    expect(owner).toContain('team-members');
    expect(owner.filter((i) => i === 'acc-billing')).toHaveLength(1);
    // a suspended salon opens no page (the sidebar says the same)
    expect(ids(accountFinderPlaces(acc(['settings.view'], 'suspended'))).filter((i) => !i.startsWith('panel-'))).toEqual([]);
  });

  it('search: every word must match title, description or keywords; title hits first; accents ignored', () => {
    const places: AccountFinderPlace[] = [
      { id: 'a', title: 'Hóa đơn', description: 'x', keywords: 'phí', to: { route: '/a' } },
      { id: 'b', title: 'Billing', description: 'payment method and invoices', keywords: '', to: { route: '/b' } },
      { id: 'c', title: 'Invoices', description: 'software', keywords: '', to: { route: '/c' } },
    ];
    expect(foldText('  Hóa   ĐƠN ')).toBe('hoa don');
    expect(ids(searchAccountFinder(places, 'hoa don'))).toEqual(['a']);
    expect(ids(searchAccountFinder(places, 'invoices'))).toEqual(['c', 'b']);   // title match ranks above description match
    expect(ids(searchAccountFinder(places, 'invoices software'))).toEqual(['c']);
    expect(searchAccountFinder(places, '   ')).toEqual([]);
  });

  it('a page hit navigates to that page; a phone number points to the Team directory search when permitted', () => {
    render(<MemoryRouter initialEntries={['/tenant/account/overview']}><Routes>
      <Route path="/tenant/account/overview" element={<AccountFinder access={acc(['settings.view', 'subscription.manage', 'technicians.edit', 'technicians.view'])} />} />
      <Route path="/tenant/account/invoices" element={<div data-testid="at-invoices" />} />
      <Route path="/tenant/team/members" element={<div data-testid="at-team" />} />
    </Routes></MemoryRouter>);
    fireEvent.change(screen.getByTestId('acx-finder-q'), { target: { value: '(415) 555' } });
    expect(screen.getByTestId('acx-finder-people')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('acx-finder-q'), { target: { value: 'invoices' } });
    expect(screen.queryByTestId('acx-finder-people')).toBeNull();   // a module match that is not a phone does not offer people search
    fireEvent.click(screen.getByTestId('acx-finder-hit-acc-invoices'));
    expect(screen.getByTestId('at-invoices')).toBeInTheDocument();
  });

  it('the people link opens the Team directory', () => {
    vi.clearAllMocks();
    render(<MemoryRouter initialEntries={['/x']}><Routes>
      <Route path="/x" element={<AccountFinder access={acc(['settings.view', 'technicians.edit', 'technicians.view'])} />} />
      <Route path="/tenant/team/members" element={<div data-testid="at-team" />} />
    </Routes></MemoryRouter>);
    fireEvent.change(screen.getByTestId('acx-finder-q'), { target: { value: 'Sophia Zzz' } });
    expect(screen.getByTestId('acx-finder-none')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('acx-finder-people'));
    expect(screen.getByTestId('at-team')).toBeInTheDocument();
  });
});
