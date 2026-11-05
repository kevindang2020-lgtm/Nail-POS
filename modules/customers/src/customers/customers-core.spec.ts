// customers-core.spec.ts — Nest-free harness for the (async) customers service + repository.
import { InMemoryCustomersRepository, CustomersContext } from './customers.repository';
import { CustomersService, ForbiddenError, ValidationError } from './customers.service';
import { customersToCsv, detectDuplicates } from './customers.dto';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };
const throwsAsync = async (n: string, fn: () => Promise<unknown>, t?: any) => {
  try { await fn(); fail++; console.error('FAIL (no throw):', n); }
  catch (e) { if (t && !(e instanceof t)) { fail++; console.error('FAIL (wrong type):', n); } else pass++; }
};

const svc = () => new CustomersService(new InMemoryCustomersRepository());
const PERMS = ['pos.customers.view','pos.customers.create','pos.customers.edit','pos.customers.archive','pos.customers.merge','pos.customers.import','pos.customers.export','pos.customers.notes.view','pos.customers.notes.edit','pos.customers.loyalty.edit','pos.customers.membership.edit'];
const owner = (over: Partial<CustomersContext> = {}): CustomersContext => ({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: PERMS, ...over });

(async () => {
  // access
  await throwsAsync('customer blocked', () => svc().getState(owner({ role: 'CUSTOMER' })), ForbiddenError);
  await throwsAsync('customer_display blocked', () => svc().getState(owner({ role: 'CUSTOMER_DISPLAY' })), ForbiddenError);
  await throwsAsync('super_admin blocked', () => svc().getState(owner({ role: 'SUPER_ADMIN' })), ForbiddenError);
  await throwsAsync('missing view blocked', () => svc().getState(owner({ permissions: [] })), ForbiddenError);

  // isolation
  const other = await svc().getState(owner({ tenantId: 'other999' }));
  ok('tenant isolation: other tenant empty', other.kpisFull.totalCustomers === 0 && other.rows.items.length === 0);

  // state + KPIs
  const st = await svc().getState(owner());
  ok('seed has customers', st.kpisFull.totalCustomers >= 6);
  ok('kpis: vip counted', st.kpisFull.vipCustomers >= 1);
  ok('kpis: inactive counted', st.kpisFull.inactiveCustomers >= 1);
  ok('kpis: duplicates counted', st.kpisFull.duplicateProfiles >= 2);
  ok('rows carry source + opt-ins + duplicateRisk', st.rows.items.every((r) => !!r.source && typeof r.marketingOptIn === 'boolean' && !!r.duplicateRisk));
  ok('facets present', st.filterFacets.segments.includes('vip') && st.filterFacets.sources.length >= 1);

  // filters
  ok('filter status=active', (await svc().list(owner(), { status: 'active' })).items.every((c) => c.status === 'active'));
  const vip = await svc().getState(owner(), { segment: 'vip' });
  ok('filter segment=vip', vip.rows.items.length >= 1 && vip.rows.items.every((r) => r.isVip));
  const inactive = await svc().getState(owner(), { inactiveDays: 60 });
  ok('filter inactiveDays>=60', inactive.rows.items.length >= 1);
  const dupRisk = await svc().getState(owner(), { duplicateRisk: 'high' });
  ok('filter duplicateRisk=high', dupRisk.rows.items.length >= 2 && dupRisk.rows.items.every((r) => r.duplicateRisk === 'high'));
  const search = await svc().list(owner(), { search: 'Grace' });
  ok('search matches name', search.items.length >= 1 && /Grace/i.test(search.items[0].fullName));
  const paged = await svc().getState(owner(), { page: 1, pageSize: 2 });
  ok('pagination respected', paged.rows.items.length === 2 && paged.rows.pagination.totalPages >= 3);

  // create + validation + duplicate flagging
  await throwsAsync('create requires name or phone', () => svc().create(owner(), { firstName: '' } as any), ValidationError);
  await throwsAsync('create rejects bad email', () => svc().create(owner(), { firstName: 'X', email: 'nope' } as any), ValidationError);
  await throwsAsync('create flags duplicate phone (same phone different name)', () => svc().create(owner(), { firstName: 'Other', phone: '+18565550199' } as any), ValidationError);
  await throwsAsync('create needs create perm', () => svc().create(owner({ permissions: ['pos.customers.view'] }), { firstName: 'X', phone: '+18565551234' } as any), ForbiddenError);
  const s2 = svc();
  const created = await s2.create(owner(), { firstName: 'Tess', lastName: 'Vu', phone: '+18565550150', email: 'tess@example.com', marketingOptIn: true });
  ok('create returns row', !!created.customerId && created.displayName === 'Tess Vu');
  ok('create tracks consent', created.marketingOptIn === true);
  ok('create increments total', (await s2.getState(owner())).kpisFull.totalCustomers === st.kpisFull.totalCustomers + 1);
  ok('audit: created', s2.auditLog().some((l) => l.actionType === 'pos_customer_created'));

  // update
  const s3 = svc();
  ok('update edits name', (await s3.update(owner(), 'cust_grace', { firstName: 'Gracie' })).firstName === 'Gracie');
  ok('audit: updated before/after', s3.auditLog().some((l) => l.actionType === 'pos_customer_updated' && !!l.before && !!l.after));

  // archive history-safe + reactivate
  const s4 = svc();
  ok('archive sets archived', (await s4.archive(owner(), 'cust_nora')).status === 'archived');
  ok('archived stays in roster (history)', (await s4.getState(owner())).kpisFull.totalCustomers === st.kpisFull.totalCustomers);
  ok('reactivate sets active', (await s4.reactivate(owner(), 'cust_nora')).status === 'active');
  ok('audit: archive + reactivate', s4.auditLog().some((l) => l.actionType === 'pos_customer_archived') && s4.auditLog().some((l) => l.actionType === 'pos_customer_reactivated'));

  // history
  const s5 = svc();
  ok('visits load', Array.isArray(await s5.visits(owner(), 'cust_grace')));
  ok('tickets load', Array.isArray(await s5.tickets(owner(), 'cust_grace')));
  ok('receipts load', Array.isArray(await s5.receipts(owner(), 'cust_grace')));

  // notes — separate view/edit permission (private notes protected)
  await throwsAsync('notes view needs notes.view', () => svc().getNotes(owner({ permissions: ['pos.customers.view'] }), 'cust_grace'), ForbiddenError);
  const s6 = svc();
  ok('notes get with perm', !!(await s6.getNotes(owner(), 'cust_grace')));
  await throwsAsync('notes edit needs notes.edit', () => svc().setNotes(owner({ permissions: ['pos.customers.view','pos.customers.notes.view'] }), 'cust_grace', { salonNotes: 'x', allergyNotes: '', preferredStyle: '', preferredTechnician: '', servicePreferences: '', warnings: '', customerVisible: false }), ForbiddenError);
  ok('notes set with perm', (await s6.setNotes(owner(), 'cust_grace', { salonNotes: 'Allergic to acetone', allergyNotes: 'acetone', preferredStyle: '', preferredTechnician: 'Mia', servicePreferences: '', warnings: '', customerVisible: false })).allergyNotes === 'acetone');
  ok('tags set', (await s6.setTags(owner(), 'cust_grace', ['VIP','High value','Birthday'])).length === 3);

  // loyalty / membership perms
  await throwsAsync('loyalty needs loyalty.edit', () => svc().setLoyalty(owner({ permissions: ['pos.customers.view'] }), 'cust_grace', { points: 100, earned: 100, redeemed: 0, tier: 'Gold', tierThresholdPoints: 500, birthdayReward: true, referralReward: true }), ForbiddenError);
  const s7 = svc();
  // Phase 10 (bug 3): a balance change is a ledger 'adjust' entry, and an adjustment needs a reason
  await throwsAsync('loyalty set without a reason is refused', () => s7.setLoyalty(owner(), 'cust_grace', { points: 700, earned: 700, redeemed: 0, tier: 'VIP Gold', tierThresholdPoints: 500, birthdayReward: true, referralReward: true }), ValidationError);
  ok('loyalty set', (await s7.setLoyalty(owner(), 'cust_grace', { points: 700, earned: 700, redeemed: 0, tier: 'VIP Gold', tierThresholdPoints: 500, birthdayReward: true, referralReward: true, reason: 'Gold status migrated from the old punch card' } as any)).points === 700);
  await throwsAsync('membership needs membership.edit', () => svc().setMembership(owner({ permissions: ['pos.customers.view'] }), 'cust_grace', { plan: 'Gold', status: 'active', benefits: [], billingStatus: 'ok' }), ForbiddenError);
  ok('membership set', (await s7.setMembership(owner(), 'cust_grace', { plan: 'Gold', status: 'active', benefits: ['10% off'], billingStatus: 'ok' })).status === 'active');
  ok('gift cards load', Array.isArray(await s7.giftCards(owner(), 'cust_grace')));

  // duplicates + merge
  const s8 = svc();
  const groups = await s8.duplicates(owner());
  ok('duplicates detected (same phone pair)', groups.length >= 1 && groups.some((g) => /phone/i.test(g.reason)));
  await throwsAsync('merge requires primary (no auto-merge)', () => svc().merge(owner(), groups[0].duplicateGroupId, ''), ValidationError);
  const grp = groups.find((g) => /phone/i.test(g.reason))!;
  const primaryId = grp.members[0].customerId; const otherId = grp.members[1].customerId;
  const beforePrimary = await s8.detail(owner(), primaryId);
  const merged = await s8.merge(owner(), grp.duplicateGroupId, primaryId);
  ok('merge moves visit history to primary', merged.visitCount >= beforePrimary.visitCount);
  ok('merge archives the non-primary profile', (await s8.detail(owner(), otherId)).status === 'archived');
  ok('audit: merged + duplicate reviewed', s8.auditLog().some((l) => l.actionType === 'pos_customer_merged') && s8.auditLog().some((l) => l.actionType === 'pos_customer_duplicate_reviewed'));
  ok('merge cannot cross tenants (no group in other tenant)', (await svc().duplicates(owner({ tenantId: 'other999' }))).length === 0);

  // pure detectDuplicates
  ok('detectDuplicates groups same email', detectDuplicates([{ customerId: 'a', firstName: 'A', email: 'x@y.com' }, { customerId: 'b', firstName: 'B', email: 'x@y.com' }]).some((g) => /email/i.test(g.reason)));

  // export / import
  ok('export csv', (await svc().export(owner(), {})).csv.includes('Name'));
  await throwsAsync('export needs export perm', () => svc().export(owner({ permissions: ['pos.customers.view'] }), {}), ForbiddenError);
  const imp = await svc().importCommit(owner(), 'first name,last name,phone,email\nWalk,In,609-555-7777,walkin@example.com\n');
  ok('import commit creates a customer', imp.created === 1 && imp.duplicatesSkipped === 0);
  await throwsAsync('import with no CSV is rejected', () => svc().import(owner()), ValidationError);
  ok('csv formula safe', customersToCsv(['A'], [['=cmd'], ['ok']]).includes("'=cmd"));

  // audit base
  const sV = svc(); await sV.getState(owner());
  ok('audit: viewed tenant-scoped', sV.auditLog().some((l) => l.actionType === 'pos_customers_viewed' && l.tenantId === 'luxe001'));

  console.log(`\ncustomers-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' OK'));
  if (fail) process.exit(1);
})();
