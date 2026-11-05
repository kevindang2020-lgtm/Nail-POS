// payment-gateways-core.spec.ts — characterization harness for the Payment Gateways command-center shaping core.
// Run: npx esbuild src/super-admin-platform/payment-gateways-core.spec.ts --bundle --platform=node --outfile=/tmp/_pg.js && node /tmp/_pg.js
import {
  maskMid, mapGatewayStatus, deriveSetupStage, normalizeSettlement, toGatewayView, computeKpis,
  statusBreakdown, topProcessors, mapEvent, filterGateways, paginate, toCsv, gatewayStatusTransition,
  requiredGatewayCredentials, missingGatewayCredentials, webhookHealth,
  type RawGatewayRow, type RawEventRow,
} from './payment-gateways-core';

let passed = 0;
function ok(name: string, cond: boolean) { if (!cond) { console.error('FAIL:', name); process.exit(1); } passed++; }

// A small fixture of normalized rows spanning every state.
const RAW_MID_A = 'CP771200004821';   // raw MID we must NEVER see in output
const RAW_MID_B = '8833';
function row(over: Partial<RawGatewayRow>): RawGatewayRow {
  return {
    tenantId: 't', tenantName: 'T', salonCode: 'SAL-1', tenantStatus: 'active', ownerName: 'Owner One',
    city: 'Houston', state: 'TX', branchCount: 1, branches: [{ id: 'b1', name: 'Main', city: 'Houston', state: 'TX', status: 'active' }],
    processor: 'fiserv', merchantId: RAW_MID_A, environment: 'production',
    status: 'active', baseUrlPresent: true, credsPresent: true, fiservConfigured: true, pairedTerminals: 2, onboardingStatus: 'approved',
    settlementStatusRaw: 'settled', monthlyVolumeCents: 12_345_00, failedSettlements: 0, chargebackAlerts: 0, todayVolumeCents: 84_200, todayTxnCount: 7,
    lastSyncAt: '2026-06-10T12:00:00.000Z', lastPaymentAt: '2026-06-12T08:00:00.000Z', ...over,
  };
}

// ---- maskMid ----
ok('maskMid null', maskMid(null) === null);
ok('maskMid short', maskMid('12') === '••••');
ok('maskMid long keeps last4', maskMid(RAW_MID_A) === '••••4821');
ok('maskMid never contains raw', !String(maskMid(RAW_MID_A)).includes('CP7712'));

// ---- mapGatewayStatus ----
ok('status active', mapGatewayStatus('active') === 'active');
ok('status disabled', mapGatewayStatus('disabled') === 'disabled');
ok('status null->not_configured', mapGatewayStatus(null) === 'not_configured');
ok('status junk->not_configured', mapGatewayStatus('whatever') === 'not_configured');
ok('status paused', mapGatewayStatus('paused') === 'paused');

// ---- gatewayStatusTransition (pause / resume / disable guard) ----
ok('pause active -> paused', gatewayStatusTransition('active', 'pause').to === 'paused');
ok('pause pending -> paused', gatewayStatusTransition('pending', 'pause').to === 'paused');
ok('pause already paused -> error', gatewayStatusTransition('paused', 'pause').ok === false);
ok('pause disabled -> error', gatewayStatusTransition('disabled', 'pause').ok === false);
ok('disable active -> disabled', gatewayStatusTransition('active', 'disable').to === 'disabled');
ok('disable paused -> disabled', gatewayStatusTransition('paused', 'disable').to === 'disabled');
ok('disable already disabled -> error', gatewayStatusTransition('disabled', 'disable').ok === false);
ok('resume paused -> active', gatewayStatusTransition('paused', 'resume').to === 'active');
ok('resume disabled -> active', gatewayStatusTransition('disabled', 'resume').to === 'active');
ok('resume already active -> error', gatewayStatusTransition('active', 'resume').ok === false);
ok('any action on not_configured -> error', gatewayStatusTransition(null, 'pause').ok === false && gatewayStatusTransition('not_configured', 'disable').ok === false);

