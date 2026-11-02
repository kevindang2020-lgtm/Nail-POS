// alerts-service.spec.ts — exercises the Alerts service over the in-memory repo (sync, filter, status, notes, summary).
import { SuperAdminAlertsService } from './alerts.service';
import { InMemoryAlertsRepo } from './alerts.repository';
import { summarize, applyFilters, canSetStatus, type SignalSeed } from './alerts-core';

let pass = 0, fail = 0;
function check(name: string, cond: boolean) { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

const seeds: SignalSeed[] = [
  { tenantId: 't1', tenantName: 'Luxe Nails & Spa', title: 'Payment setup needed', message: 'No gateway', type: 'payment', severity: 'high', relatedModule: '/payment-gateways', relatedRecordId: 't1', dedupeKey: 'payment_setup:t1' },
  { tenantId: null, tenantName: 'Glamour Nails', title: 'Application needs review', message: 'New', type: 'application', severity: 'low', relatedModule: '/tenant-applications', relatedRecordId: 'a1', dedupeKey: 'application_review:a1' },
  { tenantId: null, tenantName: 'Platform', title: 'API latency', message: 'high', type: 'system', severity: 'critical', relatedModule: '/system-health', relatedRecordId: null, dedupeKey: 'system_latency:today' },
];

async function main() {
  console.log('== alerts core ==');
  {
    const rows = [
      { id: '1', tenantId: null, tenantName: 'A', title: 'x', message: '', type: 'payment', severity: 'high', status: 'unread', relatedModule: null, relatedRecordId: null, dedupeKey: 'k1', createdAt: '2026-01-02', updatedAt: '2026-01-02' },
      { id: '2', tenantId: null, tenantName: 'B', title: 'y', message: '', type: 'system', severity: 'critical', status: 'read', relatedModule: null, relatedRecordId: null, dedupeKey: 'k2', createdAt: '2026-01-03', updatedAt: '2026-01-03' },
      { id: '3', tenantId: null, tenantName: 'C', title: 'z', message: '', type: 'support', severity: 'low', status: 'dismissed', relatedModule: null, relatedRecordId: null, dedupeKey: 'k3', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    ] as any[];
    const s = summarize(rows);
    check('summary excludes dismissed from total', s.total === 2);
    check('summary counts unread', s.unread === 1);
    check('summary counts critical', s.critical === 1);
    check('summary counts payment type', s.payment === 1);
    check('filter by severity', applyFilters(rows, { severity: 'high' }).length === 1);
    check('search matches title', applyFilters(rows, { search: 'x' }).length === 1);
    check('default sort is newest-first', applyFilters(rows, {})[0].id === '2');
    check('cannot set same status', canSetStatus('read', 'read').ok === false);
    check('can resolve from unread', canSetStatus('unread', 'resolved').ok === true);
  }

  console.log('\n== alerts service (sync, status, notes, mark-all) ==');
  {
    const repo = new InMemoryAlertsRepo();
    const svc = new SuperAdminAlertsService(repo);

    const synced = await repo.syncFromSignals(seeds);
    check('sync creates 3 alerts from signals', synced === 3);
    check('re-sync is idempotent (0 new)', (await repo.syncFromSignals(seeds)) === 0);

    const list = await svc.list({});
    check('list returns 3', list.total === 3);
    const recent = await svc.recent(2);
    check('recent honours limit', recent.length === 2);

    const target = list.rows[0];
    check('unread count is 3', (await svc.unreadCount()) === 3);
    const read = await svc.setStatus(target.id, 'read');
    check('mark read ok', read.ok === true && (read as any).alert.status === 'read');
    check('read audit written', repo.audits.some((a) => a.action === 'alert_marked_read'));
    check('unread count drops to 2', (await svc.unreadCount()) === 2);

    const reResolve = await svc.setStatus(target.id, 'resolved');
    check('resolve ok', reResolve.ok === true);
    check('resolve audit written', repo.audits.some((a) => a.action === 'alert_resolved'));

    const missing = await svc.setStatus('nope', 'read');
    check('missing alert rejected', missing.ok === false);

    const note = await svc.addNote(target.id, 'Investigating');
    check('note added', note.ok === true);
    const emptyNote = await svc.addNote(target.id, '   ');
    check('empty note rejected', emptyNote.ok === false);

    const detail = await svc.get(target.id);
    check('detail includes the note', !!detail && detail.notes.length === 1);

    const all = await svc.markAllRead();
    check('mark-all-read flips remaining unread', all.count === 2);
    check('summary unread now 0', (await svc.summary()).unread === 0);
  }

  console.log(`\n──────────── ${pass}/${pass + fail} passed ────────────\n`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
