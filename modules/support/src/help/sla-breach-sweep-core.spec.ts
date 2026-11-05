/**
 * sla-breach-sweep-core.spec.ts — the breach sweep's pure gate and safety: the cron is off unless explicitly
 * enabled; `shouldFlagBreach` flags only overdue, un-replied, non-terminal tickets (matching the read-time SLA
 * state); and the job is a safe no-op without a database.
 */
import { slaBreachSweepCronEnabled, shouldFlagBreach, breachNotifyEnabled, composeBreachNotice, SlaBreachSweepJob } from './sla-breach-sweep';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

const base = Date.parse('2026-06-26T00:00:00Z');
const created = '2026-06-26T00:00:00Z';

async function main(): Promise<void> {
  console.log('\n== cron flag ==');
  check('off by default', slaBreachSweepCronEnabled({} as any) === false);
  check('on when set true', slaBreachSweepCronEnabled({ SLA_BREACH_SWEEP_CRON: 'true' } as any) === true);
  check('on when set 1/on/yes', slaBreachSweepCronEnabled({ SLA_BREACH_SWEEP_CRON: '1' } as any) && slaBreachSweepCronEnabled({ SLA_BREACH_SWEEP_CRON: 'on' } as any) && slaBreachSweepCronEnabled({ SLA_BREACH_SWEEP_CRON: 'yes' } as any));
  check('off when false', slaBreachSweepCronEnabled({ SLA_BREACH_SWEEP_CRON: 'false' } as any) === false);

  console.log('\n== breach gate ==');
  check('overdue, no reply, open → flag', shouldFlagBreach({ status: 'open', hasAgentReply: false, createdAt: created, targetMinutes: 60, now: base + 90 * 60000 }) === true);
  check('not yet overdue → no flag', shouldFlagBreach({ status: 'open', hasAgentReply: false, createdAt: created, targetMinutes: 60, now: base + 10 * 60000 }) === false);
  check('agent already replied → no flag', shouldFlagBreach({ status: 'in_progress', hasAgentReply: true, createdAt: created, targetMinutes: 60, now: base + 999 * 60000 }) === false);
  check('terminal status → no flag', shouldFlagBreach({ status: 'closed', hasAgentReply: false, createdAt: created, targetMinutes: 60, now: base + 999 * 60000 }) === false);

  console.log('\n== safety ==');
  const res = await new SlaBreachSweepJob(null).sweep('2026-06-26T05:00:00Z');
  check('no DB → safe no-op', res.scanned === 0 && res.swept === 0);

  console.log('\n== breach notify ==');
  check('notify off by default', breachNotifyEnabled({} as any) === false);
  check('notify on when set', breachNotifyEnabled({ SLA_BREACH_NOTIFY: 'on' } as any) === true);
  const notice = composeBreachNotice('SUP-ABC123', 'Card terminal offline');
  check('notice subject names breach + ticket', /SUP-ABC123/.test(notice.subject) && /SLA breached/i.test(notice.subject));
  check('notice body names ticket + subject', /SUP-ABC123/.test(notice.body) && /Card terminal offline/.test(notice.body));

  console.log('\nsla-breach-sweep-core: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
}
main();
