// devices-overview-core.spec.ts — DB-free harness spec (auto-discovered by scripts/run-core-specs.sh).
// Verifies the pure overview logic: heartbeat-based online/offline, relative labels, status mix, devices-by-branch,
// KPI math, and the honest-null contract for metrics that have no canonical source yet.
import {
  deviceStatus, relativeLabel, statusMix, devicesByBranch, computeKpis, toFleetDevice, buildOverview,
  ONLINE_TIMEOUT_MS, type RawDevice, type RawTerminal,
} from './devices-overview-core';

let passed = 0, failed = 0;
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) === JSON.stringify(b)) { passed++; } else { failed++; console.error(`FAIL: ${m}\n  expected ${JSON.stringify(b)}\n  got      ${JSON.stringify(a)}`); } };
const ok = (c: boolean, m: string) => { if (c) { passed++; } else { failed++; console.error(`FAIL: ${m}`); } };

const NOW = Date.UTC(2026, 4, 6, 14, 34, 0); // May 06 2026 14:34 UTC
const dev = (o: Partial<RawDevice>): RawDevice => ({ id: 'd', name: 'Dev', type: 'iPad', branchId: 'b1', branchName: 'Downtown Branch', station: 'Front Desk', pairingStatus: 'paired', lastSeenMs: NOW - 60_000, revokedMs: null, ...o });

// --- deviceStatus ---
eq(deviceStatus(dev({ lastSeenMs: NOW - 60_000 }), NOW), 'online', 'fresh heartbeat → online');
eq(deviceStatus(dev({ lastSeenMs: NOW - (6 * 60_000) }), NOW), 'offline', 'stale heartbeat → offline');
eq(deviceStatus(dev({ lastSeenMs: NOW - ONLINE_TIMEOUT_MS }), NOW), 'online', 'exactly at timeout → still online');
eq(deviceStatus(dev({ revokedMs: NOW - 1000 }), NOW), 'revoked', 'revoked overrides everything');
eq(deviceStatus(dev({ pairingStatus: 'maintenance' }), NOW), 'maintenance', 'maintenance pairing status');
eq(deviceStatus(dev({ pairingStatus: 'reconnecting' }), NOW), 'reconnecting', 'reconnecting pairing status');
eq(deviceStatus(dev({ pairingStatus: 'unpaired', lastSeenMs: null }), NOW), 'unpaired', 'unpaired + never seen');
eq(deviceStatus(dev({ pairingStatus: 'paired', lastSeenMs: null }), NOW), 'offline', 'paired but never seen → offline');
ok(deviceStatus(dev({ revokedMs: NOW }), NOW) === 'revoked', 'revoked beats fresh heartbeat');

// --- relativeLabel ---
eq(relativeLabel(null, NOW), '—', 'null last-seen → em dash');
eq(relativeLabel(NOW - 30_000, NOW), '30 sec ago', 'seconds label');
eq(relativeLabel(NOW - 60_000, NOW), '1 min ago', 'minutes label');
eq(relativeLabel(NOW - 2 * 3_600_000, NOW), '2 hr ago', 'hours label');
eq(relativeLabel(NOW - 25 * 3_600_000, NOW), '1 day ago', 'one day label singular');
eq(relativeLabel(NOW - 50 * 3_600_000, NOW), '2 days ago', 'multi day label plural');

// --- statusMix ---
eq(statusMix(['online', 'online', 'offline', 'maintenance', 'revoked']), { online: 2, offline: 2, maintenance: 1 }, 'mix buckets non-online/non-maintenance as offline');
eq(statusMix([]), { online: 0, offline: 0, maintenance: 0 }, 'empty mix');

// --- devicesByBranch ---
const byBranch = devicesByBranch([
  { branch: 'Downtown Branch', branchId: 'b1' }, { branch: 'Downtown Branch', branchId: 'b1' },
  { branch: 'Uptown Branch', branchId: 'b2' },
]);
eq(byBranch.length, 2, 'two branches counted');
eq(byBranch[0], { branch: 'Downtown Branch', branchId: 'b1', count: 2 }, 'top branch by count first');
eq(byBranch[1].count, 1, 'second branch count');

