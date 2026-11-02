// alert-rules.vitest.spec — Constitution 11 §98–106.
import { describe, it, expect } from 'vitest';
import { severityFor, desiredAlerts, type ComponentState } from './alert-rules';

const c = (key: string, status: string, criticality: string, reason = 'x'): ComponentState =>
  ({ key, name: key.toUpperCase(), status, reason, criticality, owner: 'ops', runbook: `RUNBOOKS.md#${key}` }) as never;

describe('§98–101 severity follows impact', () => {
  it('critical outage is P1; important outage and critical degradation are P2', () => {
    expect(severityFor('OUTAGE', 'CRITICAL', 'x')).toBe('critical');
    expect(severityFor('OUTAGE', 'IMPORTANT', 'x')).toBe('high');
    expect(severityFor('DEGRADED', 'CRITICAL', 'x')).toBe('high');
  });
  it('§101: an optional provider (AI) down is P3, degraded is P4 — never a page-the-world event', () => {
    expect(severityFor('OUTAGE', 'OPTIONAL', 'x')).toBe('medium');
    expect(severityFor('DEGRADED', 'OPTIONAL', 'x')).toBe('low');
  });
  it('healthy and maintenance never alert (§105)', () => {
    expect(severityFor('HEALTHY', 'CRITICAL', 'ok')).toBeNull();
    expect(severityFor('MAINTENANCE', 'CRITICAL', 'x')).toBeNull();
  });
  it('UNKNOWN because IDLE is not an alert — payments at 3 a.m. are fine', () => {
    expect(severityFor('UNKNOWN', 'CRITICAL', 'no_provider_traffic')).toBeNull();
  });
  it('UNKNOWN because we CANNOT SEE a critical component IS an alert', () => {
    expect(severityFor('UNKNOWN', 'CRITICAL', 'not_measured')).toBe('high');
    expect(severityFor('UNKNOWN', 'IMPORTANT', 'not_measured')).toBeNull();
  });
});

describe('§104 one root cause, one alert', () => {
  it('a database outage pages ONCE — the API, booking and checkout failures it causes do not page separately', () => {
    const a = desiredAlerts([c('database', 'OUTAGE', 'CRITICAL'), c('api', 'OUTAGE', 'CRITICAL'), c('booking', 'OUTAGE', 'CRITICAL'), c('checkout', 'DEGRADED', 'CRITICAL')]);
    expect(a.map((x) => x.component)).toEqual(['database']);
  });
  it('the root-cause alert names what it is taking down', () => {
    const [db] = desiredAlerts([c('database', 'OUTAGE', 'CRITICAL'), c('api', 'OUTAGE', 'CRITICAL'), c('booking', 'OUTAGE', 'CRITICAL')]);
    expect(db.causes).toEqual(['API', 'BOOKING']);
    expect(db.message).toMatch(/Also affecting: API, BOOKING/);
  });
  it('a symptom of a degraded database is suppressed too, not only of an outage', () => {
    expect(desiredAlerts([c('database', 'DEGRADED', 'CRITICAL'), c('booking', 'OUTAGE', 'CRITICAL')]).map((x) => x.component)).toEqual(['database']);
  });
  it('grouping is TRANSITIVE — a component reaching the root only through an intermediate is attributed to the root', () => {
    // My earlier test of this name did not test it: every dependent in DEPENDS_ON lists `database` DIRECTLY, so making
    // the walk non-transitive changed nothing and the mutation survived. This chain has no shortcut: a → b → c.
    const chain = { a: ['b'], b: ['c'] };
    const out = desiredAlerts([c('c', 'OUTAGE', 'CRITICAL'), c('b', 'OUTAGE', 'CRITICAL'), c('a', 'OUTAGE', 'CRITICAL')], chain);
    expect(out.map((x) => x.component)).toEqual(['c']);
    expect(out[0].causes).toEqual(['A', 'B']);
  });
  it('a symptom with a HEALTHY dependency alerts on its own — booking failing while the database is fine is a booking problem', () => {
    expect(desiredAlerts([c('database', 'HEALTHY', 'CRITICAL'), c('api', 'HEALTHY', 'CRITICAL'), c('booking', 'OUTAGE', 'CRITICAL')]).map((x) => x.component)).toEqual(['booking']);
  });
  it('unrelated failures each alert — suppression is by dependency, not by "something else is also broken"', () => {
    expect(desiredAlerts([c('database', 'OUTAGE', 'CRITICAL'), c('ai', 'OUTAGE', 'OPTIONAL')]).map((x) => x.component).sort()).toEqual(['ai', 'database']);
  });
});

describe('§102 / §177 every alert is actionable and owned', () => {
  it('carries owner and runbook, and puts both in the message a human reads', () => {
    const [a] = desiredAlerts([c('payments', 'OUTAGE', 'CRITICAL', 'outage:cardpointe')]);
    expect(a.owner).toBe('ops');
    expect(a.runbook).toBe('RUNBOOKS.md#payments');
    expect(a.message).toMatch(/Runbook: RUNBOOKS\.md#payments/);
    expect(a.message).toMatch(/reason: outage:cardpointe/);
  });
  it('orders the most severe first', () => {
    expect(desiredAlerts([c('ai', 'DEGRADED', 'OPTIONAL'), c('payments', 'OUTAGE', 'CRITICAL')]).map((x) => x.severity)).toEqual(['critical', 'low']);
  });
});
