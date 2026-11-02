import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { POSDashboardScreen } from '../src/screens/POSDashboardScreen';
import { posDashboardApi } from '../src/api/posDashboardApi';
import { inventoryApi } from '../src/api/inventoryApi';
import { AuthProvider } from '../src/auth/AuthContext';

const MAIN = ['Overview', 'Live Operations Dashboard', 'Check-In', 'Booking', 'Tech Queue', 'Customer Queue', 'Serving', 'Service Done', 'Checkout'];
const GROUPS = ['CUSTOMERS', 'TEAM', 'SERVICES & PRODUCTS', 'PAYMENTS & MONEY', 'COMMUNICATIONS', 'MARKETING & GROWTH', 'AI CENTER', 'REPORTS', 'MANAGEMENT', 'DEVICES & INTEGRATIONS', 'ACCOUNT'];

// Stub /auth/me so AI Insights (AI-package gated) renders for the 1:1 fixture; everything else is overridden directly.
const realFetch = window.fetch.bind(window);
(window as any).fetch = async (url: any, opts: any) => {
  const u = String(url);
  if (u.includes('/tenant/navigation')) return new Response(JSON.stringify({ role: 'OWNER', permissions: ['pos.dashboard.view'], features: [], aiPackages: ['ai_pro'], subscriptionStatus: 'active' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (u.includes('/auth/me')) return new Response(JSON.stringify({ role: 'OWNER', permissions: ['pos.dashboard.view'], features: [], aiPackages: ['ai_pro'], subscriptionStatus: 'active' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  return realFetch(url, opts);
};

const STATE = {
  context: { salonName: 'Luxe Nails & Spa', branchName: 'Downtown Branch' },
  kpis: {
    todayRevenueCents: 528730, todayRevenueTrendPercent: 18.6, waitingGuests: 14, servingNow: 21, readyCheckout: 8, activeTechs: 8, totalTechs: 12, onlineBookings: 28,
    monthlyCardVolumeCents: 6489260, checkInsToday: 32, appointmentsToday: 28, averageTicketCents: 8261, customerRetentionPercent: 68.4, aiBookingConversionPercent: 36.2,
    monthlyCardVolumeTrendPercent: 22.4, checkInsTodayTrendPercent: 14.3, appointmentsTodayTrendPercent: 21.7, averageTicketTrendPercent: 5.2, customerRetentionTrendPercent: 6.7, aiBookingConversionTrendPercent: 8.1,
  },
  todaysAppointments: { totalAppointments: 28, completed: 27, noShow: 2, cancelled: 0, remaining: 1, completedPercent: 96 },
  walkInStatus: { waitingCount: 14, estimatedWaitMinutes: 28, checkedInNotAssigned: 6 },
  operationsSnapshot: { waitingGuests: 14, estWaitMinutes: 28, walkInsToday: 11, walkInPercent: 34, readyCheckout: 8, readyCheckoutValueCents: 124875, completedServices: 27, noShows: 2, noShowPercent: 7, upcomingNext3h: 18 },
  revenueTrend: { period: 'Today', totalCents: 528730, trendPercent: 18.6, series: [
    { label: '8 AM', valueCents: 42000, apptCount: 6 }, { label: '9 AM', valueCents: 88000, apptCount: 10 }, { label: '10 AM', valueCents: 132000, apptCount: 15 },
    { label: '11 AM', valueCents: 176000, apptCount: 19 }, { label: '12 PM', valueCents: 224000, apptCount: 22 }, { label: '1 PM', valueCents: 286000, apptCount: 27 },
    { label: '2 PM', valueCents: 352000, apptCount: 31 }, { label: '3 PM', valueCents: 402000, apptCount: 29 }, { label: '4 PM', valueCents: 446000, apptCount: 33 },
    { label: '5 PM', valueCents: 482000, apptCount: 30 }, { label: '6 PM', valueCents: 508000, apptCount: 34 }, { label: '7 PM', valueCents: 522000, apptCount: 31 }, { label: '8 PM', valueCents: 528730, apptCount: 28 },
  ] },
  topServices: [
    { name: 'Gel Manicure', revenueCents: 141200 }, { name: 'Acrylic Full Set', revenueCents: 117800 }, { name: 'Spa Pedicure', revenueCents: 82300 }, { name: 'Nail Art', revenueCents: 41200 }, { name: 'Waxing', revenueCents: 32200 },
  ],
  topTechnicians: [
    { technicianId: 't1', name: 'Samantha Green', revenueCents: 124800, servicesCount: 8, utilizationPercent: 94, tipsCents: 15200, rating: 4.9 },
    { technicianId: 't2', name: 'Charlotte Taylor', revenueCents: 103250, servicesCount: 7, utilizationPercent: 88, tipsCents: 12000, rating: 4.8 },
    { technicianId: 't3', name: 'Lily Adams', revenueCents: 89275, servicesCount: 6, utilizationPercent: 82, tipsCents: 9800, rating: 4.8 },
    { technicianId: 't4', name: 'Mia Johnson', revenueCents: 85400, servicesCount: 6, utilizationPercent: 76, tipsCents: 8600, rating: 4.7 },
    { technicianId: 't5', name: 'Grace Hall', revenueCents: 71225, servicesCount: 5, utilizationPercent: 75, tipsCents: 7000, rating: 4.7 },
  ],
  paymentMix: { period: 'Today', entries: [
    { method: 'card', percent: 72.2, amountCents: 381900 }, { method: 'cash', percent: 20.4, amountCents: 107900 }, { method: 'gift_card', percent: 5.1, amountCents: 26800 }, { method: 'other', percent: 2.2, amountCents: 12000 },
  ] },
  liveActivity: [
    { time: '2:33 PM', guestName: 'Jessica Miller', serviceName: 'Gel Mani', technicianName: 'Samantha Green', status: 'In Progress', elapsedMinutes: 25 },
    { time: '2:28 PM', guestName: 'Olivia Brown', serviceName: 'Acrylic Full Set', technicianName: 'Charlotte Taylor', status: 'In Progress', elapsedMinutes: 18 },
    { time: '2:25 PM', guestName: 'Emma Wilson', serviceName: 'Gel X Full Set', technicianName: 'Lily Adams', status: 'In Progress', elapsedMinutes: 15 },
    { time: '2:21 PM', guestName: 'Isabella Davis', serviceName: 'Spa Pedicure', technicianName: 'Mia Johnson', status: 'In Progress', elapsedMinutes: 20 },
    { time: '2:19 PM', guestName: 'Sophia Martinez', serviceName: 'Nail Art', technicianName: 'Grace Hall', status: 'In Progress', elapsedMinutes: 10 },
  ],
  customerRetention: { returningPercent: 68.4, returningCount: 245, newPercent: 22.1, newCount: 79, inactivePercent: 9.5, inactiveCount: 34, totalCustomers: 358 },
  multiLocation: [
    { branchId: 'b1', branchName: 'Downtown Branch', revenueCents: 528730, checkIns: 32, trendPercent: 18.6 },
    { branchId: 'b2', branchName: 'Westfield Mall', revenueCents: 384210, checkIns: 24, trendPercent: 15.3 },
    { branchId: 'b3', branchName: 'Riverside Plaza', revenueCents: 261375, checkIns: 18, trendPercent: 12.8 },
  ],
  quickInsights: [],
  aiInsights: [
    { id: 'peak', icon: 'peak', tone: 'info', primary: 'Peak time today: 1:00 PM - 3:00 PM', secondary: 'High demand for Acrylic Full Set.' },
    { id: 'staff', icon: 'staff', tone: 'warning', primary: 'Suggest adding 1 extra tech', secondary: 'Between 1:00 PM - 4:00 PM to reduce wait time.' },
    { id: 'missed', icon: 'phone', tone: 'warning', primary: '6 missed calls today', secondary: 'Potential bookings worth ~$540.', action: { label: 'View & Call Back', kind: 'missed_calls' } },
    { id: 'upsell', icon: 'upsell', tone: 'info', primary: 'Upsell opportunity', secondary: '18 guests eligible for add-on services.' },
    { id: 'rebook', icon: 'rebook', tone: 'success', primary: '12 customers due for rebooking', secondary: 'Reach out to increase retention.' },
    { id: 'stock', icon: 'stock', tone: 'danger', primary: 'Low stock alert', secondary: '3 products running low.', action: { label: 'View Inventory', kind: 'inventory' } },
  ],
};

(posDashboardApi as any).getState = async () => STATE;
(inventoryApi as any).alerts = async () => ({ alerts: [{}, {}, {}] });

function Shell() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '248px minmax(0,1fr)', height: '100%', background: 'var(--page)' }}>
      <div style={{ background: 'var(--sidebar)', borderRight: '1px solid var(--line)', overflow: 'hidden', fontSize: 12.5 }}>
        <div style={{ padding: '14px 16px 8px' }}><img src="../public/brand/aipowersalon-logo.png" alt="AI PowerSalon" style={{ width: '100%', maxWidth: 184, display: 'block' }} /></div>
        <div style={{ padding: '6px 10px' }}>
          {MAIN.map((m) => { const active = m === 'Live Operations Dashboard'; return (
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
        <div style={{ height: '100%', overflow: 'auto' }}><div className="work dash"><POSDashboardScreen /></div></div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('story')!).render(<AuthProvider><MemoryRouter><div className="frame"><Shell /></div></MemoryRouter></AuthProvider>);
