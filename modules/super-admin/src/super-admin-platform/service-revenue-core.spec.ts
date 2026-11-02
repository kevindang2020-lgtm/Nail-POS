import { topServicesByRevenue } from './super-admin-platform.repository';

// Standalone harness spec (esbuild bundle → node). Validates the pure revenue-ranking helper that backs
// the "Top Services by Revenue" surface on the Global Services Management dashboard.
function check(name: string, cond: boolean) {
  if (!cond) { console.error('FAIL:', name); process.exitCode = 1; } else { console.log('ok:', name); }
}

const perf = [
  { name: 'Hair Cut', bookings: 2145, revenueCents: 2867500 },
  { name: 'Hair Color', bookings: 1487, revenueCents: 3895600 },
  { name: 'Keratin Treatment', bookings: 356, revenueCents: 3245000 },
  { name: 'Facial Treatment', bookings: 1132, revenueCents: 2234000 },
  { name: 'Hair Spa', bookings: 856, revenueCents: 1865000 },
  { name: 'Manicure', bookings: 987, revenueCents: 1200000 },
];

const top = topServicesByRevenue(perf);
check('returns 5 by default', top.length === 5);
check('ranks by revenue desc (Hair Color first)', top[0].name === 'Hair Color');
check('Keratin second despite low bookings', top[1].name === 'Keratin Treatment');
check('Hair Cut third', top[2].name === 'Hair Cut');
check('lowest-revenue Manicure excluded from top 5', !top.some((t) => t.name === 'Manicure'));

// tie-break by bookings when revenue equal
const ties = [
  { name: 'A', bookings: 10, revenueCents: 5000 },
  { name: 'B', bookings: 40, revenueCents: 5000 },
  { name: 'C', bookings: 25, revenueCents: 5000 },
];
const tied = topServicesByRevenue(ties, 3);
check('equal revenue tie-broken by bookings desc', tied[0].name === 'B' && tied[1].name === 'C' && tied[2].name === 'A');

// purity — input not mutated
const before = perf.map((p) => p.name).join(',');
topServicesByRevenue(perf);
check('does not mutate input order', perf.map((p) => p.name).join(',') === before);

// n parameter respected
check('respects n=3', topServicesByRevenue(perf, 3).length === 3);
check('handles empty', topServicesByRevenue([], 5).length === 0);

console.log('service-revenue-core: done');
