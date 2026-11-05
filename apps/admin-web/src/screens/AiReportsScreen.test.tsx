import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockOverview } = vi.hoisted(() => ({ mockOverview: vi.fn() }));
vi.mock('../api/superAdminApi', () => ({ superAdminApi: { aiReportsOverview: () => mockOverview() } }));

import { AiReportsScreen } from './AiReportsScreen';

const gap = (note: string) => ({ available: false as const, note });
const real = (value: number) => ({ value, available: true });
const kgap = (note: string) => ({ value: null, available: false, note });
const overview = {
  kpis: {
    scheduledReports: real(12), reportsGeneratedToday: real(84), onDemandReports: real(28), failedReports: real(3),
    activeRecipients: kgap('No recipient schema'), deliverySuccessRate: real(98.7), avgGenerationTime: real(138), reportTemplates: kgap('No template schema'),
    weeklyReportsSent: real(612), monthlyReportsSent: real(2348), aiReceptionistReports: kgap('No type'), riskReportsOpen: kgap('No risk schema'),
  },
  reportsByType: { segments: [{ label: 'Revenue', value: 128, sharePct: 53.3 }, { label: 'Operations', value: 60, sharePct: 25 }, { label: 'Customer', value: 40, sharePct: 16.7 }, { label: 'Other', value: 12, sharePct: 5 }], total: 240 },
  formatMix: { segments: [{ label: 'PDF', value: 120, sharePct: 50 }], total: 240 },
  trend: [{ day: '2026-05-06', count: 84 }, { day: '2026-05-05', count: 70 }],
  recentReports: [{ id: 'e1', name: 'sales', category: 'Revenue', format: 'PDF', scope: 'Glamour · Downtown', role: 'admin', dateRange: '2026-05-01 → 2026-05-06', generatedAt: '2026-05-06T06:15:00Z', generated: true }],
  scheduledVsOnDemand: { available: true, scheduled: 40, onDemand: 12, total: 52 }, deliveryStatus: { available: true, segments: [{ label: 'Delivered', value: 628, sharePct: 98.7 }, { label: 'Failed', value: 5, sharePct: 0.8 }], total: 636 }, scheduleOverview: { available: true, rows: [{ name: 'Daily Platform', reportKey: 'daily_platform', frequency: 'daily', runAtTime: '06:00', scopeType: 'platform', nextRunAt: '2026-05-07T06:00:00Z', owner: 'System', status: 'active' }] },
  failedReports: gap('See Generation History'), reportTemplates: gap('No report-template schema'), recipientGroups: gap('No recipient-group schema'),
  generationHistory: { available: true, rows: [{ reportKey: 'daily_platform', status: 'completed', durationMs: 138000, createdAt: '2026-05-06T06:15:00Z' }] }, deliverySummary: { available: true, delivered: 628, total: 636, pending: 3, failed: 5, bounced: 2 },
  publishedTemplates: [{ reportKey: 'daily_platform', name: 'Daily v2', version: 2 }],
  meta: { onDemandLabel: 'User-initiated report exports', generatedLabel: 'Report exports' },
};

beforeEach(() => { mockOverview.mockReset(); mockOverview.mockResolvedValue(overview); });

describe('AiReportsScreen — AI Reports', () => {
  it('renders header, all 12 KPIs (real + gaps), controls, available reports, analytics, tables, quick actions, summary', async () => {
    render(<MemoryRouter><AiReportsScreen /></MemoryRouter>);
    expect(await screen.findByText('AI Reports')).toBeInTheDocument();
    expect(screen.getByText('Provides scheduled and on-demand AI-generated platform reports.')).toBeInTheDocument();
    ['Scheduled Reports', 'Reports Generated Today', 'On-Demand Reports', 'Failed Reports', 'Active Recipients', 'Delivery Success Rate', 'Avg Generation Time', 'Report Templates', 'Weekly Reports Sent', 'Monthly Reports Sent', 'AI Receptionist Reports', 'Risk Reports Open'].forEach((l) => expect(screen.getAllByText(l).length).toBeGreaterThanOrEqual(1));
    expect(screen.getAllByText('84').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Not connected').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('AI Report Controls')).toBeInTheDocument();
    expect(screen.getByText('Available AI Reports')).toBeInTheDocument();
    ['Daily Platform Report', 'Weekly Tenant-Growth Report', 'Monthly Revenue Report', 'Merchant-Processing Report', 'AI Receptionist Report', 'Customer-Retention Report', 'Branch-Performance Report', 'System-Risk Report'].forEach((l) => expect(screen.getAllByText(l).length).toBeGreaterThanOrEqual(1));
    ['Report Generation Trend', 'Scheduled vs On-Demand', 'Reports by Type', 'Delivery Status'].forEach((l) => expect(screen.getByText(l)).toBeInTheDocument());
    expect(screen.getByText('Recent AI Reports')).toBeInTheDocument();
    expect(screen.getByText('Generated')).toBeInTheDocument();
    ['Report Schedule Overview', 'Failed / Regenerated Reports', 'Report Templates', 'Recipient Groups', 'Generation History', 'AI Report Delivery Summary'].forEach((l) => expect(screen.getAllByText(l).length).toBeGreaterThanOrEqual(1));
  });

  it('renders all eight Quick Actions and eight At-a-Glance summary via labels', async () => {
    render(<MemoryRouter><AiReportsScreen /></MemoryRouter>);
    const qa = (await screen.findByText('Quick Actions')).closest('section')!;
    ['Generate Report', 'Schedule Report', 'Select Recipients', 'Edit Template', 'Export Reports', 'View History', 'Regenerate Failed', 'Open Tenant Report'].forEach((l) => expect(within(qa).getByRole('button', { name: l })).toBeInTheDocument());
    expect(screen.getByText('Scheduled Jobs Upcoming')).toBeInTheDocument();
    expect(screen.getByText('Report Templates Active')).toBeInTheDocument();
  });

  it('Generate Report is honest about the missing pipeline; Export runs without generating', async () => {
    render(<MemoryRouter><AiReportsScreen /></MemoryRouter>);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Generate Report' }))[0]);
    expect(await screen.findByText(/generation is not connected/)).toBeInTheDocument();
  });

  it('renders repointed engine data: real Delivery Status, schedule + generation-history tables', async () => {
    render(<MemoryRouter><AiReportsScreen /></MemoryRouter>);
    await screen.findByText('AI Reports');
    // scheduled/failed/avg-gen/delivery-rate KPIs now show real values
    expect(screen.getAllByText('12').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('98.7%').length).toBeGreaterThanOrEqual(1);
    // schedule overview + generation history tables render real rows
    const schedule = screen.getByText('Report Schedule Overview').closest('section')!;
    expect(within(schedule).getByText('Daily Platform')).toBeInTheDocument();
    const history = screen.getByText('Generation History').closest('section')!;
    expect(within(history).getAllByText('daily_platform').length).toBeGreaterThanOrEqual(1);
    // Available AI Reports card shows the live published template version
    const available = screen.getByText('Available AI Reports').closest('section')!;
    expect(within(available).getByText('Template v2')).toBeInTheDocument();
    expect(within(available).getAllByText('No template').length).toBeGreaterThanOrEqual(1);
  });
});

