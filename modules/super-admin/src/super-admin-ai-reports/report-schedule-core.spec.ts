import { parseTime, computeNextRunAt, buildScheduleOccurrenceKey, validateScheduleInput, canScheduleTransition } from './report-schedule-core';
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const iso = (ms: number | null) => ms == null ? 'null' : new Date(ms).toISOString();
// parseTime
ok(!!parseTime('06:00'), '06:00 valid'); ok(!parseTime('25:00'), '25:00 invalid'); ok(!parseTime('6am'), 'text invalid');
// daily: from just after 06:00 → next day 06:00
{ const from = Date.parse('2026-05-06T06:30:00Z'); ok(iso(computeNextRunAt('daily', '06:00', from)) === '2026-05-07T06:00:00.000Z', 'daily rolls to next day'); }
{ const from = Date.parse('2026-05-06T05:30:00Z'); ok(iso(computeNextRunAt('daily', '06:00', from)) === '2026-05-06T06:00:00.000Z', 'daily same day if before time'); }
// weekly steps 7 days
{ const from = Date.parse('2026-05-06T07:00:00Z'); const next = computeNextRunAt('weekly', '06:00', from); ok(next! > from && (next! - from) <= 7 * 86400000, 'weekly within 7 days'); }
// monthly → 1st of month
{ const from = Date.parse('2026-05-06T07:00:00Z'); ok(iso(computeNextRunAt('monthly', '08:00', from)) === '2026-06-01T08:00:00.000Z', 'monthly next 1st'); }
{ const from = Date.parse('2026-05-06T07:00:00Z'); ok(iso(computeNextRunAt('quarterly', '08:00', from)) === '2026-08-01T08:00:00.000Z', 'quarterly +3 months'); }
ok(computeNextRunAt('bogus', '06:00', Date.now()) === null, 'bad frequency → null');
// occurrence key stable + occurrence-sensitive
{ const a = buildScheduleOccurrenceKey('s1', '2026-05-06T06:00:00Z'); const b = buildScheduleOccurrenceKey('s1', '2026-05-06T06:00:00.000Z'); ok(a === b, 'same occurrence → same key'); ok(a !== buildScheduleOccurrenceKey('s1', '2026-05-07T06:00:00Z'), 'different occurrence → different key'); }
// validate
const now = Date.parse('2026-05-06T00:00:00Z');
ok(validateScheduleInput({ name: 'Daily', reportKey: 'daily_platform', frequency: 'daily', runAtTime: '06:00', nowMs: now }).ok, 'valid schedule');
ok(!validateScheduleInput({ name: '', reportKey: 'x', frequency: 'daily', runAtTime: '06:00', nowMs: now }).ok, 'name required');
ok(!validateScheduleInput({ name: 'x', reportKey: 'x', frequency: 'hourly', runAtTime: '06:00', nowMs: now }).ok, 'bad frequency');
ok(!validateScheduleInput({ name: 'x', reportKey: 'x', frequency: 'daily', runAtTime: '6', nowMs: now }).ok, 'bad time');
ok(!validateScheduleInput({ name: 'x', reportKey: 'x', frequency: 'daily', runAtTime: '06:00', startMs: now - 86400000, nowMs: now }).ok, 'past start rejected');
// status machine
ok(canScheduleTransition('active', 'paused'), 'active→paused'); ok(canScheduleTransition('paused', 'active'), 'paused→active resume');
ok(!canScheduleTransition('disabled', 'active'), 'disabled cannot resume'); ok(!canScheduleTransition('archived', 'active'), 'archived terminal');
console.log(`report-schedule-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
