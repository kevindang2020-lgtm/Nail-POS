import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { POSQueueScreen } from '../src/screens/POSQueueScreen';
import { posQueueApi } from '../src/api/posQueueApi';

const MAIN = ['Overview', 'Live Operations Dashboard', 'Check-In', 'Booking', 'Tech Queue', 'Customer Queue', 'Serving', 'Service Done', 'Checkout'];
const GROUPS = ['CUSTOMERS', 'TEAM', 'SERVICES & PRODUCTS', 'PAYMENTS & MONEY', 'COMMUNICATIONS', 'MARKETING & GROWTH', 'AI CENTER', 'REPORTS', 'MANAGEMENT', 'DEVICES & INTEGRATIONS', 'ACCOUNT'];
const agoIso = (m: number) => new Date(Date.now() - m * 60000).toISOString();
let n = 0;
const Q = (name: string, source: string, service: string, reqTech: string, wait: number, priority: string, status: string, vip = false, bestMatch?: string) =>
  ({ queueItemId: 'q' + (++n), customerName: name, source, isVip: vip, requestedServices: [{ serviceName: service, priceCents: 9500 }], serviceCount: 1, priority, status,
     requestedTechnicianName: reqTech === 'Any' ? undefined : reqTech, bestMatchTechnicianName: bestMatch, assignedTechnicianName: status === 'assigned' ? reqTech : null, checkedInAt: agoIso(wait), actualWaitMinutes: wait });

