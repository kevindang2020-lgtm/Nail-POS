import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { POSServingScreen } from '../src/screens/POSServingScreen';
import { posServingApi } from '../src/api/posServingApi';

const MAIN = ['Overview', 'Live Operations Dashboard', 'Check-In', 'Booking', 'Tech Queue', 'Customer Queue', 'Serving', 'Service Done', 'Checkout'];
const GROUPS = ['CUSTOMERS', 'TEAM', 'SERVICES & PRODUCTS', 'PAYMENTS & MONEY', 'COMMUNICATIONS', 'MARKETING & GROWTH', 'AI CENTER', 'REPORTS', 'MANAGEMENT', 'DEVICES & INTEGRATIONS', 'ACCOUNT'];
const agoIso = (m: number) => new Date(Date.now() - m * 60000).toISOString();
let n = 0;
// status drives board column; startedAt drives the live elapsed shown on the floor.
const T = (name: string, tech: string, service: string, stage: string, elapsed: number, addon: string, status = 'in_service', vip = false) =>
  ({ ticketId: 't' + (++n), ticketNumber: 'SV' + n, customerName: name, isVip: vip, serviceCount: 1, serviceNames: [service], stage, addOnsLabel: addon || undefined,
     primaryTechnicianName: tech, startedAt: agoIso(elapsed), estimatedEndAt: new Date(Date.now() + (60 - elapsed) * 60000).toISOString(), elapsedMinutes: elapsed, estimatedDurationMinutes: 60, subtotalCents: 9500, status });

