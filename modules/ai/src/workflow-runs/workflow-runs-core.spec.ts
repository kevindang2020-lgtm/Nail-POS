/** workflow-runs-core.spec.ts — idempotent record, per-workflow summary math, tenant isolation. */
import { summarizeRuns, type WorkflowRunRow } from './workflow-runs.dto';
import { InMemoryWorkflowRunsRepo } from './workflow-runs.repository';
import { WorkflowRunsService } from './workflow-runs.service';

let pass = 0, fail = 0;
function check(n: string, c: boolean): void { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n); } }
const now = new Date().toISOString();

async function main(): Promise<void> {
  console.log('\n== idempotent run (no double-count) ==');
  const repo = new InMemoryWorkflowRunsRepo(); const svc = new WorkflowRunsService(repo);
  const a = await svc.record('t1', 'b1', { workflowKey: 'birthday_campaign', dedupeKey: 'bday:cust9:2026-06-26', status: 'sent' });
  const b = await svc.record('t1', 'b1', { workflowKey: 'birthday_campaign', dedupeKey: 'bday:cust9:2026-06-26', status: 'sent' });
  check('same dedupe key not double-counted', a.deduped === false && b.deduped === true && repo.rows.length === 1);

  console.log('\n== per-workflow summary math ==');
  const rows: WorkflowRunRow[] = [
    { id: '1', tenantId: 't1', branchId: 'b1', workflowKey: 'review_request', dedupeKey: 'a', status: 'sent', ranAt: now } as WorkflowRunRow,
    { id: '2', tenantId: 't1', branchId: 'b1', workflowKey: 'review_request', dedupeKey: 'b', status: 'failed', ranAt: now } as WorkflowRunRow,
    { id: '3', tenantId: 't1', branchId: 'b1', workflowKey: 'thank_you', dedupeKey: 'c', status: 'sent', ranAt: now } as WorkflowRunRow,
  ];
  const s = summarizeRuns(rows);
  check('review_request sentToday = 1', s.review_request.sentToday === 1);
  check('review_request success = 50%', s.review_request.successRatePct === 50);
  check('thank_you sentToday = 1, success 100%', s.thank_you.sentToday === 1 && s.thank_you.successRatePct === 100);
  check('untouched workflow key absent', s.birthday_campaign === undefined);

  console.log('\n== validation + tenant isolation ==');
  let threw = false; try { await svc.record('t1', 'b1', { workflowKey: 'thank_you' as any, dedupeKey: '' }); } catch { threw = true; }
  check('missing dedupe key rejected', threw);
  await svc.record('t2', null, { workflowKey: 'birthday_campaign', dedupeKey: 'bday:cust9:2026-06-26', status: 'sent' });
  const s1 = await repo.summary({ tenantId: 't1', branchId: 'b1' });
  const s2 = await repo.summary({ tenantId: 't2', branchId: null });
  check('t1 excludes t2 runs', Object.keys(s1).length === 1 && Object.keys(s2).length === 1);

  console.log(`\nworkflow-runs-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main();