const STATE = {
  kpis: { waitingGuests: 24, averageWaitMinutes: 28, longestWaitMinutes: 49, vipWaiting: 5, appointmentsWaiting: 6, walkInsWaiting: 14, readyForTech: 11, assignedTechnicians: 6, delayedQueueItems: 3, readyForAssignment: 8, estQueueRevenueCents: 487500, readyForService: 11, noShowRisk: 3, returnRatePercent: 68 },
  kpiTrends: {
    waiting: { deltaPercent: 10.2, direction: 'up' }, walkIns: { deltaPercent: 12.9, direction: 'up' }, vip: { deltaPercent: 25, direction: 'up' }, readyForAssignment: { deltaPercent: 33.3, direction: 'up' },
    avgWait: { deltaPercent: null, direction: 'down', text: '5 min' }, estRevenue: { deltaPercent: 19.4, direction: 'up' }, readyForService: { deltaPercent: 10, direction: 'up' }, noShowRisk: { deltaPercent: 25, direction: 'down' }, returnRate: { deltaPercent: 6.7, direction: 'up' },
  },
  analytics: {
    queueTrend: [{ hour: 8, count: 6 }, { hour: 9, count: 9 }, { hour: 10, count: 12 }, { hour: 11, count: 14 }, { hour: 12, count: 17 }, { hour: 13, count: 20 }, { hour: 14, count: 24 }, { hour: 15, count: 22 }, { hour: 16, count: 19 }, { hour: 17, count: 16 }, { hour: 18, count: 12 }, { hour: 19, count: 9 }, { hour: 20, count: 6 }],
    customerTypeMix: [{ label: 'Returning', sharePercent: 48, count: 52 }, { label: 'New', sharePercent: 26, count: 28 }, { label: 'VIP', sharePercent: 10, count: 11 }, { label: 'Walk-In', sharePercent: 16, count: 17 }],
    visitSourceMix: [{ label: 'App', sharePercent: 28, count: 30 }, { label: 'Phone', sharePercent: 22, count: 24 }, { label: 'Walk-In', sharePercent: 32, count: 35 }, { label: 'AI Receptionist', sharePercent: 10, count: 11 }, { label: 'In Person', sharePercent: 8, count: 9 }],
    topWaitingServices: [{ service: 'Gel X Full Set', count: 9, sharePercent: 37 }, { service: 'Pedicure', count: 6, sharePercent: 25 }, { service: 'Acrylic Full Set', count: 5, sharePercent: 21 }, { service: 'Nail Art', count: 3, sharePercent: 12 }, { service: 'Gel Manicure', count: 1, sharePercent: 4 }],
    conversion: { percent: 62, goalPercent: 70, deltaPercent: 6 },
    potentialRevenueByService: [{ service: 'Gel X Full Set', revenueCents: 210000 }, { service: 'Pedicure', revenueCents: 135000 }, { service: 'Acrylic Full Set', revenueCents: 95000 }, { service: 'Nail Art', revenueCents: 47500 }],
    potentialRevenueTotalCents: 487500, potentialRevenueDeltaPercent: 19.4,
  },
  staff: [
    { name: 'Charlotte Taylor', specialty: 'Acrylic, Gel X', currentLoad: 3, nextAvailable: '5 min', status: 'Available' },
    { name: 'Lily Adams', specialty: 'Gel, Designs', currentLoad: 2, nextAvailable: '10 min', status: 'Available' },
    { name: 'Mia Johnson', specialty: 'Pedicure, Spa', currentLoad: 2, nextAvailable: '12 min', status: 'Available' },
    { name: 'Sophia Martinez', specialty: 'Nail Art, Designs', currentLoad: 3, nextAvailable: '15 min', status: 'Busy' },
    { name: 'Grace Hall', specialty: 'Gel X, Enhancements', currentLoad: 2, nextAvailable: '18 min', status: 'Available' },
    { name: 'Olivia Bennett', specialty: 'Pedicure, Gel', currentLoad: 2, nextAvailable: '22 min', status: 'Busy' },
  ],
  insights: [
    { id: 'i1', text: 'Peak arrival window: 1:00 PM - 3:00 PM', sub: 'High volume detected. Consider adding staff.', action: 'Auto Balance Queue', route: '/queue' },
    { id: 'i2', text: 'Jessica Miller has waited 32 min', sub: 'VIP guest. Recommend priority assignment.', action: 'Assign VIP Now', route: '/queue', severity: 'warn' },
    { id: 'i3', text: "3 guests haven't confirmed in 10+ min", sub: 'Send automated wait update?', action: 'Send Wait Update', route: '/queue' },
    { id: 'i4', text: '2 appointments at risk of being late', sub: 'Check in or confirm to avoid delays.', action: 'Review Now', route: '/queue' },
    { id: 'i5', text: 'Upsell opportunity: 11 guests', sub: 'Recommend add-ons for pedicure services.', action: 'View Suggestions', route: '/queue' },
  ],
  queue: { items: [
    // Live Customer Queue (8 reference rows)
    Q('Jessica Miller', 'walk_in', 'Acrylic Full Set', 'Any', 2, 'normal', 'waiting', false, 'Charlotte T.'),
    Q('Olivia Brown', 'walk_in', 'Gel X Full Set', 'Charlotte T.', 6, 'vip', 'waiting', true, 'Charlotte T.'),
    Q('Emma Wilson', 'appointment', 'Gel X Full Set', 'Lily Adams', 19, 'high', 'ready_for_tech', false, 'Lily Adams'),
    Q('Isabella Davis', 'walk_in', 'Pedicure', 'Any', 24, 'normal', 'waiting', false, 'Mia J.'),
    Q('Sophia Martinez', 'walk_in', 'Nail Art', 'Sophia M.', 29, 'high', 'waiting', false, 'Sophia M.'),
    Q('Mia Johnson', 'appointment', 'Spa Pedicure', 'Mia J.', 39, 'normal', 'assigned'),
    Q('Charlotte Taylor', 'walk_in', 'Enhancements', 'Any', 44, 'high', 'ready_for_tech', false, 'Grace H.'),
    Q('Ava Thompson', 'walk_in', 'Spa Pedicure', 'Any', 49, 'normal', 'waiting', false, 'Mia J.'),
    // Board fillers — Arrived (waited<5, status waiting)
    Q('Layla Kim', 'walk_in', 'Gel Manicure', 'Any', 1, 'normal', 'waiting'),
    Q('Hannah Lee', 'walk_in', 'Pedicure', 'Any', 2, 'normal', 'waiting'),
    Q('Amelia Clark', 'walk_in', 'Nail Art', 'Any', 3, 'normal', 'waiting'),
    // Assigned to Tech (status assigned)
    Q('Lily Adams', 'appointment', 'Gel Manicure', 'Lily A.', 25, 'normal', 'assigned'),
    Q('Grace Hall', 'appointment', 'Gel X Full Set', 'Grace H.', 30, 'normal', 'assigned'),
    // Ready for Service (status ready_for_tech)
    Q('Emily Roberts', 'walk_in', 'Acrylic Full Set', 'Any', 12, 'normal', 'ready_for_tech'),
    Q('Daniela Ruiz', 'walk_in', 'Pedicure', 'Any', 14, 'normal', 'ready_for_tech'),
    Q('Chloe Nguyen', 'walk_in', 'Gel Manicure', 'Any', 16, 'normal', 'ready_for_tech'),
  ], pagination: { page: 1, pageSize: 20, totalItems: 24, totalPages: 2 } },
  filters: { statuses: ['waiting', 'called', 'assigned', 'ready_for_tech', 'in_service', 'cancelled'], sources: [], technicians: [], serviceCategories: ['Acrylic Full Set', 'Gel X Full Set', 'Pedicure', 'Nail Art'], priorityLevels: [], stations: [] },
};

