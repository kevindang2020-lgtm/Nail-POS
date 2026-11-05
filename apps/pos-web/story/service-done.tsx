import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { POSServiceDoneScreen } from '../src/screens/POSServiceDoneScreen';
import { posServiceDoneApi } from '../src/api/posServiceDoneApi';

const MAIN = ['Overview', 'Dashboard', 'Check-In', 'Booking', 'Tech Queue', 'Customer Queue', 'Serving', 'Service Done', 'Checkout'];
const GROUPS = ['CUSTOMERS', 'TEAM', 'SERVICES & PRODUCTS', 'PAYMENTS & MONEY', 'COMMUNICATIONS', 'MARKETING & GROWTH', 'AI CENTER', 'REPORTS', 'MANAGEMENT', 'DEVICES & INTEGRATIONS', 'ACCOUNT'];
const ago = (m: number) => new Date(Date.now() - m * 60000).toISOString();
let n = 0;
const T = (name: string, tech: string, svc: string, addon: string, total: number, tip: number, mins: number, quality: string, checkout: string, status = 'service_done') =>
  ({ ticketId: 't' + (++n), ticketNumber: 'SD' + n, customerName: name, primaryTechnicianName: tech, serviceCount: 1, serviceNames: [svc], addOnsLabel: addon || undefined, tipCents: tip, completedAt: ago(mins), durationMinutes: 50, subtotalCents: total, qualityStatus: quality, checkoutStatus: checkout, status });

