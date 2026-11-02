// noshow-risk.vitest.spec.ts — risk service over a fake source.
import { describe, it, expect } from 'vitest';
import { NoShowRiskService, InMemoryNoShowSource, NOSHOW_MODEL_VERSION, type UpcomingAppointmentRisk } from './noshow-risk.service';
import { AiForecastError, type AiForecastContext } from './ai-analytics-forecasting.dto';
import type { RiskFeatures } from './noshow-risk.core';

const feat = (o: Partial<RiskFeatures>): RiskFeatures => ({
  totalPriorAppointments: 6, priorNoShows: 0, priorLateCancellations: 0, bookingLeadTimeDays: 2,
  confirmationRequired: true, confirmed: true, depositOnFile: true, reminderRecentlyDelivered: true, groupSize: 1, ...o,
});
const appt = (id: string, features: Partial<RiskFeatures>): UpcomingAppointmentRisk => ({
  appointmentId: id, customerId: 'c' + id, customerName: 'Cust ' + id, startTime: '2026-07-10T15:00:00.000Z', features: feat(features),
});
const ctx = (o: Partial<AiForecastContext> = {}): AiForecastContext => ({
  tenantId: 'T1', branchId: 'B1', userId: 'U1', role: 'OWNER', permissions: ['reports.view'], ...o,
});

function svc(rows: UpcomingAppointmentRisk[]) {
  const src = new InMemoryNoShowSource();
  src.seed('T1', 'B1', rows);
  src.seed('T2', 'B1', [appt('t2', { priorNoShows: 9, totalPriorAppointments: 9 })]);
  return { svc: new NoShowRiskService(src), src };
}

describe('gate + validation', () => {
  it('requires reports.view (authorized operational users only)', async () => {
    await expect(svc([appt('a', {})]).svc.getUpcomingRisk(ctx({ permissions: [] }))).rejects.toBeInstanceOf(AiForecastError);
  });
  it('bounds the day window', async () => {
    await expect(svc([appt('a', {})]).svc.getUpcomingRisk(ctx(), 90)).rejects.toMatchObject({ code: 'INVALID_HORIZON' });
  });
});

describe('scoring + ordering', () => {
  it('sorts riskiest first and carries a model version + disclaimer', async () => {
    const out = await svc([
      appt('safe', {}),
      appt('risky', { priorNoShows: 4, totalPriorAppointments: 6, confirmed: false, depositOnFile: false, bookingLeadTimeDays: 30 }),
    ]).svc.getUpcomingRisk(ctx());
    expect(out.items[0].appointmentId).toBe('risky');
    expect(['high', 'very_high']).toContain(out.items[0].level);
    expect(out.modelVersion).toBe(NOSHOW_MODEL_VERSION);
    expect(out.disclaimer).toMatch(/no sensitive attributes/i);
  });
  it('only ever suggests non-punitive actions', async () => {
    const out = await svc([appt('risky', { priorNoShows: 5, totalPriorAppointments: 5, confirmed: false, depositOnFile: false })]).svc.getUpcomingRisk(ctx());
    expect(out.items[0].permittedActions.join(' ').toLowerCase()).not.toMatch(/cancel|block|penal|ban/);
  });
});

describe('isolation', () => {
  it('scores only ctx tenant/branch appointments', async () => {
    const { svc: s, src } = svc([appt('a', {})]);
    const out = await s.getUpcomingRisk(ctx({ tenantId: 'T1' }));
    expect(src.lastCtx!.tenantId).toBe('T1');
    expect(out.items.some((i) => i.appointmentId === 't2')).toBe(false);
  });
});
