// pos-search-core.spec.ts — covers the POS search policy core (pure): who may search, which result groups they may see,
// query validation, per-group limit clamping, and result routing. These gate access to customer/ticket/receipt data, so the
// access rules matter. esbuild + node, ok() style.
import {
  hasPosSearchAccess, permittedGroups, validateQuery, clampLimit, ticketRoute, getResultRoute,
  emptyGrouped, totalCount, ALL_GROUPS, type GroupedResults,
} from './pos-search-core';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };

// ---- BUILD_PLAN Phase 9: access + groups are PERMISSIONS, not role names ----
// Access = global_search.use (every staff role holds it; the catalog grants it to technicians too — the old `pos.access`
// key existed in no catalog, so technicians could never search). Groups = the catalog key each group's screen needs.
const P = (role: string): string[] => ({
  OWNER: ['global_search.use', 'customers.view', 'booking.view', 'services.view', 'technicians.view', 'checkout.view', 'reports.view', 'queue.view', 'owner.branches.view'],
  MANAGER: ['global_search.use', 'customers.view', 'booking.view', 'services.view', 'technicians.view', 'checkout.view', 'reports.view', 'queue.view', 'owner.branches.view'],
  FRONT_DESK: ['global_search.use', 'customers.view', 'booking.view', 'services.view', 'technicians.view', 'checkout.view', 'queue.view'],
  TECHNICIAN: ['global_search.use', 'customers.view', 'booking.view', 'services.view', 'queue.view'],
} as Record<string, string[]>)[role] ?? [];
ok('a staff session holding global_search.use may search', hasPosSearchAccess('OWNER', P('OWNER')) && hasPosSearchAccess('FRONT_DESK', P('FRONT_DESK')) && hasPosSearchAccess('TECHNICIAN', P('TECHNICIAN')));
ok('an OWNER-role session WITHOUT global_search.use (denied) may not — no role shortcut', !hasPosSearchAccess('OWNER', []));
ok('CUSTOMER and the platform are denied whatever they hold', !hasPosSearchAccess('CUSTOMER', ['global_search.use']) && !hasPosSearchAccess('SUPER_ADMIN', ['global_search.use']));
ok('no access → no groups', permittedGroups('CUSTOMER', []).length === 0);
ok('OWNER and MANAGER sessions see every group (they hold every group key)', permittedGroups('OWNER', P('OWNER')).length === ALL_GROUPS.length && permittedGroups('MANAGER', P('MANAGER')).length === ALL_GROUPS.length);
{
  const g = permittedGroups('FRONT_DESK', P('FRONT_DESK'));
  ok('the front desk sees exactly the groups its keys cover (no receipts without reports.view)', !g.includes('receipts') && g.includes('tickets') && g.includes('queue') && g.includes('appointments'));
}
{
  const g = permittedGroups('TECHNICIAN', ['global_search.use', 'checkout.view']);
  ok('checkout.view unlocks tickets only', g.includes('tickets') && !g.includes('queue') && !g.includes('customers') && g.length === 1);
}

// ---- validateQuery: trims, requires >= 2 chars ----
ok('a query under 2 chars is rejected', validateQuery('a').ok === false && validateQuery('a').error === 'min_length');
ok('whitespace is trimmed before length check', validateQuery('  x  ').ok === false && validateQuery('  hello  ').q === 'hello');
ok('a 2+ char query passes', validateQuery('ab').ok === true && validateQuery('ab').q === 'ab');
ok('empty / undefined are rejected', validateQuery('').ok === false && validateQuery(undefined).ok === false);

// ---- clampLimit: default 5, ceiling 10 ----
ok('missing / non-positive limit defaults to 5', clampLimit() === 5 && clampLimit(0) === 5 && clampLimit(-3) === 5);
ok('an in-range limit is kept', clampLimit(3) === 3 && clampLimit(1) === 1);
ok('the limit is capped at 10', clampLimit(10) === 10 && clampLimit(50) === 10);

// ---- ticketRoute: status drives the POS screen; unknown falls back to checkout ----
ok('ticket status routes to the right POS screen', ticketRoute('tk', 'serving') === '/pos/serving?ticketId=tk' && ticketRoute('tk', 'service_done') === '/pos/service-done?ticketId=tk' && ticketRoute('tk', 'queued') === '/pos/queue?ticketId=tk');
ok('unknown / missing ticket status falls back to checkout', ticketRoute('tk') === '/pos/checkout?ticketId=tk' && ticketRoute('tk', 'mystery') === '/pos/checkout?ticketId=tk');

// ---- getResultRoute: per-type routing; ticket/queue honor an explicit route override ----
ok('customer / service / technician / receipt routes', getResultRoute('customer', '1') === '/pos/customers/1' && getResultRoute('service', '1') === '/pos/services?serviceId=1' && getResultRoute('technician', '1') === '/pos/technicians?technicianId=1' && getResultRoute('receipt', '1') === '/pos/reports?receiptId=1');
ok('a ticket result uses ticketRoute by status', getResultRoute('ticket', 'tk', { status: 'serving' }) === '/pos/serving?ticketId=tk' && getResultRoute('ticket', 'tk') === '/pos/checkout?ticketId=tk');
ok('an explicit route override wins for ticket + queue_item', getResultRoute('ticket', 'tk', { route: '/custom' }) === '/custom' && getResultRoute('queue_item', 'q', { route: '/q' }) === '/q');
ok('queue_item without an override has a default route', getResultRoute('queue_item', 'q') === '/pos/queue?queueItemId=q');

// ---- emptyGrouped + totalCount ----
ok('emptyGrouped has every group as an empty array', ALL_GROUPS.every((k) => Array.isArray((emptyGrouped() as GroupedResults)[k]) && (emptyGrouped() as GroupedResults)[k].length === 0));
{
  const g = emptyGrouped(); g.customers.push({ id: '1', type: 'customer', title: 'A' }); g.tickets.push({ id: '2', type: 'ticket', title: 'B' }, { id: '3', type: 'ticket', title: 'C' });
  ok('totalCount sums across all groups', totalCount(g) === 3 && totalCount(emptyGrouped()) === 0);
}

console.log(`\npos-search-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' OK'));
if (fail) process.exit(1);