const DETAIL = {
  queueItemId: 'q1', customerName: 'Jessica Miller', customerPhone: '(555) 123-4567', email: 'jessica.miller@email.com', isVip: true, priority: 'vip',
  requestedServices: [{ serviceName: 'Acrylic Full Set' }], assignedTechnicianName: null,
  loyaltyPoints: 2450, visitCount: 28, totalSpendCents: 126000, birthday: 'Jun 12', preferredTechName: 'Charlotte Taylor',
  notes: 'Prefers almond shape. Likes neutral colors.', allergies: 'Latex allergy · No strong scents',
};

(posQueueApi as any).state = async () => STATE;
(posQueueApi as any).item = async () => DETAIL;

function Shell() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '248px minmax(0,1fr)', height: '100%', background: 'var(--page)' }}>
      <div style={{ background: 'var(--sidebar)', borderRight: '1px solid var(--line)', overflow: 'hidden', fontSize: 12.5 }}>
        <div style={{ padding: '14px 16px 8px' }}><img src="../public/brand/aipowersalon-logo.png" alt="AI PowerSalon" style={{ width: '100%', maxWidth: 184, display: 'block' }} /></div>
        <div style={{ padding: '6px 10px' }}>
          {MAIN.map((m) => { const active = m === 'Customer Queue'; return (
            <a key={m} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px', borderRadius: 9, fontWeight: active ? 800 : 600, color: active ? '#fff' : '#6D5F50', background: active ? 'var(--aps-orange)' : 'transparent', marginBottom: 1 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: active ? '#fff' : '#E2C686' }} />{m}</a>
          ); })}
          {GROUPS.map((g) => <div key={g} style={{ fontSize: 9, color: '#8A7A66', fontWeight: 800, letterSpacing: '.07em', padding: '9px 8px 2px' }}>{g}</div>)}
          <div style={{ marginTop: 10, border: '1px solid var(--gline)', borderRadius: 10, padding: '8px 10px', background: '#FFFDF8' }}><div style={{ fontSize: 11, fontWeight: 700, color: 'var(--aps-orange)' }}>Visit AI PowerSalon Help Center</div></div>
          <div style={{ marginTop: 8, fontSize: 11 }}><b>System Status</b><div style={{ color: '#2E9E54', marginTop: 2 }}>● All Systems Operational</div><div style={{ color: '#8A7A66' }}>v2.4.1</div></div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateRows: '56px minmax(0,1fr)', height: '100%', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0 20px', borderBottom: '1px solid var(--line)', background: 'var(--card)' }}>
          <div style={{ fontWeight: 800, fontSize: 13 }}>Luxe Nails &amp; Spa<span style={{ display: 'block', fontSize: 9.5, color: '#8A7A66', fontWeight: 600 }}>Downtown Branch</span></div>
          <div style={{ flex: 1, maxWidth: 430, height: 38, border: '1px solid var(--line)', borderRadius: 11, background: '#FFFDF8', display: 'flex', alignItems: 'center', padding: '0 12px', color: '#9a8c79', fontSize: 12.5 }}>⌕ &nbsp;Search customers, appointments, services, transactions...</div>
          <div style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, textAlign: 'right' }}>May 06, 2026<span style={{ display: 'block', fontSize: 11, color: '#8A7A66' }}>2:34 PM</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginLeft: 8 }}><div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--grad)', border: '1px solid #C9933B' }} /><div><div style={{ fontSize: 12, fontWeight: 700 }}>Sophia Nguyen</div><div style={{ fontSize: 10, color: '#8A7A66' }}>Owner</div></div></div>
        </div>
        <div style={{ height: '100%', overflow: 'hidden' }}><POSQueueScreen /></div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('story')!).render(<MemoryRouter><div className="frame"><Shell /></div></MemoryRouter>);
