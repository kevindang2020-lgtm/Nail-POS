// one-appointment-writer.vitest.spec — Oct 14 build plan §7 / Phase 3-J (Oct 21 2026): an appointment row is born in ONE
// place, AppointmentWriter (modules/appointments), which also writes its appointment.created. Any other INSERT into
// pos_tech_appointments in product code fails this test (specs, seeds and verify harnesses under apps/api/scripts insert fixtures).
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../..');
const ALLOWED = ['modules/appointments/src/appointments/appointment-writer.ts'];

describe('one appointment writer', () => {
  it('no product file inserts into pos_tech_appointments except AppointmentWriter', () => {
    const out = execSync(`grep -rlE "insertInto\\('pos_tech_appointments'\\)|INSERT INTO pos_tech_appointments" --include='*.ts' --include='*.mjs' modules/*/src apps/api/src || true`, { cwd: ROOT, encoding: 'utf8' });
    const offenders = out.split('\n').filter(Boolean).filter((f) => !/\.(spec|test)\.ts$/.test(f) && !/\/seed[^/]*\.ts$/.test(f) && !/scripts\/(seed|live-|drills)/.test(f)).filter((f) => !ALLOWED.includes(f));
    expect(offenders).toEqual([]);
  });
});