const STATE = {
  kpis: { completedServicesToday: 27, ticketsReadyForReview: 11, ticketsReadyForCheckout: 8, qualityIssuesCount: 1, reopenedServicesToday: 0, averageServiceDurationMinutes: 52, estimatedSalesCents: 324000, estimatedCommissionCents: 64800, addOnRevenueCents: 48620, averageTurnaroundSeconds: 360, customerSatisfactionAvg: 4.8, tipsCapturedCents: 124800, rebookingRatePercent: 31.4, completionAccuracyPercent: 97 },
  kpiTrends: {
    completed: { deltaPercent: 17.4, direction: 'up' }, ready: { deltaPercent: 33.3, direction: 'up' },
    duration: { deltaPercent: null, direction: 'down', text: '4 min' }, turnaround: { deltaPercent: null, direction: 'down', text: '2 min' },
    addon: { deltaPercent: 18.6, direction: 'up' }, tips: { deltaPercent: 21.2, direction: 'up' },
    rebooking: { deltaPercent: 6.1, direction: 'up' }, satisfaction: { deltaPercent: null, direction: 'up', text: '0.3' }, accuracy: { deltaPercent: 2.5, direction: 'up' },
  },
  analytics: {
    completionTrend: [{ hour: 9, count: 6 }, { hour: 10, count: 12 }, { hour: 11, count: 18 }, { hour: 12, count: 16 }, { hour: 13, count: 14 }, { hour: 14, count: 22 }, { hour: 15, count: 27 }, { hour: 16, count: 24 }, { hour: 17, count: 20 }],
    serviceMix: [{ category: 'Nail Enhancements', sharePercent: 44, count: 44 }, { category: 'Pedicure', sharePercent: 28, count: 28 }, { category: 'Manicure', sharePercent: 16, count: 16 }, { category: 'Nail Art', sharePercent: 8, count: 8 }, { category: 'Spa', sharePercent: 4, count: 4 }],
    addOnMix: [{ label: 'Gel Polish', sharePercent: 34, count: 34 }, { label: 'Nail Art', sharePercent: 24, count: 24 }, { label: 'French Tip', sharePercent: 16, count: 16 }, { label: 'Paraffin', sharePercent: 14, count: 14 }, { label: 'Other', sharePercent: 12, count: 12 }],
    funnel: { completed: 27, inReview: 11, readyForCheckout: 8, sentToFrontDesk: 4 },
    potentialRevenue: { totalCents: 498000, serviceCents: 324000, addOnCents: 48620, tipsEstCents: 124800, taxesEstCents: 580 },
    completionTrendDeltaPercent: null, potentialRevenueDeltaPercent: 19.6,
  },
  techPerformance: [
    { technicianId: 'a', name: 'Lily Adams', completedGuests: 6, revenueCents: 56000, tipsCents: 12400, avgMinutes: 48, rating: 4.9 },
    { technicianId: 'b', name: 'Mia Johnson', completedGuests: 5, revenueCents: 47500, tipsCents: 10300, avgMinutes: 51, rating: 4.8 },
    { technicianId: 'c', name: 'Emma Wilson', completedGuests: 5, revenueCents: 45500, tipsCents: 9800, avgMinutes: 50, rating: 4.8 },
    { technicianId: 'd', name: 'Sophia Martinez', completedGuests: 4, revenueCents: 39000, tipsCents: 8400, avgMinutes: 47, rating: 4.9 },
    { technicianId: 'e', name: 'Charlotte Taylor', completedGuests: 4, revenueCents: 36000, tipsCents: 7200, avgMinutes: 49, rating: 4.8 },
    { technicianId: 'f', name: 'Grace Hall', completedGuests: 3, revenueCents: 26500, tipsCents: 5300, avgMinutes: 46, rating: 4.7 },
  ],
  staff: [
    { name: 'Grace Hall', specialty: 'Pedicure, Gel', currentLoadBusy: 2, currentLoadCap: 3, nextAvailable: '2:45 PM', status: 'Available' },
    { name: 'Sophia Martinez', specialty: 'Nail Art, Design', currentLoadBusy: 1, currentLoadCap: 2, nextAvailable: '2:50 PM', status: 'Finishing Soon' },
    { name: 'Charlotte Taylor', specialty: 'Acrylic, Gel X', currentLoadBusy: 2, currentLoadCap: 3, nextAvailable: '2:55 PM', status: 'Busy' },
    { name: 'Lily Adams', specialty: 'Gel X, Fill', currentLoadBusy: 2, currentLoadCap: 3, nextAvailable: '3:00 PM', status: 'Available' },
    { name: 'Emma Wilson', specialty: 'Manicure, Gel', currentLoadBusy: 1, currentLoadCap: 2, nextAvailable: '3:05 PM', status: 'Available' },
    { name: 'Mia Johnson', specialty: 'Pedicure, Spa', currentLoadBusy: 2, currentLoadCap: 3, nextAvailable: '3:10 PM', status: 'Finishing Soon' },
  ],
  insights: [
    { id: 'i1', text: '3 completed guests have not been moved to checkout in 10+ min', action: 'Review Now', route: '/service-done', severity: 'warn' },
    { id: 'i2', text: 'Jessica Miller is a VIP guest', sub: 'Prompt rebooking before checkout.', action: 'Open Profile', route: '/customers' },
    { id: 'i3', text: '2 guests eligible for upsell retail products', action: 'View Suggestions', route: '/service-done' },
    { id: 'i4', text: 'Peak checkout wave expected 3:00 PM - 4:00 PM', action: 'Balance Handoff', route: '/service-done' },
    { id: 'i5', text: 'Gel Polish - Rose inventory low', sub: '5 left. Reorder recommended.', action: 'View Inventory', route: '/tenant/products', severity: 'warn' },
  ],
  tickets: { items: [
    // queue-visible first 8 (mixed statuses)
    T('Jessica Miller', 'Samantha G.', 'Acrylic Full Set', 'Gel Art', 9500, 2000, 5, 'needs_review', 'ready_for_checkout'),
    T('Olivia Brown', 'Charlotte T.', 'Gel X Full Set', 'French Tip', 8500, 1800, 10, 'needs_review', 'not_ready'),
    T('Emma Wilson', 'Lily Adams', 'Gel X Full Set', 'Chrome', 9000, 2200, 2, 'pending', 'waiting_payment'),
    T('Isabella Davis', 'Mia Johnson', 'Pedicure', 'Paraffin', 6500, 1500, 6, 'approved', 'ready_for_checkout'),
    T('Sophia Martinez', 'Sophia M.', 'Nail Art', 'Design', 7000, 1200, 7, 'needs_review', 'not_ready'),
    T('Mia Johnson', 'Grace Hall', 'Spa Pedicure', 'Hot Stone', 7500, 1700, 4, 'pending', 'waiting_payment'),
    T('Grace Hall', 'Emma W.', 'Gel Manicure', '', 5500, 1000, 6, 'approved', 'ready_for_checkout'),
    T('Charlotte Taylor', 'Lily Adams', 'Enhancements', 'French Tip', 8000, 1600, 8, 'approved', 'ready_for_checkout', 'sent_to_checkout'),
    // remaining board cards
    T('Ava Thompson', 'Mia Johnson', 'Spa Pedicure', 'Paraffin', 6800, 1400, 9, 'pending', 'not_ready'),
    T('Lily Rodriguez', 'Emma W.', 'Acrylic Fill', 'Gel Polish', 7200, 1500, 8, 'approved', 'ready_for_checkout'),
    T('Maria Garcia', 'Lily Adams', 'Spa Pedicure', 'Hot Stone', 7600, 1600, 11, 'approved', 'ready_for_checkout'),
    T('Amy Chen', 'Samantha G.', 'Acrylic Full Set', 'Chrome', 9500, 2000, 12, 'approved', 'ready_for_checkout'),
    T('Michelle Lee', 'Sophia M.', 'Nail Art', 'Design', 7000, 1300, 13, 'approved', 'ready_for_checkout'),
    T('Nicole Perez', 'Grace Hall', 'Pedicure', 'Paraffin', 6500, 1500, 15, 'approved', 'ready_for_checkout', 'sent_to_checkout'),
    T('Emily Davis', 'Lily Adams', 'Acrylic Full Set', 'French Tip', 9500, 2000, 18, 'approved', 'ready_for_checkout', 'sent_to_checkout'),
    T('Daniel Kim', 'Emma W.', 'Gel Manicure', 'Gel Polish', 5500, 1000, 22, 'approved', 'ready_for_checkout', 'sent_to_checkout'),
    T('James Wilson', 'Mia Johnson', 'Spa Pedicure', 'Hot Stone', 7500, 1700, 22, 'approved', 'ready_for_checkout', 'sent_to_checkout'),
  ], pagination: { totalItems: 17 } },
  filters: { statuses: [], technicians: [], serviceCategories: ['Nail Enhancements', 'Pedicure', 'Manicure', 'Nail Art', 'Spa'], qualityStatuses: [], stations: [] },
};