const STATE = {
  kpis: { servingNow: 21, activeTickets: 21, delayedServices: 3, nearingCompletion: 8, averageServiceDurationMinutes: 52, totalInServiceSalesCents: 338000, techniciansInService: 8, techniciansTotal: 12, servicesCompletedToday: 27, addOnAttachRatePercent: 31.4, addOnRevenueCents: 48620, customerSatisfactionAvg: 4.8, onTimeCompletionPercent: 87 },
  kpiTrends: {
    readyToFinish: { deltaPercent: null, direction: 'up', text: '2' }, avgTime: { deltaPercent: null, direction: 'down', text: '6 min' },
    addOnConversion: { deltaPercent: 5.2, direction: 'up' }, delayed: { deltaPercent: null, direction: 'up', text: '1' },
    upsellRevenue: { deltaPercent: 10.6, direction: 'up' }, satisfaction: { deltaPercent: null, direction: 'up', text: '0.2' }, onTime: { deltaPercent: null, direction: 'up', text: '2%' },
  },
  analytics: {
    serviceTimeTrend: [{ hour: 8, minutes: 44 }, { hour: 9, minutes: 47 }, { hour: 10, minutes: 50 }, { hour: 11, minutes: 49 }, { hour: 12, minutes: 46 }, { hour: 13, minutes: 51 }, { hour: 14, minutes: 52 }, { hour: 15, minutes: 50 }, { hour: 16, minutes: 53 }, { hour: 17, minutes: 51 }],
    serviceMix: [{ category: 'Acrylic Full Set', sharePercent: 38, count: 8 }, { category: 'Gel X Full Set', sharePercent: 28, count: 6 }, { category: 'Pedicure', sharePercent: 18, count: 4 }, { category: 'Nail Art', sharePercent: 10, count: 2 }, { category: 'Gel Manicure', sharePercent: 6, count: 1 }],
    addOnMix: [{ label: 'Nail Art', sharePercent: 34, count: 13 }, { label: 'Gel Polish', sharePercent: 26, count: 10 }, { label: 'French Tip', sharePercent: 18, count: 7 }, { label: 'Paraffin', sharePercent: 14, count: 5 }, { label: 'Waxing', sharePercent: 8, count: 3 }],
    funnel: { started: 31, finishing: 16, serviceDone: 27, completionRatePercent: 87.1 },
    potentialRevenue: { totalCents: 498000, inServiceCents: 338000, addOnsPendingCents: 86000, finishingSoonCents: 48000, readyToCompleteCents: 26000 },
    potentialRevenueDeltaPercent: 14.6,
  },
  techPerformance: [
    { technicianId: 'a', name: 'Lily Adams', activeGuests: 4, revenueCents: 112000, tipsCents: 18000, utilizationPercent: 92, avgMinutes: 54, rating: 4.9 },
    { technicianId: 'b', name: 'Mia Johnson', activeGuests: 5, revenueCents: 90000, tipsCents: 14200, utilizationPercent: 88, avgMinutes: 51, rating: 4.8 },
    { technicianId: 'c', name: 'Emma Wilson', activeGuests: 4, revenueCents: 86000, tipsCents: 13100, utilizationPercent: 85, avgMinutes: 55, rating: 4.7 },
    { technicianId: 'd', name: 'Sophia Martinez', activeGuests: 3, revenueCents: 72000, tipsCents: 9900, utilizationPercent: 78, avgMinutes: 58, rating: 4.6 },
    { technicianId: 'e', name: 'Charlotte Taylor', activeGuests: 3, revenueCents: 61000, tipsCents: 8000, utilizationPercent: 72, avgMinutes: 56, rating: 4.5 },
    { technicianId: 'f', name: 'Grace Hall', activeGuests: 2, revenueCents: 41000, tipsCents: 6000, utilizationPercent: 66, avgMinutes: 50, rating: 4.4 },
  ],
  staff: [
    { name: 'Olivia Brown', specialty: 'Nails, Gel', currentLoad: 2, nextAvailable: '10 min', status: 'Finishing Soon' },
    { name: 'Samantha Green', specialty: 'Nails, Gel, Pedi', currentLoad: 1, nextAvailable: '15 min', status: 'Available' },
    { name: 'Emily Roberts', specialty: 'Pedicure, Spa', currentLoad: 1, nextAvailable: '20 min', status: 'Available' },
    { name: 'Ava Thompson', specialty: 'Nail Art, Design', currentLoad: 0, nextAvailable: 'Now', status: 'Available' },
    { name: 'Isabella Davis', specialty: 'Pedicure, Spa', currentLoad: 0, nextAvailable: 'Now', status: 'Available' },
  ],
  insights: [
    { id: 'i1', text: '2 services are nearing overtime duration', sub: 'Review and rebalance now.', action: 'Review Now', route: '/serving', severity: 'warn' },
    { id: 'i2', text: 'Mia Johnson can upsell paraffin to 3 pedicure guests', action: 'View Suggestions', route: '/serving' },
    { id: 'i3', text: 'Jessica Miller has waited 8 min for polish stage handoff', action: 'Reassign', route: '/serving' },
    { id: 'i4', text: 'Peak finishing window: 3:00 PM - 4:00 PM', sub: 'Plan tech coverage.', action: 'Balance Load', route: '/serving' },
    { id: 'i5', text: '1 VIP guest should be checked by manager', sub: 'Review VIP service quality.', action: 'Open Profile', route: '/customers' },
    { id: 'i6', text: 'Low inventory risk for Gel Polish - Rose', sub: 'Stock is running low.', action: 'View Inventory', route: '/tenant/products', severity: 'warn' },
  ],
  tickets: { items: [
    // Live Service Floor (first 10, fine stages)
    T('Jessica Miller', 'Lily Adams', 'Acrylic Full Set', 'In Service', 36, 'Nail Art', 'in_service', true),
    T('Olivia Brown', 'Emma Wilson', 'Acrylic Full Set', 'Polish', 34, 'French Tip'),
    T('Emma Wilson', 'Mia Johnson', 'Gel X Full Set', 'Prep', 33, ''),
    T('Isabella Davis', 'Sophia Martinez', 'Pedicure', 'In Service', 32, 'Paraffin'),
    T('Sophia Martinez', 'Charlotte Taylor', 'Nail Art', 'Drying', 30, 'Chrome'),
    T('Mia Johnson', 'Grace Hall', 'Spa Pedicure', 'Polish', 29, 'Paraffin'),
    T('Grace Hall', 'Olivia Brown', 'Gel Manicure', 'Quality Check', 28, ''),
    T('Charlotte Taylor', 'Lily Adams', 'Enhancements', 'In Service', 27, 'French Tip'),
    T('Lily Adams', 'Samantha Green', 'Gel X Full Set', 'Prep', 24, ''),
    T('Samantha Green', 'Mia Johnson', 'Waxing', 'Finishing Soon', 18, ''),
    // Just Started fillers (elapsed<12)
    T('Emily Roberts', 'Olivia B.', 'Pedicure', 'Just Started', 8, 'Pedi'),
    T('Ava Thompson', 'Charlotte T.', 'Nail Art', 'Just Started', 5, 'Nail Art'),
    T('Harper Lee', 'Grace H.', 'Waxing', 'Just Started', 3, 'Wax'),
    // Finishing soon fillers (>=51 of 60)
    T('Lily Rodriguez', 'Emma W.', 'Acrylic Fill', 'Finishing Soon', 53, 'Gel Polish'),
    T('Maria Garcia', 'Lily Adams', 'Spa Pedicure', 'Finishing Soon', 55, 'Hot Stone'),
    T('Amy Chen', 'Samantha G.', 'Acrylic Full Set', 'Finishing Soon', 57, 'Chrome'),
    // Ready for Service Done (status)
    T('Emma Davis', 'Mia Johnson', 'Gel X Full Set', 'Ready', 15, 'Gel', 'sent_to_service_done', true),
    T('Samantha Reed', 'Mia Johnson', 'Gel X Full Set', 'Ready', 12, 'Gel', 'sent_to_service_done'),
    T('Ava Rodriguez', 'Grace Hall', 'Pedicure', 'Ready', 10, 'Pedi', 'sent_to_service_done'),
    // balance fillers across Just Started / Finishing Soon
    T('Nicole Perez', 'Sophia M.', 'Pedicure', 'Just Started', 9, 'Paraffin'),
    T('Daniel Kim', 'Emma W.', 'Gel Manicure', 'Finishing Soon', 54, 'Gel Polish'),
  ], pagination: { totalItems: 21 } },
  filters: { statuses: [], technicians: [], serviceCategories: ['Acrylic Full Set', 'Gel X Full Set', 'Pedicure', 'Nail Art', 'Gel Manicure'], stations: [], delayStatuses: [] },
};

