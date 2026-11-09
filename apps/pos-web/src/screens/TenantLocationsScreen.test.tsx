import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TenantLocationsScreen } from './TenantLocationsScreen';
import { posLocationsApi } from '../api/posLocationsApi';

vi.mock('./locations/SalonLocationMapEditor', () => ({ SalonLocationMapEditor: () => null }));
vi.mock('../api/posLocationsApi', () => ({ posLocationsApi: { page: vi.fn(), list: vi.fn(), create: vi.fn(), publish: vi.fn(), unpublish: vi.fn() } }));

const loc = (id: string, name: string) => ({ id, tenant_id: 't', name, public_display_name: null, salon_code: null, formatted_address: null, address: '1 Main', city: 'Houston', state: 'TX', zip: null, latitude: null, longitude: null, map_pin_confirmed_at: null, verification_status: 'draft', is_public: false, is_online_booking_enabled: true });
const summary = { total: 12, active: 11, published: 2, unverified: 10, missingPins: 4, acceptingBookings: 9 };

beforeEach(() => {
  vi.mocked(posLocationsApi.page).mockReset();
  vi.mocked(posLocationsApi.page).mockImplementation(async (q) => ({ locations: q.page === 2 ? [loc('k', 'Late')] : [loc('a', 'Newest'), loc('b', 'Older')], summary, page: q.page, pageSize: 10, total: 12, totalPages: 2 }) as never);
});

describe('TenantLocationsScreen — Nov 9 2026 guide', () => {
  it('asks the server for page 1 newest-first, keeps the six KPIs over every branch, and pages', async () => {
    render(<TenantLocationsScreen />);
    expect(await screen.findByText('Newest')).toBeInTheDocument();
    expect(posLocationsApi.page).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 10, sort: 'newest' }));
    expect(screen.getAllByTestId(/^loc-kpi-/)).toHaveLength(6);
    expect(screen.getByTestId('loc-kpi-total').textContent).toContain('12');
    fireEvent.click(screen.getByText('2', { selector: 'button.fk-pbtn' }));
    expect(await screen.findByText('Late')).toBeInTheDocument();
  });
  it('search, a KPI tap and a filter all go to the server and reset to page 1', async () => {
    render(<TenantLocationsScreen />);
    await screen.findByText('Newest');
    fireEvent.change(screen.getByTestId('loc-search'), { target: { value: 'houston' } });
    fireEvent.click(screen.getByTestId('loc-search-btn'));
    await waitFor(() => expect(posLocationsApi.page).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'houston', page: 1 })));
    fireEvent.click(screen.getByTestId('loc-kpi-pins'));
    await waitFor(() => expect(posLocationsApi.page).toHaveBeenLastCalledWith(expect.objectContaining({ map: 'missing_pin', page: 1 })));
    expect(screen.getByTestId('loc-clear')).toBeInTheDocument();
  });
  it('a failed unpublish shows the error instead of throwing', async () => {
    vi.mocked(posLocationsApi.page).mockResolvedValue({ locations: [{ ...loc('p', 'Pub'), is_public: true, verification_status: 'verified' }], summary, page: 1, pageSize: 10, total: 1, totalPages: 1 } as never);
    vi.mocked(posLocationsApi.unpublish).mockRejectedValue(new Error('Nope'));
    render(<TenantLocationsScreen />);
    fireEvent.click(await screen.findByText('Unpublish'));
    expect(await screen.findByText('Nope')).toBeInTheDocument();
  });
});
