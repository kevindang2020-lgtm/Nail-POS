import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { QuickServiceCategoryPicker } from './QuickServiceCategoryPicker';

vi.mock('@aipowersalon/mobile-sdk/i18n', () => ({ getLanguage: () => 'en' }));

const renderPicker = (categories: string[], services: { category: string; name: string }[] = []) => {
  const onSelectCategory = vi.fn();
  render(
    <QuickServiceCategoryPicker
      categories={['__all__', ...categories]}
      services={services}
      activeCategory="__all__"
      onSelectCategory={onSelectCategory}
      allValue="__all__"
      allLabel="All Services"
    />,
  );
  return onSelectCategory;
};

describe('Receptionist quick category picker (tenant catalog only)', () => {
  it('shows published tenant categories as large tiles without an eight-category cap', () => {
    const categories = ['Manicure', 'Pedicure', 'Gel & Shellac', 'Acrylic Nails', 'Dip Powder', 'Nail Art', 'Waxing', 'Additional Services', 'Nail Repair', 'Kids Services'];
    const choose = renderPicker(categories, [{ category: 'Manicure', name: 'Gel Manicure' }]);
    expect(screen.getAllByTestId('category-tile')).toHaveLength(10);
    expect(screen.getByText('10 categories')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /🦶.*Pedicure/ }));
    expect(choose).toHaveBeenCalledWith('Pedicure');
  });

  it('scales past 100 tenant categories and searches categories not yet rendered', () => {
    const cats = Array.from({ length: 125 }, (_, i) => `Custom Category ${i + 1}`);
    const choose = renderPicker(cats, [{ category: cats[119], name: 'Sparkle Nail Design' }]);
    expect(screen.getAllByTestId('category-tile')).toHaveLength(40);
    fireEvent.click(screen.getByTestId('category-show-more'));
    expect(screen.getAllByTestId('category-tile')).toHaveLength(80);
    fireEvent.change(screen.getByTestId('category-search'), { target: { value: 'Sparkle Nail' } });
    expect(screen.getAllByTestId('category-tile')).toHaveLength(1);
    fireEvent.click(screen.getByText('Custom Category 120'));
    expect(choose).toHaveBeenCalledWith('Custom Category 120');
  });

  it('does not invent sample categories or services when the salon catalog is empty', () => {
    renderPicker([]);
    expect(screen.queryAllByTestId('category-tile')).toHaveLength(0);
    expect(screen.getByTestId('category-count')).toHaveTextContent('0 categories');
    expect(screen.getByTestId('category-all')).toBeVisible();
  });

  it('deduplicates the booking-state and catalog API category names case-insensitively', () => {
    renderPicker(['Manicure', 'manicure', 'Pedicure']);
    expect(screen.getAllByTestId('category-tile')).toHaveLength(2);
  });

  it('searches service names and leaves existing booking submission outside this presentation-only component', () => {
    const choose = renderPicker(['Manicure', 'Pedicure'], [{ category: 'Manicure', name: 'French Tip Deluxe' }]);
    fireEvent.change(screen.getByTestId('category-search'), { target: { value: 'french tip' } });
    expect(screen.getByText('Manicure')).toBeInTheDocument();
    expect(screen.queryByText('Pedicure')).toBeNull();
    fireEvent.click(screen.getByText('Manicure'));
    expect(choose).toHaveBeenCalledWith('Manicure');
  });
});
