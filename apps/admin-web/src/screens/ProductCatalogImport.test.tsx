import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { parseCsv, ImportProductsModal } from './ProductCatalogImport';

const createProductImport = vi.fn();
vi.mock('../api/superAdminApi', () => ({ superAdminApi: { createProductImport: (...a: any[]) => createProductImport(...a) } }));

describe('parseCsv', () => {
  it('parses rows, skips a header, converts dollars to cents', () => {
    const rows = parseCsv('name,category,sku,price\nCuticle Oil, Nail Care, CND-CO-15, 8.99\nGel Polish, Gel Polish, OPI-GP-RR, 14.99');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'Cuticle Oil', categoryName: 'Nail Care', sku: 'CND-CO-15', priceCents: 899 });
    expect(rows[1].priceCents).toBe(1499);
  });
  it('handles empty input', () => { expect(parseCsv('')).toEqual([]); });
});

describe('ImportProductsModal', () => {
  beforeEach(() => { createProductImport.mockReset(); createProductImport.mockResolvedValue({ ok: true, job: { id: 'PIMP-0001', filename: 'v.csv', validRows: 1, invalidRows: 1, totalRows: 2 }, deduped: false }); });

  it('requires at least one row', () => {
    render(<ImportProductsModal onClose={() => {}} onStaged={() => {}} />);
    fireEvent.click(screen.getByText('Stage & validate'));
    expect(screen.getByText(/Add at least one row/)).toBeInTheDocument();
    expect(createProductImport).not.toHaveBeenCalled();
  });

  it('stages parsed rows and reports the result', async () => {
    const onStaged = vi.fn();
    render(<ImportProductsModal onClose={() => {}} onStaged={onStaged} />);
    fireEvent.change(screen.getByLabelText('File name'), { target: { value: 'v.csv' } });
    fireEvent.change(screen.getByLabelText(/Rows/), { target: { value: 'Cuticle Oil, Nail Care, CND-CO-15, 8.99\nBad,,,-5' } });
    fireEvent.click(screen.getByText('Stage & validate'));
    await waitFor(() => expect(createProductImport).toHaveBeenCalledWith(expect.objectContaining({ filename: 'v.csv', rows: expect.arrayContaining([expect.objectContaining({ name: 'Cuticle Oil' })]) })));
    await waitFor(() => expect(onStaged).toHaveBeenCalled());
  });
});
