import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { POSCheckInScreen } from '../src/screens/POSCheckInScreen';
import { posCheckInApi } from '../src/api/posCheckInApi';

const MAIN = ['Overview', 'Dashboard', 'Check-In', 'Booking', 'Tech Queue', 'Customer Queue', 'Serving', 'Service Done', 'Checkout'];
const GROUPS = ['CUSTOMERS', 'TEAM', 'SERVICES & PRODUCTS', 'PAYMENTS & MONEY', 'COMMUNICATIONS', 'MARKETING & GROWTH', 'AI CENTER', 'REPORTS', 'MANAGEMENT', 'DEVICES & INTEGRATIONS', 'ACCOUNT'];

const arr = (rowId: string, timeLabel: string, customerName: string, phone: string, service: string, tech: string | undefined, source: string, status: string) =>
  ({ rowId, timeLabel, customerId: rowId, customerName, phone, source, services: [service], technicianName: tech, arrivalStatus: status });
const appt = (appointmentId: string, timeLabel: string, customerName: string, serviceName: string, status: string) =>
  ({ appointmentId, timeLabel, startTime: '2026-05-06T' + timeLabel, customerId: appointmentId, customerName, serviceName, status });

const STATE = {
  kpis: { todayCheckIns: 32, todayCheckInsTrendPercent: 14.3, waitingGuests: 14, estimatedWaitMinutes: 18, walkInsToday: 11, appointmentsArrived: 9, appointmentArrivalPercent: 34, readyForTech: 8, noShows: 2, techsAvailable: 4, customerReturnRate: 68.4 },
  arrivals: [
    arr('a1', '2:33 PM', 'Jessica Miller', '(415) 555-1212', 'Gel Mani', undefined, 'appointment', 'arrived'),
    arr('a2', '2:28 PM', 'Olivia Brown', '(415) 555-3434', 'Acrylic Full Set', 'Lily A.', 'walk_in', 'new_walk_in'),
    arr('a3', '2:25 PM', 'Emma Wilson', '(415) 555-5678', 'Gel X Full Set', 'Mia J.', 'appointment', 'checked_in'),
    arr('a4', '2:21 PM', 'Isabella Davis', '(415) 555-8765', 'Pedicure', undefined, 'appointment', 'arrived'),
    arr('a5', '2:19 PM', 'Sophia Martinez', '(415) 555-2468', 'Nail Art', 'Grace H.', 'walk_in', 'new_walk_in'),
    arr('a6', '2:10 PM', 'Mia Johnson', '(415) 555-1357', 'Spa Pedicure', undefined, 'appointment', 'checked_in'),
    arr('a7', '2:05 PM', 'Charlotte Taylor', '(415) 555-9090', 'Enhancements', 'Lily A.', 'walk_in', 'arrived'),
    arr('a8', '1:58 PM', 'Ava Thompson', '(415) 555-7777', 'Gel Mani', undefined, 'appointment', 'checked_in'),
  ],
  appointmentCheckIn: {
    upcoming: [
      appt('p2', '3:00 PM', 'Emma Wilson', 'Gel X Full Set', 'upcoming'), appt('p3', '3:15 PM', 'Isabella Davis', 'Pedicure', 'upcoming'),
      appt('p4', '3:30 PM', 'Sophia Martinez', 'Nail Art', 'upcoming'), appt('p5', '3:45 PM', 'Ava Thompson', 'Spa Pedicure', 'upcoming'),
    ],
    arrived: [appt('p1', '2:45 PM', 'Jessica Miller', 'Gel Manicure', 'arrived')],
    noShow: [],
  },
  waiting: [
    { queueItemId: 'w1', timeLabel: '2:15 PM', customerName: 'Olivia Brown', serviceName: 'Acrylic Full Set', status: 'waiting', waitedMinutes: 18 },
    { queueItemId: 'w2', timeLabel: '2:21 PM', customerName: 'Isabella Davis', serviceName: 'Pedicure', status: 'waiting', waitedMinutes: 12 },
    { queueItemId: 'w3', timeLabel: '2:19 PM', customerName: 'Sophia Martinez', serviceName: 'Nail Art', status: 'assigned', waitedMinutes: 15 },
    { queueItemId: 'w4', timeLabel: '2:05 PM', customerName: 'Charlotte Taylor', serviceName: 'Enhancements', status: 'assigned', waitedMinutes: 8 },
  ],
  readyForAssignment: [],
  services: [
    { serviceId: 's1', name: 'Gel Manicure', durationMinutes: 25, priceCents: 4500 }, { serviceId: 's2', name: 'Acrylic Full Set', durationMinutes: 60, priceCents: 7500 },
    { serviceId: 's3', name: 'Spa Pedicure', durationMinutes: 45, priceCents: 5500 }, { serviceId: 's4', name: 'Nail Art', durationMinutes: 20, priceCents: 3000 }, { serviceId: 's5', name: 'Waxing', durationMinutes: 15, priceCents: 2500 },
  ],
  technicians: [
    { technicianId: 't1', displayName: 'Lily Adams' }, { technicianId: 't2', displayName: 'Mia Johnson' }, { technicianId: 't3', displayName: 'Grace Hall' }, { technicianId: 't4', displayName: 'Charlotte Taylor' }, { technicianId: 't5', displayName: 'Samantha Green' },
  ],
  availableTechnicians: [
    { technicianId: 't1', displayName: 'Lily Adams', activeAssignments: 2, status: 'available', specialty: 'Nails, Gel, Acrylic', loadPercent: 50, nextAvailable: '2:40 PM' },
    { technicianId: 't2', displayName: 'Mia Johnson', activeAssignments: 3, status: 'busy', specialty: 'Nails, Gel, Pedicure', loadPercent: 75, nextAvailable: '3:00 PM' },
    { technicianId: 't3', displayName: 'Grace Hall', activeAssignments: 1, status: 'available', specialty: 'Nail Art, Design', loadPercent: 25, nextAvailable: 'Now' },
    { technicianId: 't4', displayName: 'Charlotte Taylor', activeAssignments: 2, status: 'available', specialty: 'Pedicure, Spa', loadPercent: 50, nextAvailable: '2:45 PM' },
    { technicianId: 't5', displayName: 'Samantha Green', activeAssignments: 0, status: 'available', specialty: 'Waxing, Brows', loadPercent: 0, nextAvailable: 'Now' },
  ],
  sourceMix: [
    { name: 'App', count: 45, pct: 45 }, { name: 'Phone', count: 25, pct: 25 }, { name: 'Walk-In', count: 20, pct: 20 }, { name: 'AI Receptionist', count: 10, pct: 10 },
  ],
  arrivalTrend: [
    { hourLabel: '8 AM', hour: 8, count: 6 }, { hourLabel: '9 AM', hour: 9, count: 12 }, { hourLabel: '10 AM', hour: 10, count: 18 }, { hourLabel: '11 AM', hour: 11, count: 22 },
    { hourLabel: '12 PM', hour: 12, count: 24 }, { hourLabel: '1 PM', hour: 13, count: 28 }, { hourLabel: '2 PM', hour: 14, count: 32 }, { hourLabel: '3 PM', hour: 15, count: 27 },
    { hourLabel: '4 PM', hour: 16, count: 29 }, { hourLabel: '5 PM', hour: 17, count: 25 }, { hourLabel: '6 PM', hour: 18, count: 26 }, { hourLabel: '7 PM', hour: 19, count: 22 }, { hourLabel: '8 PM', hour: 20, count: 18 },
  ],
  customerType: { returning: 68, new: 22, vip: 10, returnRatePct: 68.4 },
  frontDeskInsights: [
    { id: 'i1', text: 'Peak arrival window: 1:00 PM - 3:00 PM. You\u2019re in peak period. Keep your team ready.', severity: 'info' },
    { id: 'i2', text: 'Suggest move 1 tech to Pedicure. Pedicure wait time is 22 min (high).', severity: 'warn' },
    { id: 'i3', text: '3 VIP clients arriving in next 2 hours. Ensure premium experience.', severity: 'info' },
    { id: 'i4', text: '6 missed calls worth potential bookings. Tap to call back and capture revenue.', severity: 'warn' },
    { id: 'i5', text: '4 guests eligible for add-on upsell. Nail art, paraffin, or gel upgrade.', severity: 'info' },
    { id: 'i6', text: '2 late appointments to confirm. Call to confirm and avoid no-shows.', severity: 'warn' },
  ],
  selectedGuest: { customerId: 'c_jess', fullName: 'Jessica Miller', phone: '(415) 555-1212', email: 'jessica.miller@email.com', isLoyaltyMember: true, totalVisits: 18, totalSpentCents: 248075, loyaltyPoints: 1250, lastVisitLabel: 'May 02, 2026', birthdayLabel: 'Aug 18', preferredTech: 'Lily Adams', favoriteService: 'Gel Manicure', notes: 'Prefers almond shape. Loves glitter colors.', allergies: 'Latex sensitivity, prefers acetone-free' },
  dailyPerformance: { checkInsCompleted: 32, noShowRatePct: 6.2, avgCheckInSeconds: 102, satisfaction: 4.8 },
};

(posCheckInApi as any).state = async () => STATE;

function Shell() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '248px minmax(0,1fr)', height: '100%', background: 'var(--page)' }}>
      <div style={{ background: 'var(--sidebar)', borderRight: '1px solid var(--line)', overflow: 'hidden', fontSize: 12.5 }}>
        <div style={{ padding: '14px 16px 8px' }}><img src="../public/brand/aipowersalon-logo.png" alt="AI PowerSalon" style={{ width: '100%', maxWidth: 184, display: 'block' }} /></div>
        <div style={{ padding: '6px 10px' }}>
          {MAIN.map((m) => { const active = m === 'Check-In'; return (
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
        <div style={{ height: '100%', overflow: 'auto' }}><POSCheckInScreen /></div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('story')!).render(<MemoryRouter><div className="frame"><Shell /></div></MemoryRouter>);
