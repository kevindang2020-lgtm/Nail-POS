/**
 * call-intelligence-core.spec.ts — runnable assertions: idempotent record (no duplicate per provider call),
 * summary math (calls handled / missed / recovered / call-to-booking rate), and tenant isolation.
 */
import { summarize, type CallEventRow } from './call-intelligence.dto';
import { InMemoryCallIntelRepo } from './call-intelligence.repository';
import { CallIntelligenceService } from './call-intelligence.service';

let pass = 0, fail = 0;
function check(n: string, c: boolean): void { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n); } }
const today = new Date().toISOString();

async function main(): Promise<void> {
  console.log('\n== idempotent record (spec §13) ==');
  const repo = new InMemoryCallIntelRepo();
  const svc = new CallIntelligenceService(repo);
  const a = await svc.record('t1', 'b1', { providerCallId: 'CA1', status: 'missed', callerPhone: '+1555' });
  const b = await svc.record('t1', 'b1', { providerCallId: 'CA1', status: 'answered_ai', outcome: 'recovered' });
  check('same provider call id does not duplicate', a.deduped === false && b.deduped === true && repo.rows.length === 1);
  check('re-delivery updates status/outcome', repo.rows[0].status === 'answered_ai' && repo.rows[0].outcome === 'recovered');

  console.log('\n== summary math ==');
  const rows: CallEventRow[] = [
    { id: '1', tenantId: 't1', branchId: 'b1', providerCallId: 'c1', status: 'answered_ai', direction: 'inbound', aiHandled: true, durationSeconds: 120, outcome: 'booked', startedAt: today, intent: 'book' } as CallEventRow,
    { id: '2', tenantId: 't1', branchId: 'b1', providerCallId: 'c2', status: 'missed', direction: 'inbound', aiHandled: false, durationSeconds: 0, outcome: 'no_action', startedAt: today, callerPhone: '+1', customerId: null } as CallEventRow,
    { id: '3', tenantId: 't1', branchId: 'b1', providerCallId: 'c3', status: 'answered_ai', direction: 'inbound', aiHandled: true, durationSeconds: 60, outcome: 'recovered', startedAt: today, recoveredAppointmentId: 'appt9' } as CallEventRow,
  ];
  const s = summarize(rows);
  check('aiHandledToday = 2', s.aiHandledToday === 2);
  check('missedToday = 1', s.missedToday === 1);
  check('recoveredToday = 1', s.recoveredToday === 1);
  check('call-to-booking rate = 100 (2 booked / 2 answered)', s.callToBookingRatePct === 100);
  check('avg duration = 90', s.avgDurationSeconds === 90);
  check('missed queue surfaced', s.missedQueue.length === 1 && s.missedQueue[0].callerPhone === '+1');
  check('recovered surfaced with appt link', s.recovered.length === 1 && s.recovered[0].appointmentId === 'appt9');

  console.log('\n== empty / no answered ==');
  const e = summarize([]);
  check('empty -> zeros + null rate', e.totalToday === 0 && e.callToBookingRatePct === null);

  console.log('\n== tenant isolation ==');
  await svc.record('t2', null, { providerCallId: 'CA1', status: 'missed' });
  const sumT1 = await repo.summary({ tenantId: 't1', branchId: 'b1' });
  const sumT2 = await repo.summary({ tenantId: 't2', branchId: null });
  check('t1 does not see t2 calls', sumT1.totalToday === 1 && sumT2.totalToday === 1);

  console.log(`\ncall-intelligence-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main();
