// CatalogConfigModals.test.tsx — SCAN (Oct 12 2026): "Organize categories" cleared the typed name even when the create
// failed (the helper swallowed the error and resolved anyway), so the owner had to retype it after reading the error.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const create = vi.fn();
vi.mock('../api/superAdminApi', () => ({ superAdminApi: {
  catalogCategories: vi.fn(async () => []),
  catalogCategoryCreate: (b: any) => create(b),
  catalogCategoryUpdate: vi.fn(),
} }));
import { OrganizeCategoriesModal } from './CatalogConfigModals';

describe('OrganizeCategoriesModal', () => {
  it('a failed create keeps the typed name and shows why; a successful one clears it', async () => {
    render(<OrganizeCategoriesModal onClose={() => {}} onChanged={() => {}} />);
    const input = screen.getByPlaceholderText('New category name') as HTMLInputElement;
    create.mockRejectedValueOnce(new Error('A category with that name exists.'));
    fireEvent.change(input, { target: { value: 'Dip Powder' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('A category with that name exists.')).toBeInTheDocument();
    expect(input.value).toBe('Dip Powder');
    create.mockResolvedValueOnce([{ code: 'dip', name: 'Dip Powder', status: 'active', sortOrder: 1 }]);
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(input.value).toBe(''));
  });
});