const DETAIL = {
  ticketId: 't1', ticketNumber: 'SV1',
  customer: { customerId: 'c1', fullName: 'Jessica Miller', phone: '(415) 555-1212', isVip: true, loyaltyPoints: 2450, preferredTechName: 'Lily Adams' },
  services: [
    { serviceLineId: 'l1', serviceName: 'Acrylic Full Set', category: 'Nail Enhancements', technicianName: 'Lily Adams', priceCents: 7500, isAddOn: false, status: 'in_service' },
    { serviceLineId: 'l2', serviceName: 'Nail Art', category: 'Add-On', technicianName: 'Lily Adams', priceCents: 1500, isAddOn: true, status: 'queued' },
    { serviceLineId: 'l3', serviceName: 'French Tip', category: 'Add-On', technicianName: 'Lily Adams', priceCents: 500, isAddOn: true, status: 'queued' },
  ],
  primaryTechnician: { technicianId: 'lily', name: 'Lily Adams' }, estimatedEndAt: new Date(Date.now() + 39 * 60000).toISOString(), elapsedMinutes: 36, estimatedDurationMinutes: 75,
  subtotalCents: 9500, customerVisibleNotes: 'Prefers almond shape. Loves glitter ombre. Sensitive skin.', notes: 'Latex sensitivity, prefers acetone-free remover.',
};

(posServingApi as any).state = async () => STATE;
(posServingApi as any).ticket = async () => DETAIL;
(posServingApi as any).pendingChangeRequests = async () => [];
(posServingApi as any).technicians = async () => [];

function Shell() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '248px minmax(0,1fr)', height: '100%', background: 'var(--page)' }}>
      <div style={{ background: 'var(--sidebar)', borderRight: '1px solid var(--line)', overflow: 'hidden', fontSize: 12.5 }}>
        <div style={{ padding: '14px 16px 8px' }}><img src="../public/brand/aipowersalon-logo.png" alt="AI PowerSalon" style={{ width: '100%', maxWidth: 184, display: 'block' }} /></div>
        <div style={{ padding: '6px 10px' }}>
          {MAIN.map((m) => { const active = m === 'Serving'; return (
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
        <div style={{ height: '100%', overflow: 'hidden' }}><POSServingScreen /></div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('story')!).render(<MemoryRouter><div className="frame"><Shell /></div></MemoryRouter>);