// ---- deriveSetupStage ----
ok('stage not_started when no config', deriveSetupStage({ status: null, credsPresent: false, pairedTerminals: 0, fiservConfigured: false }) === 'not_started');
ok('stage application_submitted', deriveSetupStage({ status: 'pending', credsPresent: false, pairedTerminals: 0, fiservConfigured: false }) === 'application_submitted');
ok('stage gateway_connected (creds, not active)', deriveSetupStage({ status: 'pending', credsPresent: true, pairedTerminals: 0, fiservConfigured: false }) === 'gateway_connected');
ok('stage terminal_linked (active no terminals)', deriveSetupStage({ status: 'active', credsPresent: true, pairedTerminals: 0, fiservConfigured: true }) === 'terminal_linked');
ok('stage complete (active + terminals)', deriveSetupStage({ status: 'active', credsPresent: true, pairedTerminals: 3, fiservConfigured: true }) === 'complete');

// ---- normalizeSettlement ----
ok('settle settled', normalizeSettlement('settled') === 'settled');
ok('settle failed', normalizeSettlement('failed') === 'failed');
ok('settle null->not_applicable', normalizeSettlement(null) === 'not_applicable');
ok('settle review->needs_review', normalizeSettlement('review') === 'needs_review');

// ---- toGatewayView ----
const v = toGatewayView(row({}));
ok('view masks MID', v.merchantIdMasked === '••••4821');
ok('view never exposes raw MID', JSON.stringify(v).indexOf(RAW_MID_A) === -1 && JSON.stringify(v).indexOf('CP7712') === -1);
ok('view location "City, ST"', v.location === 'Houston, TX');
ok('view setup label Complete', v.paymentSetupLabel === 'Complete');
ok('view hasConfig true', v.hasConfig === true);
ok('view credentials booleans only', v.credentials.apiConfigured === true && typeof v.credentials.apiConfigured === 'boolean');
const vNoConfig = toGatewayView(row({ status: null, processor: null, merchantId: null, credsPresent: false, fiservConfigured: false, pairedTerminals: 0, settlementStatusRaw: null, monthlyVolumeCents: 0 }));
ok('view no-config -> not_configured + Not Started', vNoConfig.gatewayStatus === 'not_configured' && vNoConfig.paymentSetupLabel === 'Not Started');
ok('view no-config -> settlement not_applicable', vNoConfig.settlementStatus === 'not_applicable');
ok('view location null when no city/state', toGatewayView(row({ city: null, state: null })).location === null);

// ---- computeKpis ----
const rows: RawGatewayRow[] = [
  row({ tenantId: 'a', status: 'active', processor: 'fiserv', monthlyVolumeCents: 100_00, failedSettlements: 0 }),
  row({ tenantId: 'b', status: 'active', processor: 'cardpointe', monthlyVolumeCents: 200_00, failedSettlements: 1 }),
  row({ tenantId: 'c', status: 'pending', processor: 'clover', monthlyVolumeCents: 0 }),
  row({ tenantId: 'd', status: 'error', processor: 'fiserv', monthlyVolumeCents: 50_00 }),
  row({ tenantId: 'e', status: 'disabled', processor: 'clover', monthlyVolumeCents: 0 }),
  row({ tenantId: 'f', status: null, processor: null, monthlyVolumeCents: 0 }),           // needs setup
];
const k = computeKpis(rows);
ok('kpi totalGateways excludes no-config', k.totalGateways === 5);
ok('kpi active', k.activeMerchantAccounts === 2);
ok('kpi pending counts pending + not_configured', k.pendingPaymentSetup === 2);
ok('kpi issues', k.gatewayIssues === 1);
ok('kpi monthly volume sum', k.monthlyProcessedVolumeCents === 350_00);
ok('kpi failed settlements sum', k.failedSettlements === 1);
ok('kpi chargebacks default 0 + untracked (back-compat)', k.chargebackAlerts === 0 && k.chargebacksTracked === false);
ok('kpi connectedProcessors distinct (fiserv,cardpointe,clover)', k.connectedProcessors === 3);

