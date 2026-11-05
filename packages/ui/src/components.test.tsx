import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  StatusBadge, KpiCard, MetricStrip, ProgressBar, HealthGauge, ChartCard, DataTable,
  EmptyState, LoadingSkeleton, ErrorState, PermissionGate, Pagination, PageHeader, Drawer, Modal,
} from './index';
import type { Column } from './index';

type Row = { name: string; amount: number };

describe('StatusBadge', () => {
  it('renders its label', () => {
    render(<StatusBadge tone="success">Active</StatusBadge>);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });
});

describe('KpiCard', () => {
  it('renders label, value and delta', () => {
    render(<KpiCard label="Today's Revenue" value="$5,287.30" delta="18.6% vs yesterday" deltaDirection="up" />);
    expect(screen.getByText("Today's Revenue")).toBeInTheDocument();
    expect(screen.getByText('$5,287.30')).toBeInTheDocument();
    expect(screen.getByText(/18.6% vs yesterday/)).toBeInTheDocument();
  });
});

describe('MetricStrip', () => {
  it('renders each metric', () => {
    render(<MetricStrip items={[{ label: 'Waiting', value: 14 }, { label: 'In Progress', value: 21 }]} />);
    expect(screen.getByText('Waiting')).toBeInTheDocument();
    expect(screen.getByText('21')).toBeInTheDocument();
  });
});

describe('ProgressBar', () => {
  it('clamps value into 0..100 and exposes aria', () => {
    render(<ProgressBar value={140} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  });
});

describe('HealthGauge', () => {
  it('renders the percentage', () => {
    render(<HealthGauge value={98.6} label="Overall Health" />);
    expect(screen.getByText('98.6%')).toBeInTheDocument();
    expect(screen.getByText('Overall Health')).toBeInTheDocument();
  });
});

describe('ChartCard', () => {
  it('renders title and children', () => {
    render(<ChartCard title="Revenue Trend"><div>chart</div></ChartCard>);
    expect(screen.getByText('Revenue Trend')).toBeInTheDocument();
    expect(screen.getByText('chart')).toBeInTheDocument();
  });
});

describe('DataTable', () => {
  const cols: Column<Row>[] = [
    { key: 'name', header: 'Name' },
    { key: 'amount', header: 'Amount', align: 'right', render: (r) => `$${r.amount}` },
  ];
  it('renders rows via columns and custom render', () => {
    render(<DataTable columns={cols} rows={[{ name: 'Lisa', amount: 95 }]} getRowKey={(r) => r.name} />);
    expect(screen.getByText('Lisa')).toBeInTheDocument();
    expect(screen.getByText('$95')).toBeInTheDocument();
  });
  it('shows an empty state when there are no rows', () => {
    render(<DataTable columns={cols} rows={[]} getRowKey={(r) => r.name} />);
    expect(screen.getByText('No records')).toBeInTheDocument();
  });
  it('fires onRowClick', () => {
    const onRowClick = vi.fn();
    render(<DataTable columns={cols} rows={[{ name: 'Amy', amount: 10 }]} getRowKey={(r) => r.name} onRowClick={onRowClick} />);
    fireEvent.click(screen.getByText('Amy'));
    expect(onRowClick).toHaveBeenCalledWith({ name: 'Amy', amount: 10 });
  });
});

describe('EmptyState / ErrorState / LoadingSkeleton', () => {
  it('EmptyState renders title + message', () => {
    render(<EmptyState title="Nothing here" message="Add your first item" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByText('Add your first item')).toBeInTheDocument();
  });
  it('ErrorState retry fires', () => {
    const onRetry = vi.fn();
    render(<ErrorState message="boom" onRetry={onRetry} />);
    fireEvent.click(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenCalled();
  });
  it('LoadingSkeleton marks busy', () => {
    const { container } = render(<LoadingSkeleton lines={2} />);
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
  });
});

describe('PermissionGate', () => {
  it('renders children when allowed, fallback when not', () => {
    const { rerender } = render(<PermissionGate allow={true} fallback={<span>denied</span>}><span>secret</span></PermissionGate>);
    expect(screen.getByText('secret')).toBeInTheDocument();
    rerender(<PermissionGate allow={false} fallback={<span>denied</span>}><span>secret</span></PermissionGate>);
    expect(screen.getByText('denied')).toBeInTheDocument();
  });
});

describe('Pagination', () => {
  it('disables Prev on first page and pages forward', () => {
    const onPage = vi.fn();
    render(<Pagination page={1} pageCount={3} onPage={onPage} />);
    expect((screen.getByText('Prev') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('Next'));
    expect(onPage).toHaveBeenCalledWith(2);
  });
});

describe('PageHeader', () => {
  it('renders title, subtitle and actions', () => {
    render(<PageHeader title="Branches" subtitle="24 active" actions={<button>Add</button>} />);
    expect(screen.getByText('Branches')).toBeInTheDocument();
    expect(screen.getByText('24 active')).toBeInTheDocument();
    expect(screen.getByText('Add')).toBeInTheDocument();
  });
});

describe('Drawer / Modal', () => {
  it('Drawer renders when open and closes on backdrop', () => {
    const onClose = vi.fn();
    render(<Drawer open title="Detail" onClose={onClose}><div>body</div></Drawer>);
    expect(screen.getByText('body')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalled();
  });
  it('Drawer renders nothing when closed', () => {
    render(<Drawer open={false} onClose={() => {}}><div>hidden</div></Drawer>);
    expect(screen.queryByText('hidden')).toBeNull();
  });
  it('Modal close button fires onClose', () => {
    const onClose = vi.fn();
    render(<Modal open title="Confirm" onClose={onClose}><div>q</div></Modal>);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });
});
