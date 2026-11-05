import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReportSummaryInner } from './ReportSummaryInner';

describe('ReportSummaryInner (iPad report view)', () => {
  it('renders KPI cards and a table from the real, already-loaded report data', () => {
    render(<ReportSummaryInner data={{
      periodLabel: 'This Month · May 2026',
      kpis: [
        { label: 'Gross Revenue', value: '$12,480.00', delta: '▲ 12.6%', deltaUp: true },
        { label: 'Net Revenue', value: '$10,910.00' },
      ],
      columns: ['Service', 'Revenue', 'Count'],
      rows: [
        ['Gel Manicure', '$4,500.00', 90],
        ['Acrylic Full Set', '$3,200.00', 40],
      ],
    }} />);
    expect(screen.getByText('This Month · May 2026')).toBeTruthy();
    expect(screen.getByText('Gross Revenue')).toBeTruthy();
    expect(screen.getByText('$12,480.00')).toBeTruthy();
    expect(screen.getByText('▲ 12.6%')).toBeTruthy();
    expect(screen.getByText('Service')).toBeTruthy();          // column header
    expect(screen.getByText('Gel Manicure')).toBeTruthy();     // row cell
    expect(screen.getByText('$3,200.00')).toBeTruthy();
  });

  it('shows an empty message when there is no data', () => {
    render(<ReportSummaryInner data={{}} />);
    expect(screen.getByText('No report data for this period.')).toBeTruthy();
  });
});
