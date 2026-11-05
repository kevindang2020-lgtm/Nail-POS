/**
 * reminder-core.spec.ts — selection-window logic + message templating for appointment reminders.
 */
import { selectDueReminders, buildReminderMessage, reminderSubject, type ReminderCandidate } from './reminder-core';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

const HOUR = 3600_000;
const now = 1_700_000_000_000; // fixed epoch
const base = (over: Partial<ReminderCandidate> = {}): ReminderCandidate => ({
  appointmentId: 'a1', startsAtMs: now + 24 * HOUR, status: 'booked', channel: 'sms', address: '+15551234567', customerName: 'Mia', serviceName: 'Gel Mani', startLabel: 'Tue Jun 23, 2:30 PM', ...over,
});

function main(): void {
  console.log('\n== selectDueReminders (lead 24h, window 1h) ==');
  const opts = { leadMs: 24 * HOUR, windowMs: HOUR };

  check('in-window appt selected', selectDueReminders([base()], now, opts).length === 1);
  check('too-soon appt excluded', selectDueReminders([base({ startsAtMs: now + 12 * HOUR })], now, opts).length === 0);
  check('too-far appt excluded', selectDueReminders([base({ startsAtMs: now + 26 * HOUR })], now, opts).length === 0);
  check('window is half-open at upper bound', selectDueReminders([base({ startsAtMs: now + 25 * HOUR })], now, opts).length === 0);
  check('window includes lower bound', selectDueReminders([base({ startsAtMs: now + 24 * HOUR })], now, opts).length === 1);
  check('non-booked excluded', selectDueReminders([base({ status: 'cancelled' })], now, opts).length === 0);
  check('missing address excluded', selectDueReminders([base({ address: undefined })], now, opts).length === 0);
  check('already-sent excluded', selectDueReminders([base()], now, { ...opts, alreadySent: new Set(['a1']) }).length === 0);

  const many = [base({ appointmentId: 'a1' }), base({ appointmentId: 'a2', startsAtMs: now + 30 * HOUR }), base({ appointmentId: 'a3' })];
  check('mixed batch selects only due+unsent', selectDueReminders(many, now, { ...opts, alreadySent: new Set(['a3']) }).map((c) => c.appointmentId).join(',') === 'a1');

  console.log('\n== message templating ==');
  const m = buildReminderMessage(base());
  check('message names customer + service', m.includes('Mia') && m.includes('Gel Mani'));
  check('message has opt-out instruction', m.toUpperCase().includes('STOP'));
  check('email message omits STOP line', !buildReminderMessage(base(), 'Luxe', 'email').toUpperCase().includes('STOP'));
  check('message handles no name/service', !buildReminderMessage(base({ customerName: undefined, serviceName: undefined })).includes('undefined'));
  check('subject includes salon', reminderSubject('Luxe Nails').includes('Luxe Nails'));

  console.log(`\n──────────── ${pass}/${pass + fail} passed ────────────\n`);
  if (fail > 0) process.exit(1);
}

main();
