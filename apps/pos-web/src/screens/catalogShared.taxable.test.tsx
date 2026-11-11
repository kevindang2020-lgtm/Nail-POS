// catalogShared.taxable.test — D2 Services (Nov 4 2026): the service dialog stores "taxable / not taxable" through the service's
// tax route; nothing is sent when it does not change; the hint says it applies to new tickets only.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { svc, cat } = vi.hoisted(() => ({ svc: { update: vi.fn(), create: vi.fn(), setTaxable: vi.fn(), list: vi.fn() }, cat: { updatePricing: vi.fn() } }));
vi.mock('../api/posServicesApi', () => ({ posServicesApi: svc }));
vi.mock('../api/posCatalogApi', () => ({ posCatalogApi: cat }));
import { ServiceDialog } from './catalogShared';

const service = { serviceId: 's1', name: 'Gift wrap', categoryId: 'c1', priceCents: 1000, durationMinutes: 5, status: 'active', onlineBookable: false, aiBookable: false, taxable: true };
const categories = [{ categoryId: 'c1', name: 'Extras' }];
beforeEach(() => { Object.values(svc).forEach((f) => f.mockReset()); svc.update.mockResolvedValue({}); svc.setTaxable.mockResolvedValue({ isTaxable: false }); svc.create.mockResolvedValue({ serviceId: 's2' }); svc.list.mockResolvedValue({ items: [] }); });

describe('service dialog — taxable', () => {
  it('unchecking Taxable stores it for this service and explains it applies to new tickets', async () => {
    const onSaved = vi.fn();
    render(<ServiceDialog service={service} categories={categories} onClose={() => {}} onSaved={onSaved} />);
    fireEvent.click(screen.getByTestId('service-taxable'));
    expect(screen.getByTestId('service-taxable-hint').textContent).toMatch(/from now on/);
    fireEvent.click(screen.getByTestId('service-save'));
    await waitFor(() => expect(svc.setTaxable).toHaveBeenCalledWith('s1', false));
    expect(onSaved).toHaveBeenCalled();
  });
  it('an unchanged setting sends nothing to the tax route', async () => {
    render(<ServiceDialog service={service} categories={categories} onClose={() => {}} onSaved={() => {}} />);
    fireEvent.click(screen.getByTestId('service-save'));
    await waitFor(() => expect(svc.update).toHaveBeenCalled());
    expect(svc.setTaxable).not.toHaveBeenCalled();
  });
  it('a new service created as not taxable stores it right after creation', async () => {
    render(<ServiceDialog service={null} categories={categories} onClose={() => {}} onSaved={() => {}} />);
    fireEvent.change(screen.getByTestId('service-name'), { target: { value: 'Bag' } });
    fireEvent.change(screen.getByTestId('service-price'), { target: { value: '3.00' } });
    fireEvent.change(screen.getByTestId('service-duration'), { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('service-taxable'));
    fireEvent.click(screen.getByTestId('service-save'));
    await waitFor(() => expect(svc.setTaxable).toHaveBeenCalledWith('s2', false));
  });
  it('Duplicate Service / Name Review: a look-alike name warns (with its category) but Save still works', async () => {
    svc.list.mockResolvedValue({ items: [{ serviceId: 's9', serviceName: 'Gel Manicure', categoryName: 'Nails' }] });
    render(<ServiceDialog service={null} categories={categories} onClose={() => {}} onSaved={() => {}} />);
    fireEvent.change(screen.getByTestId('service-name'), { target: { value: 'gel manicur' } });
    expect(await screen.findByTestId('service-lookalike', {}, { timeout: 2000 })).toHaveTextContent('Gel Manicure (Nails)');
    expect(screen.getByTestId('service-save')).not.toBeDisabled();
    expect(svc.list).toHaveBeenCalledWith(expect.objectContaining({ search: 'manicur', pageSize: 100 }));
  });
  it('editing without renaming does not look for duplicates', async () => {
    render(<ServiceDialog service={service} categories={categories} onClose={() => {}} onSaved={() => {}} />);
    await new Promise((r) => setTimeout(r, 600));
    expect(svc.list).not.toHaveBeenCalled();
  });
});