const DETAIL = {
  ticketId: 't1', ticketNumber: 'SD1',
  customer: { customerId: 'c1', fullName: 'Jessica Miller', phone: '(555) 123-4567', isVip: true, loyaltyPoints: 1250, visitCount: 18, totalSpendCents: 184500 },
  services: [
    { serviceLineId: 'l1', serviceName: 'Acrylic Full Set', category: 'Nail Enhancements', technicianName: 'Samantha Green', priceCents: 7500, isAddOn: false },
    { serviceLineId: 'l2', serviceName: 'Gel Polish', category: 'Add-On', technicianName: 'Samantha Green', priceCents: 1000, isAddOn: true },
    { serviceLineId: 'l3', serviceName: 'Nail Art', category: 'Add-On', technicianName: 'Samantha Green', priceCents: 1000, isAddOn: true },
  ],
  primaryTechnician: { technicianId: 'tg', name: 'Samantha Green' }, subtotalCents: 9500,
  customerVisibleNotes: 'Loves floral designs. Prefers soft colors.',
  rebooking: { label: 'Fill in 2–3 weeks', window: 'May 20 – May 27' },
};

(posServiceDoneApi as any).state = async () => STATE;
(posServiceDoneApi as any).ticket = async () => DETAIL;

function Shell() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '248px minmax(0,1fr)', height: '100%', background: 'var(--page)' }}>
      <div style={{ background: 'var(--sidebar)', borderRight: '1px solid var(--line)', overflow: 'hidden', fontSize: 12.5 }}>
        <div style={{ padding: '14px 16px 8px' }}><img src="../public/brand/aipowersalon-logo.png" alt="AI PowerSalon" style={{ width: '100%', maxWidth: 184, display: 'block' }} /></div>
        <div style={{ padding: '6px 10px' }}>
          {MAIN.map((m) => { const active = m === 'Service Done'; return (
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
        <div style={{ height: '100%', overflow: 'hidden' }}><POSServiceDoneScreen /></div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('story')!).render(<MemoryRouter><div className="frame"><Shell /></div></MemoryRouter>);
