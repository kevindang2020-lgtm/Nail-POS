import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { POSTechQueueScreen } from '../src/screens/POSTechQueueScreen';
import { posTechQueueApi } from '../src/api/posTechQueueApi';

const MAIN = ['Overview', 'Live Operations Dashboard', 'Check-In', 'Booking', 'Tech Queue', 'Customer Queue', 'Serving', 'Service Done', 'Checkout'];
const GROUPS = ['CUSTOMERS', 'TEAM', 'SERVICES & PRODUCTS', 'PAYMENTS & MONEY', 'COMMUNICATIONS', 'MARKETING & GROWTH', 'AI CENTER', 'REPORTS', 'MANAGEMENT', 'DEVICES & INTEGRATIONS', 'ACCOUNT'];

const techRow = (rotationPosition: number, technicianName: string, specialties: string[], status: string, guests: number, cs: string | undefined, cust: string | undefined, next: string, util: number | null, tips: number, rev: number) =>
  ({ rotationPosition, technicianId: 't' + rotationPosition, technicianName, specialties, status, guests, currentServiceName: cs, currentServiceCustomer: cust, nextAvailableLabel: next, utilizationPercent: util, tipsTodayCents: tips, revenueTodayCents: rev });

const STATE = {
  kpis: { assignedTickets: 21, waitingForAcceptance: 6, acceptedTickets: 4, readyToStart: 3, delayedTickets: 1, activeTechnicians: 8, availableTechnicians: 4, averageAssignedWaitMinutes: 14, laborRevenueTodayCents: 489260, utilizationTodayPercent: 78, upsellCapturePercent: 31.4, scheduledTechnicians: 12, servicesInProgress: 21, waitingForAssignment: 6, avgTurnTimeMinutes: 52 },
  kpiTrends: {
    active: { deltaPercent: null, direction: 'up', text: '1' }, available: { deltaPercent: null, direction: 'up', text: '2' }, inProgress: { deltaPercent: null, direction: 'up', text: '3' },
    waiting: { deltaPercent: null, direction: 'down', text: '2' }, avgTurn: { deltaPercent: null, direction: 'down', text: '6 min' }, utilization: { deltaPercent: 8, direction: 'up' },
    laborRevenue: { deltaPercent: 12.6, direction: 'up' }, upsell: { deltaPercent: 4.3, direction: 'up' },
  },
  technicianRows: [
    techRow(1, 'Samantha Green', ['Acrylic', 'Gel', 'Nail Art'], 'in_service', 2, 'Acrylic Full Set', 'Lisa R.', '25 min', 92, 6600, 52000),
    techRow(2, 'Charlotte Taylor', ['Gel', 'Manicure'], 'in_service', 1, 'Gel Manicure', 'Emma W.', '15 min', 88, 4200, 28000),
    techRow(3, 'Lily Adams', ['Spa Pedi', 'Waxing'], 'in_service', 1, 'Spa Pedicure', 'Maria G.', '20 min', 82, 3500, 21000),
    techRow(4, 'Mia Johnson', ['Nail Art', 'Gel'], 'finishing_soon', 1, 'Nail Art', 'Isabella D.', '10 min', 74, 2800, 18000),
    techRow(5, 'Grace Hall', ['Gel', 'Acrylic', 'Pedicure'], 'available', 0, undefined, undefined, 'Now', 34, 0, 0),
    techRow(6, 'Emma Wilson', ['Acrylic', 'Gel', 'Pedi'], 'available', 0, undefined, undefined, 'Now', 28, 0, 0),
    techRow(7, 'Isabella Davis', ['Nail Art', 'Gel'], 'on_break', 0, undefined, undefined, 'On break', null, 0, 0),
    techRow(8, 'Sophia Martinez', ['Gel', 'Pedi', 'Nail Art'], 'off_today', 0, undefined, undefined, 'Off', null, 0, 0),
  ],
  waitingGuests: [
    { customerName: 'Ava Thompson', serviceName: 'Nail Art', preferredTechName: 'Any Nail Art', priority: 'high', waitMinutes: 28, bestMatchTechnicianName: 'Mia Johnson' },
    { customerName: 'Olivia Brown', serviceName: 'Gel X Full Set', preferredTechName: 'Charlotte T.', priority: 'high', waitMinutes: 12, bestMatchTechnicianName: 'Charlotte Taylor' },
    { customerName: 'Jessica Miller', serviceName: 'Acrylic Full Set', preferredTechName: 'Samantha G.', priority: 'medium', waitMinutes: 18, bestMatchTechnicianName: 'Samantha Green' },
    { customerName: 'Michael Lee', serviceName: 'Spa Pedicure', preferredTechName: 'Any', priority: 'medium', waitMinutes: 22, bestMatchTechnicianName: 'Lily Adams' },
    { customerName: 'Nicole Perez', serviceName: 'Gel Manicure', preferredTechName: 'Any', priority: 'low', waitMinutes: 35, bestMatchTechnicianName: 'Emma Wilson' },
  ],
  availableTechnicians: [
    { technicianId: 't5', technicianName: 'Grace Hall', status: 'available', nextAvailableLabel: 'Now', specialties: ['Gel', 'Acrylic', 'Pedi'] },
    { technicianId: 't6', technicianName: 'Emma Wilson', status: 'available', nextAvailableLabel: 'Now', specialties: ['Acrylic', 'Gel', 'Pedi'] },
    { technicianId: 't7', technicianName: 'Isabella Davis', status: 'on_break', nextAvailableLabel: '3:00 PM', specialties: ['Nail Art', 'Gel'] },
    { technicianId: 't8', technicianName: 'Sophia Martinez', status: 'off_today', nextAvailableLabel: '3:30 PM', specialties: ['Gel', 'Pedi', 'Nail Art'] },
  ],
  analytics: {
    utilizationTrend: [{ hour: 8, utilizationPercent: 40 }, { hour: 9, utilizationPercent: 55 }, { hour: 10, utilizationPercent: 62 }, { hour: 11, utilizationPercent: 70 }, { hour: 12, utilizationPercent: 66 }, { hour: 13, utilizationPercent: 75 }, { hour: 14, utilizationPercent: 82 }, { hour: 15, utilizationPercent: 78 }, { hour: 16, utilizationPercent: 85 }, { hour: 17, utilizationPercent: 80 }, { hour: 18, utilizationPercent: 76 }, { hour: 19, utilizationPercent: 72 }],
    serviceCategories: ['Acrylic', 'Gel', 'Pedicure', 'Manicure', 'Nail Art', 'Waxing'],
    serviceMixByTechnician: [
      { technicianId: 't1', technicianName: 'Samantha Green', cells: [{ category: 'Acrylic', percent: 40, count: 4, revenueCents: 40000 }, { category: 'Gel', percent: 35, count: 3, revenueCents: 30000 }, { category: 'Nail Art', percent: 25, count: 2, revenueCents: 20000 }] },
      { technicianId: 't2', technicianName: 'Charlotte Taylor', cells: [{ category: 'Gel', percent: 60, count: 3, revenueCents: 30000 }, { category: 'Manicure', percent: 40, count: 2, revenueCents: 16000 }] },
      { technicianId: 't3', technicianName: 'Lily Adams', cells: [{ category: 'Pedicure', percent: 70, count: 4, revenueCents: 35000 }, { category: 'Waxing', percent: 30, count: 2, revenueCents: 12000 }] },
      { technicianId: 't4', technicianName: 'Mia Johnson', cells: [{ category: 'Nail Art', percent: 55, count: 3, revenueCents: 22000 }, { category: 'Gel', percent: 45, count: 2, revenueCents: 18000 }] },
      { technicianId: 't5', technicianName: 'Grace Hall', cells: [{ category: 'Gel', percent: 50, count: 1, revenueCents: 12000 }, { category: 'Acrylic', percent: 50, count: 1, revenueCents: 14000 }] },
      { technicianId: 't6', technicianName: 'Emma Wilson', cells: [{ category: 'Acrylic', percent: 100, count: 1, revenueCents: 9500 }] },
    ],
    assignmentSource: [{ source: 'Appointments', count: 35, percent: 51.5 }, { source: 'Walk-ins', count: 18, percent: 26.5 }, { source: 'AI Assignment', count: 10, percent: 14.7 }, { source: 'Manual Front Desk', count: 5, percent: 7.4 }],
    assignmentSourceTotal: 68,
    topRevenueTechs: [
      { technicianId: 't1', technicianName: 'Samantha Green', revenueCents: 112000 }, { technicianId: 't2', technicianName: 'Charlotte Taylor', revenueCents: 98000 },
      { technicianId: 't3', technicianName: 'Lily Adams', revenueCents: 86000 }, { technicianId: 't4', technicianName: 'Mia Johnson', revenueCents: 72000 }, { technicianId: 't5', technicianName: 'Grace Hall', revenueCents: 41000 },
    ],
  },
  insights: [
    { id: 'i1', text: 'Move 1 guest from Lily Adams to Emma Wilson', sub: 'to reduce wait time by 12 min.', action: 'Apply', route: '/tech-queue' },
    { id: 'i2', text: 'Pedicure demand spikes from 3:00 PM - 5:00 PM', sub: 'Prep available techs in advance.' },
    { id: 'i3', text: 'Grace Hall has highest upsell conversion today', sub: '42% upsell capture rate.' },
    { id: 'i4', text: '2 techs nearing overtime', sub: 'Monitor schedule to avoid overtime.', severity: 'warn' },
    { id: 'i5', text: '3 waiting guests prefer Nail Art specialists', sub: 'Consider reassigning for better match.' },
  ],
  technicianLanes: [],
  tickets: { items: [], pagination: { totalItems: 0 } },
  techPerformanceToday: [
    { technicianId: 't1', technicianName: 'Samantha Green', services: 6, revenueCents: 112000, tipCents: 18600, ratingAvg: 4.9 },
    { technicianId: 't2', technicianName: 'Charlotte Taylor', services: 5, revenueCents: 98000, tipCents: 14200, ratingAvg: 4.9 },
    { technicianId: 't3', technicianName: 'Lily Adams', services: 5, revenueCents: 86000, tipCents: 13500, ratingAvg: 4.8 },
    { technicianId: 't4', technicianName: 'Mia Johnson', services: 4, revenueCents: 72000, tipCents: 9500, ratingAvg: 4.7 },
    { technicianId: 't5', technicianName: 'Grace Hall', services: 2, revenueCents: 41000, tipCents: 6000, ratingAvg: 4.6 },
    { technicianId: 't6', technicianName: 'Emma Wilson', services: 1, revenueCents: 29000, tipCents: 4200, ratingAvg: 4.5 },
  ],
  filters: { statuses: [], technicians: [], serviceCategories: [], sources: [], priorityLevels: [], stations: [] },
  workflowSettings: {},
};

(posTechQueueApi as any).state = async () => STATE;

function Shell() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '248px minmax(0,1fr)', height: '100%', background: 'var(--page)' }}>
      <div style={{ background: 'var(--sidebar)', borderRight: '1px solid var(--line)', overflow: 'hidden', fontSize: 12.5 }}>
        <div style={{ padding: '14px 16px 8px' }}><img src="../public/brand/aipowersalon-logo.png" alt="AI PowerSalon" style={{ width: '100%', maxWidth: 184, display: 'block' }} /></div>
        <div style={{ padding: '6px 10px' }}>
          {MAIN.map((m) => { const active = m === 'Tech Queue'; return (
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
        <div style={{ height: '100%', overflow: 'hidden' }}><POSTechQueueScreen /></div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('story')!).render(<MemoryRouter><div className="frame"><Shell /></div></MemoryRouter>);