// chargebacks now wired: counts sum across tenants and the tracked flag flips on when the source is present.
const cbRows: RawGatewayRow[] = [
  row({ tenantId: 'a', chargebackAlerts: 2 }),
  row({ tenantId: 'b', chargebackAlerts: 1 }),
  row({ tenantId: 'c', chargebackAlerts: 0 }),
];
const kcb = computeKpis(cbRows, { chargebacksTracked: true });
ok('kpi chargeback alerts summed', kcb.chargebackAlerts === 3);
ok('kpi chargebacks tracked when sourced', kcb.chargebacksTracked === true);
ok('kpi chargebacks untracked still sums to 0 when no source', computeKpis(cbRows).chargebackAlerts === 3 && computeKpis(cbRows).chargebacksTracked === false);
ok('view carries chargebackAlerts', toGatewayView(row({ chargebackAlerts: 4 })).chargebackAlerts === 4);
ok('view carries branch footprint', (() => { const vv = toGatewayView(row({ branchCount: 3, branches: [{ id: 'b1', name: 'A', city: 'Houston', state: 'TX', status: 'active' }, { id: 'b2', name: 'B', city: 'Dallas', state: 'TX', status: 'active' }, { id: 'b3', name: 'C', city: 'Austin', state: 'TX', status: 'active' }] })); return vv.branchCount === 3 && vv.branches.length === 3 && vv.branches[1].city === 'Dallas'; })());
ok('view carries onboarding status + label', (() => { const vv = toGatewayView(row({ onboardingStatus: 'under_review' })); return vv.onboardingStatus === 'under_review' && vv.onboardingLabel === 'Under Review'; })());
ok('view onboarding defaults to not_started', toGatewayView(row({ onboardingStatus: null })).onboardingStatus === 'not_started');
ok('view carries today processed volume + count', (() => { const vv = toGatewayView(row({ todayVolumeCents: 84_200, todayTxnCount: 7 })); return vv.todayVolumeCents === 84_200 && vv.todayTxnCount === 7; })());
ok('view today volume clamps negatives to 0', toGatewayView(row({ todayVolumeCents: -5, todayTxnCount: -1 })).todayVolumeCents === 0 && toGatewayView(row({ todayVolumeCents: -5, todayTxnCount: -1 })).todayTxnCount === 0);

// ---- statusBreakdown ----
const sb = statusBreakdown(rows);
ok('breakdown active count', (sb.find((s) => s.key === 'active')?.count) === 2);
ok('breakdown omits zero buckets', sb.every((s) => s.count > 0));
ok('breakdown pct present', sb.every((s) => typeof s.pct === 'number'));

// ---- topProcessors ----
const tp = topProcessors(rows);
ok('topProcessors ranks by volume (cardpointe #1)', tp[0].processor === 'cardpointe' && tp[0].rank === 1);
ok('topProcessors active count', (tp.find((p) => p.processor === 'fiserv')?.activeGateways) === 1);
ok('topProcessors excludes none/no-config', tp.every((p) => p.processor && p.processor !== 'none'));

// ---- mapEvent ----
const ev = (o: Partial<RawEventRow>): RawEventRow => ({ id: 'e', tenantName: 'T', processorType: 'fiserv', eventType: null, signatureValid: true, processedAt: '2026-06-10T00:00:00Z', createdAt: '2026-06-10T00:00:00Z', ...o });
ok('event settlement failed', mapEvent(ev({ eventType: 'settlement_failed' })).kind === 'error');
ok('event gateway connected', mapEvent(ev({ eventType: 'gateway_connected' })).label === 'Gateway connected');
ok('event terminal linked', mapEvent(ev({ eventType: 'terminal_paired' })).label === 'Terminal linked');
ok('event chargeback warning', mapEvent(ev({ eventType: 'chargeback_received' })).kind === 'warning');
ok('event bad signature -> error', mapEvent(ev({ eventType: 'settlement', signatureValid: false })).kind === 'error');

