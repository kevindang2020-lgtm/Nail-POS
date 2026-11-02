import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { POSCheckoutScreen } from '../src/screens/POSCheckoutScreen';
import { posCheckoutApi } from '../src/api/posCheckoutApi';

const MAIN = ['Overview', 'Dashboard', 'Check-In', 'Booking', 'Tech Queue', 'Customer Queue', 'Serving', 'Service Done', 'Checkout'];
const GROUPS = ['CUSTOMERS', 'TEAM', 'SERVICES & PRODUCTS', 'PAYMENTS & MONEY', 'COMMUNICATIONS', 'MARKETING & GROWTH', 'AI CENTER', 'REPORTS', 'MANAGEMENT', 'DEVICES & INTEGRATIONS', 'ACCOUNT'];

// Naive-local ISO so headless chromium (UTC) renders the reference wall-clock times.
const at = (hhmm: string) => `2026-05-06T${hhmm}:00`;
const qrow = (id: string, name: string, tech: string, svc: string, total: number, status: string, time: string, vip = false) => ({
  ticketId: id, ticketNumber: id.toUpperCase(), tenantId: 't', customerName: name, primaryTechnicianName: tech, serviceCount: 1, servicesLabel: svc,
  totalDueCents: total, status, isVip: vip, finishedAt: at(time), completedAt: at(time),
});

const STATE = {
  kpisFull: { ticketsReadyForPayment: 8, subtotalCents: 528730, tipsTodayCents: 124800, cardSurchargeCollectedCents: 0, taxCollectedCents: 0, paidTicketsToday: 27, failedPaymentsToday: 2, pendingPaymentsToday: 5, customerDisplayActiveSessions: 1, receiptDeliveryRatePercent: 96, averageCheckoutSeconds: 138, giftCardLoyaltyRedemptionsCents: 26800, upsellCapturePercent: 22.4 },
  kpiTrends: {
    guestsReady: { deltaPercent: 14.3, direction: 'up' }, completed: { deltaPercent: 22.6, direction: 'up' }, pending: { deltaPercent: 8.3, direction: 'up' },
    revenue: { deltaPercent: 16.0, direction: 'up' }, tips: { deltaPercent: 16.2, direction: 'up' }, avgTime: { deltaPercent: 6.1, direction: 'down' },
    redemptions: { deltaPercent: 12.0, direction: 'up' }, upsell: { deltaPercent: 11.4, direction: 'up' }, receiptRate: { deltaPercent: 3.4, direction: 'up' },
  },
  analytics: {
    revenueTodayCents: 528730, revenueTrendDeltaPercent: 18.0,
    paymentMix: [{ method: 'card', count: 173, amountCents: 338920 }, { method: 'cash', count: 64, amountCents: 128345 }, { method: 'gift_card', count: 18, amountCents: 42265 }, { method: 'other', count: 9, amountCents: 19100 }],
    revenueTrend: [{ hour: 9, amountCents: 60000 }, { hour: 10, amountCents: 105000 }, { hour: 11, amountCents: 168000 }, { hour: 12, amountCents: 240000 }, { hour: 13, amountCents: 250000 }, { hour: 14, amountCents: 320000 }, { hour: 15, amountCents: 430000 }, { hour: 16, amountCents: 488000 }, { hour: 17, amountCents: 528730 }],
    upsellMix: [{ category: 'Retail Add-Ons', sharePercent: 42.5 }, { category: 'Service Add-Ons', sharePercent: 33.2 }, { category: 'Upgrades', sharePercent: 15.6 }, { category: 'Gift Cards', sharePercent: 8.7 }],
    conversionPercent: 84.2, conversionDeltaPercent: 6.8,
    potentialRevenue: { totalCents: 104775, servicesCents: 74275, retailCents: 20500, tipsEstCents: 10000, ticketCount: 6 },
  },
  attention: [
    { type: 'Discount Approval', guest: 'Emma Wilson', issue: 'Manager approval required', time: '2:25 PM', ticketId: 't3', severity: 'warn' },
    { type: 'Partial Payment', guest: 'Nicole Perez', issue: '$60.25 balance remaining', time: '2:15 PM', ticketId: 't6', severity: 'info' },
    { type: 'Failed Receipt', guest: 'Olivia Brown', issue: 'SMS delivery failed', time: '2:28 PM', ticketId: 't2', severity: 'danger' },
    { type: 'Split Payment', guest: 'Sophia Martinez', issue: 'Awaiting 2nd payment', time: '2:19 PM', ticketId: 't5', severity: 'info' },
    { type: 'Gift Card', guest: 'Isabella Davis', issue: 'Card expires in 7 days', time: '2:21 PM', ticketId: 't4', severity: 'info' },
  ],
  staff: [
    { name: 'Samantha Green', nextAvailable: 'Now', status: 'Front Desk' },
    { name: 'Charlotte Taylor', nextAvailable: '10 min', status: 'Ready' },
    { name: 'Lily Adams', nextAvailable: '15 min', status: 'Ready' },
    { name: 'Mia Johnson', nextAvailable: '20 min', status: 'Busy' },
    { name: 'Grace Hall', nextAvailable: '25 min', status: 'Break' },
  ],
  insights: [
    { id: 'i1', text: 'Jessica Miller is likely to rebook today', action: 'Prompt Rebook', route: '/booking' },
    { id: 'i2', text: '3 guests eligible for retail upsell', action: 'View Suggestions', route: '/checkout' },
    { id: 'i3', text: 'Peak checkout wave from 3:00 PM - 4:00 PM', action: 'Balance Front Desk', route: '/checkout' },
    { id: 'i4', text: '2 receipts failed to deliver by SMS', action: 'Retry Now', route: '/checkout', severity: 'warn' },
    { id: 'i5', text: 'Gift card usage up 12% today', action: 'View Trend', route: '/checkout' },
    { id: 'i6', text: 'Average tip rate is strongest on Gel X services', action: 'Open Report', route: '/checkout' },
  ],
  tickets: { items: [
    qrow('t1', 'Jessica Miller', 'Samantha G.', 'Acrylic Full Set', 9500, 'ready_for_payment', '14:33'),
    qrow('t2', 'Olivia Brown', 'Charlotte T.', 'Gel X Full Set', 7850, 'ready_for_payment', '14:28'),
    qrow('t3', 'Emma Wilson', 'Lily Adams', 'Spa Pedicure', 6500, 'waiting_payment', '14:25'),
    qrow('t4', 'Isabella Davis', 'Mia Johnson', 'Nail Art', 12000, 'ready_for_payment', '14:21'),
    qrow('t5', 'Sophia Martinez', 'Grace Hall', 'Gel Manicure', 5500, 'ready_for_payment', '14:19', true),
    qrow('t6', 'Nicole Perez', 'Any Tech', 'Walk-In', 11025, 'split', '14:15'),
  ], pagination: { totalItems: 6 } },
  paymentSettings: { cardEnabled: true, cashEnabled: true, giftCardEnabled: true, splitPaymentEnabled: true, cardSurchargeEnabled: false, cardSurchargePercent: 0, taxRatePercent: 8.25, tipsEnabled: true, defaultTipPercents: [15, 18, 20], allowCustomTip: true, allowNoTip: true, customerDisplayMode: 'review_only', fiservStatus: 'sandbox' },
  customerDisplay: { pairedDevices: [], activeSession: null },
  filters: { statuses: [], stations: [], technicians: [], paymentMethods: [] },
};

