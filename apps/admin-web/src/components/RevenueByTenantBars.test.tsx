import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RevenueByTenantBars } from './RevenueByTenantBars';

const rows = [
  { tenantId: 'a', salonName: 'Elite Beauty Group', monthlyCardVolume: 7253000, formattedMonthlyCardVolume: '$72,530', growthPercent: 18.6 },
  { tenantId: 'b', salonName: 'Glamour Studio', monthlyCardVolume: 4875200, formattedMonthlyCardVolume: '$48,752', growthPercent: -2.1 },
];

describe('RevenueByTenantBars', () => {
  it('renders a bar per tenant with its formatted revenue + growth', () => {
    render(<RevenueByTenantBars rows={rows} />);
    expect(screen.getByText('Elite Beauty Group')).toBeInTheDocument();
    expect(screen.getByText('$72,530')).toBeInTheDocument();
    expect(screen.getByText('▲18.6%')).toBeInTheDocument();
    expect(screen.getByText('▼2.1%')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows an honest empty state with no data', () => {
    render(<RevenueByTenantBars rows={[]} />);
    expect(screen.getByText('No tenant revenue yet.')).toBeInTheDocument();
  });

  it('fires onTenant when a bar is clicked', () => {
    const onTenant = vi.fn();
    render(<RevenueByTenantBars rows={rows} onTenant={onTenant} />);
    fireEvent.click(screen.getByText('Glamour Studio'));
    expect(onTenant).toHaveBeenCalledWith('b');
  });
});
