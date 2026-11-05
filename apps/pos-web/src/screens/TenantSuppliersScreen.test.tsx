import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TenantSuppliersScreen } from './TenantSuppliersScreen';

const payload = {
  vendors: [{ id: 'v1', name: 'Acme Beauty Supply', contact_name: 'Jane Doe', phone: '555-1212', email: 'jane@acme.com', website: 'acme.com', account_number: 'A-100', payment_terms: 'Net 30', lead_time_days: 5 }],
  purchaseOrders: [{ id: 'po1', po_number: 'PO-1001', status: 'pending', vendor_name: 'Acme Beauty Supply', expected_date: '2026-05-20', total_cents: 45000 }],
  brands: [{ id: 'b1', name: 'OPI', active: true }],
};
const mockFetch = (state: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => state, headers: { get: () => null } } as any));

beforeEach(() => { vi.restoreAllMocks(); });

describe('TenantSuppliersScreen', () => {
  it('renders the supplier directory, KPIs, and purchase orders from real data', async () => {
    globalThis.fetch = mockFetch(payload) as any;
    render(<MemoryRouter><TenantSuppliersScreen /></MemoryRouter>);
    expect(await screen.findByText('Suppliers')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add Supplier' })).toBeInTheDocument();
    expect(screen.getByText('Total Suppliers')).toBeInTheDocument();
    expect(screen.getByText('Supplier Directory')).toBeInTheDocument();
    expect(screen.getByText('Purchase Orders')).toBeInTheDocument();
    expect(screen.getAllByText('Acme Beauty Supply').length).toBeGreaterThanOrEqual(1);
  });

  it('opens the Add Supplier form', async () => {
    globalThis.fetch = mockFetch(payload) as any;
    render(<MemoryRouter><TenantSuppliersScreen /></MemoryRouter>);
    await screen.findByText('Suppliers');
    fireEvent.click(screen.getByRole('button', { name: '+ Add Supplier' }));
    expect(screen.getByText('Add Supplier')).toBeInTheDocument();
    expect(screen.getByText('Payment terms')).toBeInTheDocument();
  });

  it('shows an empty state when there are no suppliers', async () => {
    globalThis.fetch = mockFetch({ vendors: [], purchaseOrders: [], brands: [] }) as any;
    render(<MemoryRouter><TenantSuppliersScreen /></MemoryRouter>);
    expect(await screen.findByText('No suppliers yet.')).toBeInTheDocument();
  });
});