const DETAIL = {
  ticketId: 't1', ticketNumber: 'T1',
  customer: { fullName: 'Jessica Miller', isVip: true, phone: '(408) 555-2187', email: 'jessica@email.com', loyaltyPoints: 2450, visitCount: 16, preferredTechName: 'Samantha Green' },
  stationLabel: 'Station 3',
  completedServices: [
    { serviceLineId: 'l1', serviceName: 'Acrylic Full Set', category: 'Service', technicianName: 'Samantha Green', priceCents: 7500, qty: 1 },
    { serviceLineId: 'l2', serviceName: 'Nail Art Add-On', category: 'Service', technicianName: 'Samantha Green', priceCents: 1500, qty: 1 },
    { serviceLineId: 'l3', serviceName: 'Gel Polish', category: 'Service', technicianName: 'Samantha Green', priceCents: 1500, qty: 1 },
    { serviceLineId: 'l4', serviceName: 'Cuticle Oil', category: 'Retail', technicianName: 'Samantha Green', priceCents: 1200, qty: 1 },
  ],
  promotion: { code: 'LOYALTY10', amountCents: 1000 },
  commission: { rows: [{ name: 'Samantha Green', role: 'Primary Tech', percent: 70 }, { name: 'Grace Hall', role: 'Assist Tech', percent: 30 }], estimatedPayoutCents: 5349 },
  totals: { subtotalCents: 11700, discountCents: 1000, taxCents: 722, tipCents: 2000, surchargeCents: 0, totalDueCents: 13422, paymentMethod: 'card' },
  status: 'ready_for_payment',
  receiptDeliveryOptions: { sms: true, email: false, app: true, print: true },
};

(posCheckoutApi as any).state = async () => STATE;
(posCheckoutApi as any).detail = async () => DETAIL;

function Shell() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '248px minmax(0,1fr)', height: '100%', background: 'var(--page)' }}>
      <div style={{ background: 'var(--sidebar)', borderRight: '1px solid var(--line)', overflow: 'hidden', fontSize: 12.5 }}>
        <div style={{ padding: '14px 16px 8px' }}><img src="../public/brand/aipowersalon-logo.png" alt="AI PowerSalon" style={{ width: '100%', maxWidth: 184, display: 'block' }} /></div>
        <div style={{ padding: '6px 10px' }}>
          {MAIN.map((n) => { const active = n === 'Checkout'; return (
            <a key={n} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px', borderRadius: 9, fontWeight: active ? 800 : 600, color: active ? '#fff' : '#6D5F50', background: active ? 'var(--aps-orange)' : 'transparent', marginBottom: 1 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: active ? '#fff' : '#E2C686' }} />{n}</a>
          ); })}
          {GROUPS.map((g) => <div key={g} style={{ fontSize: 9, color: '#8A7A66', fontWeight: 800, letterSpacing: '.07em', padding: '9px 8px 2px' }}>{g}</div>)}
          <div style={{ marginTop: 10, border: '1px solid var(--gline)', borderRadius: 10, padding: '8px 10px', background: '#FFFDF8' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--aps-orange)' }}>Visit AI PowerSalon Help Center</div>
          </div>
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
        <div style={{ height: '100%', overflow: 'hidden' }}><POSCheckoutScreen /></div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('story')!).render(<MemoryRouter><div className="frame"><Shell /></div></MemoryRouter>);
