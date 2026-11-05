import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { POSOverviewScreen } from '../src/screens/POSOverviewScreen';
import { posOverviewApi } from '../src/api/posOverviewApi';
import { AuthProvider } from '../src/auth/AuthContext';

const MAIN = ['Overview', 'Live Operations Dashboard', 'Check-In', 'Booking', 'Tech Queue', 'Customer Queue', 'Serving', 'Service Done', 'Checkout'];
const GROUPS = ['CUSTOMERS', 'TEAM', 'SERVICES & PRODUCTS', 'PAYMENTS & MONEY', 'COMMUNICATIONS', 'MARKETING & GROWTH', 'AI CENTER', 'REPORTS', 'MANAGEMENT', 'DEVICES & INTEGRATIONS', 'ACCOUNT'];

const NOW = Date.now();
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const at = (h, m = 0) => `2026-05-06T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;

const bookedTechs = [
  { technicianId: 'tg', name: 'Samantha Green', appointments: [
    { appointmentId: 'b1', customerName: 'Lisa Rodriguez', serviceNames: ['Gel Manicure'], startTime: at(10), status: 'completed', source: 'booking', amountCents: 6500, durationMinutes: 60 },
    { appointmentId: 'b5', customerName: 'Jessica Miller', serviceNames: ['Gel Manicure'], startTime: at(14), status: 'confirmed', source: 'booking', amountCents: 6500, durationMinutes: 60 } ] },
  { technicianId: 'tc', name: 'Charlotte Taylor', appointments: [
    { appointmentId: 'b2', customerName: 'Emma Wilson', serviceNames: ['Acrylic Full Set'], startTime: at(11), status: 'in_progress', source: 'booking', amountCents: 8500, durationMinutes: 60 } ] },
  { technicianId: 'tl', name: 'Lily Adams', appointments: [
    { appointmentId: 'b3', customerName: 'Maria Garcia', serviceNames: ['Spa Pedicure'], startTime: at(12), status: 'in_progress', source: 'booking', amountCents: 9000, durationMinutes: 60 },
    { appointmentId: 'b7', customerName: 'Isabella Davis', serviceNames: ['Pedicure'], startTime: at(16), status: 'confirmed', source: 'booking', amountCents: 4500, durationMinutes: 60 } ] },
  { technicianId: 'tm', name: 'Mia Johnson', appointments: [
    { appointmentId: 'b4', customerName: 'Olivia Brown', serviceNames: ['Gel X Full Set'], startTime: at(13), status: 'confirmed', source: 'booking', amountCents: 9500, durationMinutes: 60 } ] },
  { technicianId: 'tgh', name: 'Grace Hall', appointments: [
    { appointmentId: 'b6', customerName: 'Sophia Martinez', serviceNames: ['Nail Art'], startTime: at(15), status: 'confirmed', source: 'booking', amountCents: 7000, durationMinutes: 60 },
    { appointmentId: 'b8', customerName: 'Walk-in Slot', serviceNames: ['Available'], startTime: at(17), status: 'open', source: 'walk_in', durationMinutes: 60 } ] },
];

const RICH = {
  context: { salonName: 'Luxe Nails & Spa', branchName: 'Downtown Branch', businessDate: '2026-05-06' },
  kpis: {
    todayRevenue: { amountCents: 528730, displayAmount: '$5,287.30', changePercent: 18.6 },
    todayCheckIns: { count: 32, changePercent: 14.3 }, walkInsToday: { count: 11 },
    averageTicket: { amountCents: 8261, displayAmount: '$82.61', changePercent: 5.2 },
    waitingGuests: { count: 14 }, servingNow: { count: 21 }, readyCheckout: { count: 8 },
    activeTechs: { active: 8, scheduled: 12 }, onlineBookings: { count: 18 } },
  schedulePreview: { technicians: bookedTechs },
  todayAppointments: { total: 28, completed: 27, noShow: 2, cancelled: 1, remaining: 6 },
  walkInStatus: { waiting: 14, estimatedWaitMinutes: 28, checkedInNotAssigned: 6 },
  analytics: {
    revenueTrend: [ { date: 'Mon', revenueCents: 372000 }, { date: 'Tue', revenueCents: 398000 }, { date: 'Wed', revenueCents: 521000 }, { date: 'Thu', revenueCents: 488000 }, { date: 'Fri', revenueCents: 596000 }, { date: 'Sat', revenueCents: 585530 }, { date: 'Sun', revenueCents: 528730 } ],
    topTechnicians: [
      { technicianId: 'tg', technicianName: 'Samantha Green', revenueCents: 124800, completedServices: 8, utilizationPercent: 94 },
      { technicianId: 'tc', technicianName: 'Charlotte Taylor', revenueCents: 103250, completedServices: 7, utilizationPercent: 88 },
      { technicianId: 'tl', technicianName: 'Lily Adams', revenueCents: 89275, completedServices: 6, utilizationPercent: 82 },
      { technicianId: 'tm', technicianName: 'Mia Johnson', revenueCents: 85400, completedServices: 6, utilizationPercent: 76 },
      { technicianId: 'tgh', technicianName: 'Grace Hall', revenueCents: 71225, completedServices: 5, utilizationPercent: 75 } ],
    paymentMix: [ { method: 'card', amountCents: 381920, percent: 72.2 }, { method: 'cash', amountCents: 107900, percent: 20.4 }, { method: 'gift_card', amountCents: 26830, percent: 5.1 }, { method: 'other', amountCents: 12000, percent: 2.2 } ],
    quickInsights: [
      { type: 'revenue', title: 'Revenue up 18.6% vs yesterday. Great job!', severity: 'info' },
      { type: 'peak', title: 'Peak time today: 1:00 PM - 3:00 PM', value: 'High demand for Acrylic Full Set.', severity: 'info' },
      { type: 'noshow', title: '3 no-show risk appointments tomorrow.', value: 'Consider sending reminders.', severity: 'warn' },
      { type: 'retail', title: 'Retail sales can increase 22% with bundle offers.', value: 'AI suggests 3 product bundles.', severity: 'info' },
      { type: 'util', title: 'Technician utilization: 87%', value: 'Excellent balance today.', severity: 'info' } ] },
};

const BOARD = {
  arrivals: [
    { startTime: ago(2), customerName: 'Jessica Miller', serviceName: 'Gel Mani', status: 'arrived', waitMinutes: 2 },
    { startTime: ago(7), customerName: 'Olivia Brown', serviceName: 'Acrylic Full Set', status: 'arrived', waitMinutes: 7 },
    { startTime: ago(18), customerName: 'Emma Wilson', serviceName: 'Gel X Full Set', status: 'waiting', waitMinutes: 18 },
    { startTime: ago(21), customerName: 'Isabella Davis', serviceName: 'Pedicure', status: 'waiting', waitMinutes: 21 },
    { startTime: ago(26), customerName: 'Sophia Martinez', serviceName: 'Nail Art', status: 'waiting', waitMinutes: 26 },
    { startTime: ago(-24), customerName: 'Mia Johnson', serviceName: 'Spa Pedicure', status: 'upcoming', waitMinutes: null },
    { startTime: ago(-29), customerName: 'Charlotte Taylor', serviceName: 'Enhancements', status: 'upcoming', waitMinutes: null } ],
  liveTechQueue: [
    { technicianName: 'Samantha Green', serviceName: 'Acrylic Full Set', customerName: 'Lisa R.', minutesLeft: 25, status: 'in_progress' },
    { technicianName: 'Charlotte Taylor', serviceName: 'Gel Manicure', customerName: 'Emma W.', minutesLeft: 15, status: 'in_progress' },
    { technicianName: 'Lily Adams', serviceName: 'Spa Pedicure', customerName: 'Maria G.', minutesLeft: 20, status: 'in_progress' },
    { technicianName: 'Mia Johnson', serviceName: 'Nail Art', customerName: 'Isabella D.', minutesLeft: 10, status: 'in_progress' },
    { technicianName: 'Grace Hall', serviceName: 'Gel X Full Set', customerName: 'Olivia B.', minutesLeft: 30, status: 'in_progress' } ],
  readyForAssignment: [
    { customerName: 'Olivia Brown', serviceName: 'Acrylic Full Set', requestedTech: 'Any Available' },
    { customerName: 'Emma Wilson', serviceName: 'Gel X Full Set', requestedTech: 'Any Available' },
    { customerName: 'Isabella Davis', serviceName: 'Pedicure', requestedTech: 'Any Available' },
    { customerName: 'Sophia Martinez', serviceName: 'Nail Art', requestedTech: 'Any Available' },
    { customerName: 'Ava Thompson', serviceName: 'Spa Pedicure', requestedTech: 'Any Available' } ],
  readyForCheckout: [
    { customerName: 'Lisa Rodriguez', amountCents: 9500 }, { customerName: 'Maria Garcia', amountCents: 7850 }, { customerName: 'Amy Chen', amountCents: 12000 }, { customerName: 'Michelle Lee', amountCents: 8500 }, { customerName: 'Nicole Perez', amountCents: 11025 } ],
  communications: {
    reminders: [
      { customerName: 'Emma Wilson', service: 'Acrylic Full Set', whenLabel: 'May 07, 10:00 AM', channel: 'sms', status: 'Scheduled' },
      { customerName: 'Maria Garcia', service: 'Spa Pedicure', whenLabel: 'May 07, 11:30 AM', channel: 'sms', status: 'Scheduled' },
      { customerName: 'Olivia Brown', service: 'Gel X Full Set', whenLabel: 'May 07, 1:00 PM', channel: 'sms', status: 'Scheduled' },
      { customerName: 'Jessica Miller', service: 'Gel Manicure', whenLabel: 'May 07, 2:00 PM', channel: 'sms', status: 'Scheduled' },
      { customerName: 'Sophia Martinez', service: 'Nail Art', whenLabel: 'May 07, 3:00 PM', channel: 'email', status: 'Scheduled' } ],
    messages: [], missedCalls: [{ from: 'Amy Chen', at: '1:12 PM', status: 'missed' }, { from: 'Nicole Perez', at: '12:40 PM', status: 'missed' }, { from: 'Michelle Lee', at: '11:58 AM', status: 'missed' }] },
  customerRetention: { returningPercent: 68.4, newPercent: 22.1, inactivePercent: 9.5 },
  inventoryAlerts: [
    { product: 'Acrylic Powder - Clear', stock: 5, reorderLevel: 10, status: 'low' },
    { product: 'Gel Polish - B24 Rose', stock: 3, reorderLevel: 10, status: 'low' },
    { product: 'Top Coat - 15ml', stock: 4, reorderLevel: 10, status: 'low' },
    { product: 'Cuticle Oil - Lavender', stock: 6, reorderLevel: 10, status: 'low' },
    { product: 'Nail Tips - Almond', stock: 7, reorderLevel: 12, status: 'low' } ],
  lastUpdatedAt: new Date().toISOString(),
};

(posOverviewApi).getOverview = async () => RICH;
(posOverviewApi).getBoard = async () => BOARD;

const realFetch = window.fetch;
window.fetch = (async (url, opts) => {
  const u = String(url);
  if (u.includes('/tenant/navigation') || u.includes('/auth/me')) {
    return new Response(JSON.stringify({ role: 'owner', permissions: ['*'], features: [], aiPackages: ['ai_pro'], subscriptionStatus: 'active' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return realFetch(url, opts);
});

function Shell() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '248px minmax(0,1fr)', height: '100%', background: 'var(--page)' }}>
      <div style={{ background: 'var(--sidebar)', borderRight: '1px solid var(--line)', overflow: 'hidden', fontSize: 12.5 }}>
        <div style={{ padding: '14px 16px 8px' }}><img src="../public/brand/aipowersalon-logo.png" alt="AI PowerSalon" style={{ width: '100%', maxWidth: 184, display: 'block' }} /></div>
        <div style={{ padding: '6px 10px' }}>
          {MAIN.map((m) => { const active = m === 'Overview'; return (
            <a key={m} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px', borderRadius: 9, fontWeight: active ? 800 : 600, color: active ? '#fff' : '#6D5F50', background: active ? 'var(--aps-orange)' : 'transparent', marginBottom: 1, whiteSpace: 'nowrap' }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: active ? '#fff' : '#E2C686' }} />{m}</a>
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
        <div style={{ height: '100%', overflow: 'auto' }}><POSOverviewScreen /></div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('story')).render(<MemoryRouter><AuthProvider><div className="frame"><Shell /></div></AuthProvider></MemoryRouter>);
