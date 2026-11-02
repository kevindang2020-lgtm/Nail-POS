import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
vi.mock('../api/superAdminApi', () => ({ superAdminApi: { platformSearch: vi.fn() } }));
import { superAdminApi } from '../api/superAdminApi';
import { PlatformSearchBox } from './PlatformSearchBox';

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname + l.search}</div>; }
const ui = () => render(<MemoryRouter initialEntries={['/dashboard']}><Routes><Route path="*" element={<><PlatformSearchBox /><Where /></>} /></Routes></MemoryRouter>);

describe('platform search box (Constitution 7 §140–§141)', () => {
  beforeEach(() => vi.clearAllMocks());
  it('shows the groups the server returned and opens the picked tenant', async () => {
    (superAdminApi.platformSearch as any).mockResolvedValue({ q: 'bel', hidden: ['support_ticket'], groups: [
      { kind: 'tenant', hits: [{ kind: 'tenant', id: 't1', title: 'Belle Palace Nails', subtitle: 'BELL01', tenantId: 't1' }] },
      { kind: 'branch', hits: [{ kind: 'branch', id: 'b1', title: 'Belle Downtown', subtitle: 'Belle Palace Nails', tenantId: 't1' }] },
    ] });
    ui();
    fireEvent.change(screen.getByLabelText('Platform search'), { target: { value: 'bel' } });
    const list = await screen.findByTestId('platform-search-results');
    expect(list).toHaveTextContent('Tenants');
    expect(list).toHaveTextContent('Branches');
    expect(list).not.toHaveTextContent('Support tickets');          // hidden by the server → absent
    fireEvent.click(screen.getByRole('option', { name: /^Belle Palace Nails/ }));   // the branch row mentions the salon in its subtitle
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/tenants?tenantId=t1'));
    expect(superAdminApi.platformSearch).toHaveBeenCalledWith('bel');
  });
  it('one character does not search; Enter still searches the Tenants list', async () => {
    ui();
    fireEvent.change(screen.getByLabelText('Platform search'), { target: { value: 'b' } });
    await new Promise((r) => setTimeout(r, 350));
    expect(superAdminApi.platformSearch).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText('Platform search'), { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/tenants?search=b'));
  });
});
