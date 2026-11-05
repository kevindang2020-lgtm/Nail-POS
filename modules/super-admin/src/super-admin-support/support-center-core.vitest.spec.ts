import { describe, it, expect } from 'vitest';
import {
  isActiveTicket, isTerminalTicket, isUrgentPriority, slaStatusOf, sessionStatusOf, sessionAuditStatus,
  durationMinutes, distribution, avg, trendOf,
} from './support-center-core';

const MIN = 60000; const now = 1_000_000_000_000;

describe('support-center-core ticket vocab', () => {
  it('classifies active / terminal / urgent', () => {
    expect(isActiveTicket('in_progress')).toBe(true);
    expect(isActiveTicket('closed')).toBe(false);
    expect(isTerminalTicket('resolved')).toBe(true);
    expect(isUrgentPriority('critical')).toBe(true);
    expect(isUrgentPriority('high')).toBe(true);
    expect(isUrgentPriority('normal')).toBe(false);
  });
});

describe('support-center-core SLA derivation', () => {
  it('derives on_track / near_breach / breached from target + age', () => {
    expect(slaStatusOf('open', 60, now - 10 * MIN, now)).toBe('on_track');   // 10 of 60 min
    expect(slaStatusOf('open', 60, now - 50 * MIN, now)).toBe('near_breach'); // 50 of 60 (>80%)
    expect(slaStatusOf('open', 60, now - 70 * MIN, now)).toBe('breached');    // past target
  });
  it('pauses while waiting on customer and N/A for terminal / no-target', () => {
    expect(slaStatusOf('waiting_customer', 60, now - 999 * MIN, now)).toBe('paused');
    expect(slaStatusOf('resolved', 60, now - 999 * MIN, now)).toBe('not_applicable');
    expect(slaStatusOf('open', 0, now, now)).toBe('not_applicable');
  });
});

describe('support-center-core session derivation', () => {
  it('derives active / expiring_soon / expired / completed / revoked', () => {
    expect(sessionStatusOf(now + 30 * MIN, null, now)).toBe('active');
    expect(sessionStatusOf(now + 2 * MIN, null, now)).toBe('expiring_soon');
    expect(sessionStatusOf(now - MIN, null, now)).toBe('expired');
    expect(sessionStatusOf(now + 30 * MIN, now, now)).toBe('revoked');       // ended before expiry
    expect(sessionStatusOf(now, now + MIN, now)).toBe('completed');          // ended at/after expiry
  });
  it('maps audit status + computes duration', () => {
    expect(sessionAuditStatus('active')).toBe('Active');
    expect(sessionAuditStatus('revoked')).toBe('Revoked');
    expect(durationMinutes(now - 15 * MIN, now, now)).toBe(15);
    expect(durationMinutes(now - 15 * MIN, null, now)).toBe(15);   // still running
  });
});

describe('support-center-core rollups', () => {
  it('distribution reconciles', () => {
    const d = distribution([{ key: 'critical', count: 12 }, { key: 'high', count: 48 }, { key: 'medium', count: 78 }, { key: 'low', count: 48 }]);
    expect(d.total).toBe(186);
    expect(d.slices.reduce((a, s) => a + s.count, 0)).toBe(186);
    expect(d.slices[1].pct).toBe(25.8);
  });
  it('avg + business-semantic trends', () => {
    expect(avg([10, 12, 11])).toBe(11);
    expect(avg([])).toBeNull();
    expect(trendOf('slaBreaches', 2).favorable).toBe(false);      // more breaches is bad
    expect(trendOf('avgFirstResponseMin', -2).favorable).toBe(true); // faster is good
    expect(trendOf('resolvedToday', 32).favorable).toBe(true);
    expect(trendOf('auditedSessions', 5).favorable).toBeNull();   // monitored, neutral
  });
});