// ---- filterGateways ----
const views = rows.map(toGatewayView);
ok('filter search by owner', filterGateways(views, { search: 'owner one' }).length === views.length);
ok('filter search miss', filterGateways(views, { search: 'zzzz-no-match' }).length === 0);
ok('filter status active', filterGateways(views, { status: 'active' }).every((x) => x.gatewayStatus === 'active'));
ok('filter status needs_setup', filterGateways(views, { status: 'needs_setup' }).every((x) => x.gatewayStatus === 'not_configured'));
ok('filter processor fiserv', filterGateways(views, { processor: 'fiserv' }).every((x) => x.processor === 'fiserv'));
ok('filter settlement failed', filterGateways(views, { settlementStatus: 'failed' }).every((x) => x.settlementStatus === 'failed'));
ok('filter date window excludes out-of-range', filterGateways(views, { dateFrom: '2027-01-01', dateTo: '2027-12-31' }).length === 0);
ok('filter all = passthrough', filterGateways(views, { status: 'all', processor: 'all' }).length === views.length);

// ---- paginate ----
const pg = paginate(views, 1, 2);
ok('paginate page size', pg.rows.length === 2);
ok('paginate total', pg.total === views.length);
ok('paginate pages', pg.pages === Math.ceil(views.length / 2));
ok('paginate clamps overshoot page', paginate(views, 999, 2).page === pg.pages);

// ---- toCsv (security) ----
const csv = toCsv(views);
ok('csv has header', csv.split('\n')[0].includes('MID (masked)'));
ok('csv contains masked MID', csv.includes('••••4821'));
ok('csv NEVER contains raw MID', csv.indexOf(RAW_MID_A) === -1 && csv.indexOf('CP7712') === -1);


// ---- Configure Gateway: credential completeness ----
ok('cardpointe requires mid+user+pass+url', requiredGatewayCredentials('cardpointe').length === 4);
ok('clover requires only the bearer secret', requiredGatewayCredentials('clover').join() === 'apiPassword');
ok('none requires nothing', requiredGatewayCredentials('none').length === 0);
ok('missing creds: cardpointe with only MID lists 3 gaps', missingGatewayCredentials('cardpointe', { merchantId: true }).join() === 'apiUsername,apiPassword,baseUrl');
ok('missing creds: complete cardpointe lists none', missingGatewayCredentials('cardpointe', { merchantId: true, apiUsername: true, apiPassword: true, baseUrl: true }).length === 0);
ok('missing creds: clover without secret lists it', missingGatewayCredentials('clover', {}).join() === 'apiPassword');
ok('missing creds: clover with secret is complete', missingGatewayCredentials('clover', { apiPassword: true }).length === 0);

// ---- Configure Gateway: webhook health ----
ok('webhook health: none when empty', webhookHealth([]).status === 'none');
ok('webhook health: healthy when all verified', webhookHealth([{ signatureValid: true, receivedAt: '2026-06-01T00:00:00Z' }]).status === 'healthy');
ok('webhook health: failing on any signature failure', webhookHealth([{ signatureValid: true, receivedAt: '2026-06-01T00:00:00Z' }, { signatureValid: false, receivedAt: '2026-06-02T00:00:00Z' }]).status === 'failing');
ok('webhook health: counts failures', webhookHealth([{ signatureValid: false, receivedAt: 'a' }, { signatureValid: false, receivedAt: 'b' }]).signatureFailures === 2);
ok('webhook health: last received is the max', webhookHealth([{ signatureValid: true, receivedAt: '2026-06-01T00:00:00Z' }, { signatureValid: true, receivedAt: '2026-06-09T00:00:00Z' }]).lastReceivedAt === '2026-06-09T00:00:00Z');

console.log(`payment-gateways-core: ${passed} assertions passed`);