// --- computeKpis ---
const fleet = [
  toFleetDevice(dev({ id: '1', lastSeenMs: NOW - 60_000 }), NOW),
  toFleetDevice(dev({ id: '2', lastSeenMs: NOW - 60_000 }), NOW),
  toFleetDevice(dev({ id: '3', lastSeenMs: NOW - 10 * 60_000, branchId: 'b2', branchName: 'Uptown Branch' }), NOW),
];
const terms = [{ id: 't1', label: 'Clover Flex', station: 'Front Desk', status: 'paired' }];
const kpis = computeKpis(fleet, terms);
eq(kpis.connectedDevices, 3, 'connected = fleet length');
eq(kpis.onlineDevices, 2, 'online count from heartbeat');
eq(kpis.onlinePct, 66.7, 'online pct rounded to 1dp');
eq(kpis.paymentTerminals, 1, 'terminal count');
// wave 3 PAYI §50: paired alone is NOT connected — only a terminal that ANSWERED recently (ONLINE) counts
ok(kpis.terminalsAllConnected === false, 'paired terminals that never answered → NOT allConnected (UNKNOWN, honest)');
ok(computeKpis(fleet, [{ id: 'x', label: 'L', station: null, status: 'paired', operationalStatus: 'ONLINE' }]).terminalsAllConnected === true, 'an ONLINE terminal → allConnected');
ok(computeKpis(fleet, [{ id: 'x', label: 'L', station: null, status: 'paired', operationalStatus: 'ONLINE' }, { id: 'y', label: 'M', station: null, status: 'paired', operationalStatus: 'DISABLED' }]).terminalsAllConnected === false, 'a DISABLED terminal → not allConnected');
eq(kpis.locationsConnected, 2, 'distinct branches');
ok(kpis.integrationHealthPct === null && kpis.apiCallsToday === null && kpis.syncSuccessRate === null && kpis.pendingUpdates === null, 'unsourced KPIs are honest null, never fabricated');
ok(computeKpis([], []).onlinePct === null, 'empty fleet → null pct (no divide-by-zero)');
ok(computeKpis(fleet, []).terminalsAllConnected === false, 'no terminals → not allConnected');
ok(computeKpis(fleet, [{ id: 'x', label: 'L', station: null, status: 'unpaired' }]).terminalsAllConnected === false, 'an unpaired terminal → not allConnected');

// --- buildOverview ---
const rawT: RawTerminal[] = [{ id: 't1', label: 'Clover Flex', station: 'Front Desk', status: 'paired', pairedMs: NOW, branchId: 'b1', lastSeenAt: new Date(NOW - 60_000).toISOString() }];
const ov = buildOverview([dev({ id: '1' }), dev({ id: '2', lastSeenMs: NOW - 9 * 60_000 })], rawT, NOW);
ok(ov.terminals[0].operationalStatus === 'ONLINE' && ov.terminals[0].operationalLabel === 'Online', 'overview terminal carries the normalized status (answered 1 min ago → ONLINE)');
ok(buildOverview([], [{ ...rawT[0], lastSeenAt: null }], NOW).terminals[0].operationalStatus === 'UNKNOWN', 'never answered → UNKNOWN');
ok(buildOverview([], [{ ...rawT[0], leaseHolder: 'ticket:9' }], NOW).terminals[0].operationalStatus === 'PROCESSING', 'a live charge lease → PROCESSING');
eq(ov.fleet.length, 2, 'overview fleet length');
eq(ov.terminals.length, 1, 'overview terminals length');
eq(ov.charts.statusMix.online, 1, 'overview status mix online');
eq(ov.charts.integrationHealthMix, null, 'integration health mix honest null (no source)');
eq(ov.charts.syncSuccess7d, [], 'sync 7d empty until a source exists');
ok(ov.fleet[0].lastSyncLabel === '1 min ago', 'fleet device carries relative sync label');

console.log(`\n[devices-overview-core] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
