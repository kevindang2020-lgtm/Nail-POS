/**
 * super-admin-tenants-service.spec.ts
 * ---------------------------------------------------------------------------
 * Runs the real service against InMemorySuperAdminTenantsRepo — end-to-end
 * (controller logic minus the HTTP/Nest layer). Compile + run:
 *   npx esbuild ...service.spec.ts --bundle --platform=node | node
 */

import { SuperAdminTenantsService } from './super-admin-tenants.service';
import { InMemorySuperAdminTenantsRepo } from './super-admin-tenants.repository';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name); }
}

async function main(): Promise<void> {
  const svc = () => new SuperAdminTenantsService(new InMemorySuperAdminTenantsRepo());

  console.log('\n== getState ==');
  {
    const s = svc();
    const st = await s.getState({ page: 1, pageSize: 10 });
    check('returns 5 seeded rows', st.tenants.length === 5);
    check('has 8 KPI cards', st.kpis.length === 8);
    check('Total Tenants KPI = 5', st.kpis.find((k) => k.lab === 'Total Tenants')!.val === '5');
    check('pagination totalItems = 5', st.pagination.totalItems === 5);
    const sus = await s.getState({ tab: 'suspended' });
    check('suspended tab -> 1 (pear009)', sus.tenants.length === 1 && sus.tenants[0].id === 'pear009');
    const nomid = await s.getState({ tab: 'nomid' });
    check('nomid tab -> 3 (gold003,bell005,pear009)', nomid.tenants.length === 3);
    const pa = await s.getState({ filter: { state: 'DE' } });
    check('filter state DE -> 1', pa.tenants.length === 1);
  }

  console.log('\n== createTenant ==');
  {
    const s = svc();
    const bad = await s.createTenant({ displayName: '', ownerName: '', ownerEmail: 'x', plan: '' } as any);
    check('missing fields rejected', !bad.ok && (bad.errors?.length ?? 0) > 0);
    const ok = await s.createTenant({ displayName: 'New Salon', ownerName: 'Pat', ownerEmail: 'pat@new.com', plan: 'Pro Plan', tenantCode: 'NEWSAL1', state: 'NJ' });
    check('create ok', ok.ok && !!ok.tenant);
    check('new tenant derives setup status (pending+no fiserv+owner inactive)', ok.tenant!.status === 'setup' || ok.tenant!.status === 'suspended');
    const dup = await s.createTenant({ displayName: 'Dup', ownerName: 'Pat', ownerEmail: 'pat2@new.com', plan: 'Pro Plan', tenantCode: 'NEWSAL1' });
    check('duplicate tenant code rejected', !dup.ok);
    // the screen's create modal posts a NESTED owner/branch shape:
    const nested = await s.createTenant({
      displayName: 'Nested Salon',
      owner: { firstName: 'Dana', lastName: 'Cruz', email: 'dana@nested.com', phone: '(555) 1' },
      branch: { city: 'Trenton', state: 'NJ' },
      code: 'NESTED1',
      plan: 'Gold Plan',
      aiPackage: 'AI Pro',
    } as any);
    check('nested-shape create (screen payload) ok', nested.ok && nested.tenant!.owner === 'Dana Cruz');
    check('nested create maps state from branch', nested.tenant!.state === 'NJ');
    const after = await s.getState({});
    check('count grew to 7', after.pagination.totalItems === 7);
  }

  console.log('\n== suspend / reactivate ==');
  {
    const s = svc();
    const noReason = await s.suspend('luxe001', 'no');
    check('suspend needs reason >=5', !noReason.ok);
    const notFound = await s.suspend('does-not-exist', 'Valid reason here');
    check('suspend unknown tenant -> not found', !notFound.ok);
    const ok = await s.suspend('luxe001', 'Non-payment after 30 days');
    check('suspend ok flips to suspended', ok.ok && ok.tenant!.status === 'suspended');
    const again = await s.suspend('luxe001', 'Another reason here');
    check('suspending already-suspended rejected', !again.ok);
    const re = await s.reactivate('luxe001');
    check('reactivate ok -> not suspended', re.ok && re.tenant!.status !== 'suspended');
    const reBad = await s.reactivate('luxe001');
    check('reactivate non-suspended rejected', !reBad.ok);
    // audit recorded for the suspend+reactivate
    const audit = await s.getAudit('luxe001');
    check('audit has entries after mutations', audit.entries.length >= 2);
    check('audit names the tenant', audit.tenantName === 'Luxe Nails & Spa');
  }

  console.log('\n== reset owner password ==');
  {
    const s = svc();
    const ok = await s.resetOwnerPassword('gold003');
    check('reset returns one-time temp password', ok.ok && !!ok.temporaryPassword);
    check('reset returns owner email', ok.ownerEmail === 'amy@goldennailbar.com');
    const nf = await s.resetOwnerPassword('nope');
    check('reset unknown tenant -> not found', !nf.ok);
  }

  console.log('\n== import ==');
  {
    const s = svc();
    const res = await s.importTenants({
      rows: [
        { displayName: 'Imp One', ownerEmail: 'one@imp.com', plan: 'Starter Plan' },
        { displayName: 'Imp Two', ownerEmail: 'bad-email', plan: 'Starter Plan' }, // invalid email -> skipped
      ],
    });
    check('import created 1', res.created === 1);
    check('import skipped 1', res.skipped === 1);
    check('import reports the bad row', res.rowErrors.length === 1 && res.rowErrors[0].index === 1);
  }


  console.log('\n== quick actions: status / warning / support ==');
  {
    const repo = new InMemorySuperAdminTenantsRepo();
    const s = new SuperAdminTenantsService(repo);
    const list = await s.getState({}) as any;
    const activeRow = list.tenants.find((r) => r.status !== 'suspended') || list.tenants[0];
    const id = activeRow.id;

    // pause (active → suspended) then activate (suspended → active)
    // Constitution 7 §18/§20 (Sep 27): a suspension needs a reason code and a written reason (≥ 10 characters);
    // reactivation needs a reason too. This spec predated that rule.
    const noCode = await s.changeStatus(id, 'paused', 'QA pause for testing', { userId: 'admin1', ip: '1.2.3.4' });
    check('pause without a reason code refused', noCode.ok === false);
    const paused = await s.changeStatus(id, 'paused', 'QA pause for testing', { userId: 'admin1', ip: '1.2.3.4' }, 'TENANT_REQUEST');
    check('pause ok', paused.ok === true);
    const afterPause = await s.getState({}) as any;
    check('row now suspended/paused', afterPause.tenants.find((r) => r.id === id)!.status === 'suspended');
    const activated = await s.changeStatus(id, 'active', 'QA reactivation after test', { userId: 'admin1' });
    check('activate ok', activated.ok === true);
    check('row active again', (await s.getState({}) as any).tenants.find((r) => r.id === id)!.status !== 'suspended');

    // illegal transition surfaces a clean error (activate an already-active tenant)
    const illegal = await s.changeStatus(id, 'active', undefined, { userId: 'admin1' });
    check('illegal transition rejected', illegal.ok === false);

    // unknown tenant
    const missing = await s.changeStatus('nope', 'paused', undefined, {});
    check('missing tenant rejected', missing.ok === false);

    // send warning: validates subject/message, persists, audits warning_sent
    const badWarn = await s.sendWarning(id, { warningType: 'payment_issue', severity: 'high', subject: '', message: '' });
    check('warning requires subject+message', badWarn.ok === false);
    const warn = await s.sendWarning(id, { warningType: 'payment_issue', severity: 'high', subject: 'Overdue', message: 'Please update billing', sendEmail: true });
    check('warning saved', warn.ok === true && !!(warn as any).warningId);
    check('warning persisted in repo', repo.warnings.length === 1 && repo.warnings[0].subject === 'Overdue');
    check('warning audited', (await repo.getAudit(id)).some((a) => a.actionType === 'warning_sent'));

    // list warnings: newest-first, carries delivery status (pending until the dispatch worker runs)
    const wlist = await s.listWarnings(id);
    check('listWarnings returns the saved warning', wlist.length === 1 && wlist[0].subject === 'Overdue');
    check('listWarnings carries delivery status', wlist[0].deliveryStatus === 'pending' && wlist[0].sendEmail === true);
    check('listWarnings isolates by tenant', (await s.listWarnings('does-not-exist')).length === 0);

    // support access (Constitution 7 §74, D7): a placeholder reason is refused; a real one returns a session id + audits support_access_opened
    const bad = await s.openSupportAccess(id, { reason: 'view_pos_from_super_admin', source: 'tenants_salons_quick_actions' }, { userId: 'admin1' });
    check('placeholder reason refused', bad.ok === false);
    const sa = await s.openSupportAccess(id, { reason: 'owner reports checkout freezing', source: 'tenants_salons_quick_actions' }, { userId: 'admin1' });
    check('support access ok', sa.ok === true && typeof (sa as any).sessionId === 'string' && !('posUrl' in (sa as any)));
    check('support access audited', (await repo.getAudit(id)).some((a) => a.actionType === 'support_access_opened'));
  }


  console.log(`\n──────────── ${pass}/${pass + fail} passed ────────────\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
