// SchedInsightsCard — round 10 (AI Scheduling Optimizer 05 · 11): an open staffing insight shows the server's coverage by hour and
// by service category (confirmed bookings only); other kinds show nothing extra; nothing is recomputed on the device.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
const api = vi.hoisted(() => ({ insights: vi.fn(), decideInsight: vi.fn(), refreshInsights: vi.fn() }));
vi.mock('../../api/posAiSchedulingOptimizerApi', () => ({ posAiSchedulingOptimizerApi: api }));
import { SchedInsightsCard } from './SchedInsightsCard';

describe('SchedInsightsCard — coverage by hour and service type', () => {
  it('renders each hour with its state and each service type with booked vs qualified minutes', async () => {
    api.insights.mockImplementation(async (q: any) => (q.kind !== 'staffing' ? { items: [], total: 0 } : { total: 1, items: [{
      kind: 'staffing', id: 's1', branchId: 'b1', date: '2026-10-27', startTime: null, endTime: null, state: 'understaffed', missingMinutes: 60, missingSkills: [], recommendedAction: null, recommendedActionCoded: null,
      confidence: 0.8, status: 'review_required', version: 1, createdAt: '2026-10-26T12:00:00Z',
      coverage: { basis: 'confirmed_bookings_only', byHour: [{ hour: 9, demandMinutes: 90, capacityMinutes: 60, state: 'severely_understaffed', missingMinutes: 30 }, { hour: 10, demandMinutes: 30, capacityMinutes: 60, state: 'adequately_staffed', missingMinutes: 0 }],
        byCategory: [{ category: 'Lashes', demandMinutes: 180, capacityMinutes: 120, qualifiedTechnicians: 1, state: 'severely_understaffed', missingMinutes: 60 }] } }] }));
    render(<SchedInsightsCard tick={0} can={() => true} techName={() => 'Tech'} onChanged={() => undefined} services={[]} />);
    fireEvent.click(await screen.findByRole('tab', { name: /staffing/i }));
    const hours = await screen.findAllByTestId('sched-cov-hour');
    expect(hours.map((h) => h.textContent!.slice(0, 6))).toEqual(['09:00 ', '10:00 ']);
    expect(hours[0].textContent).toMatch(/short-staffed/i); expect(hours[1].textContent).not.toMatch(/short/i);
    expect(hours[0].getAttribute('title')).toBe('90 booked min · 60 scheduled min');
    expect(screen.getByTestId('sched-cov-cat').textContent).toMatch(/^Lashes: 180 booked min · 120 min from 1 qualified technicians \(.*short-staffed\)$/i);
    expect(screen.getByTestId('sched-coverage').textContent).toMatch(/no forecast is spread over the hours/);
  });
});
