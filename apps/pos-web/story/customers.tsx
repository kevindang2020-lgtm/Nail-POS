import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { POSCustomersScreen } from '../src/screens/POSCustomersScreen';
import { posCustomersApi } from '../src/api/posCustomersApi';
import { api } from '../src/api/client';

const row = (id: string, name: string, phone: string, email: string, tier: string, pts: number, lastV: string, visits: number, spend: number, avg: number, vip: boolean, status = 'active') => ({
  customerId: id, displayName: name, phone, email, status, source: 'walk_in',
  visitCount: visits, lastVisitAt: lastV, nextAppointmentAt: null, totalSpendCents: spend, averageSpendCents: avg,
  loyaltyPoints: pts, loyaltyTier: tier, isVip: vip, tags: vip ? ['VIP'] : [], marketingOptIn: true, smsOptIn: true, emailOptIn: true,
});

const STATE = {
  kpisFull: { totalCustomers: 2847, newCustomersToday: 156, returningCustomersToday: 1982, vipCustomers: 324, birthdayThisMonth: 88, inactiveCustomers: 185, duplicateProfiles: 0, loyaltyMembers: 1563, averageSpendCents: 24575 },
  analytics: {
    ageGroups: [{ label: '18-25', count: 185 }, { label: '26-35', count: 287 }, { label: '36-45', count: 253 }, { label: '46-55', count: 172 }, { label: '55+', count: 103 }],
    lifetimeValue: { totalRevenueCents: 355248000, totalCustomers: 2847, repeatRatePercent: 68.4, avgClvCents: 124875 },
    rfm: [{ segment: 'Champions', count: 324 }, { segment: 'Loyal Customers', count: 892 }, { segment: 'Potential Loyalists', count: 456 }, { segment: 'At Risk', count: 185 }, { segment: 'Cannot Lose Them', count: 142 }, { segment: 'Hibernating', count: 848 }],
    retentionRatePercent: 68.4,
  },
  rows: {
    items: [
      row('CUST-1001', 'Olivia Brown', '(555) 123-4567', 'olivia.brown@email.com', 'Gold', 2450, '2026-05-05', 24, 124875, 5203, true),
      row('CUST-1002', 'Emma Wilson', '(555) 234-5678', 'emma.wilson@email.com', 'Silver', 1280, '2026-05-04', 18, 89250, 4958, false),
      row('CUST-1003', 'Sophia Martinez', '(555) 345-6789', 'sophia.m@email.com', 'Platinum', 3680, '2026-05-03', 31, 215600, 6955, true),
      row('CUST-1004', 'Isabella Davis', '(555) 456-7890', 'isabella.d@email.com', 'Gold', 2100, '2026-05-02', 15, 64525, 4302, false),
      row('CUST-1005', 'Mia Johnson', '(555) 567-8901', 'mia.johnson@email.com', 'Silver', 980, '2026-04-30', 12, 51200, 4267, false),
      row('CUST-1006', 'Charlotte Taylor', '(555) 678-9012', 'charlotte.t@email.com', 'Bronze', 450, '2026-04-29', 8, 38550, 4819, false),
      row('CUST-1007', 'Ava Thompson', '(555) 789-0123', 'ava.t@email.com', 'Silver', 1150, '2026-04-28', 14, 59875, 4277, false),
      row('CUST-1008', 'Liam Anderson', '(555) 890-1234', 'liam.a@email.com', 'Bronze', 320, '2026-04-27', 6, 21000, 3500, false, 'inactive'),
    ],
    pagination: { page: 1, pageSize: 8, totalItems: 2847, totalPages: 356 },
  },
  trends: { totalCustomers: 12.5, newCustomers: 8.3, avgSpend: 9.2, inactive: null, retention: null, clv: null },
  directory: {
    topTags: [ { name: 'VIP', count: 324 }, { name: 'Loyalty Member', count: 1563 }, { name: 'Regular', count: 1892 }, { name: 'High Spender', count: 142 }, { name: 'New Customer', count: 156 } ],
    sources: [ { name: 'Walk-In', count: 1245 }, { name: 'Online Booking', count: 892 }, { name: 'Referral', count: 456 }, { name: 'Social Media', count: 189 }, { name: 'Other', count: 65 } ],
    topSpendersCount: 142,
  },
  filterFacets: { segments: ['New', 'Returning', 'VIP', 'At Risk'], statuses: ['active', 'inactive', 'vip', 'at_risk', 'blocked', 'archived'], loyaltyTiers: ['Bronze', 'Silver', 'Gold', 'Platinum'], visitRanges: ['1-5', '6-15', '16+'], spendRanges: ['<$100', '$100-$500', '$500+'], sources: ['Walk-In', 'Online Booking', 'Phone', 'Referral', 'Social Media'], tags: ['VIP', 'Loyalty Member', 'Regular', 'High Spender', 'New Customer'] },
};

// Intercept only the customers state call; everything else falls through.
const origGet: any = (api as any).get;
(api as any).get = (path: string, q?: any) => {
  if (path.includes('/pos/customers/state')) return Promise.resolve(STATE);
  const m = path.match(/\/pos\/customers\/([^/?]+)$/);
  if (m) {
    const r = (STATE.rows.items as any[]).find((x) => x.customerId === decodeURIComponent(m[1])) || STATE.rows.items[0];
    return Promise.resolve({
      ...r,
      notes: { salonNotes: 'Prefers almond-shape, neutral tones. Always offers a beverage on arrival.', allergyNotes: 'Sensitive to acetone-heavy removers.', preferredStyle: 'Almond / short', preferredTechnician: 'Samantha Green', servicePreferences: 'Gel manicure, nail art', warnings: '', customerVisible: false },
      loyalty: { points: r.loyaltyPoints, earned: r.loyaltyPoints + 1800, redeemed: 1800, tier: r.loyaltyTier || 'Gold', tierThresholdPoints: 3000, birthdayReward: true, referralReward: false },
      membership: { plan: 'Monthly Mani Member', status: 'active', startDate: '2025-09-01T00:00:00Z', renewalDate: '2026-06-01T00:00:00Z', benefits: ['1 gel manicure / mo', '10% off add-ons'], billingStatus: 'current' },
      giftCards: [{ giftCardId: 'gc1', maskedCode: '•••• 4821', balanceCents: 4500, status: 'active' }],
      recentVisits: [
        { visitId: 'v1', date: '2026-05-05T00:00:00Z', serviceName: 'Gel Manicure', technicianName: 'Samantha Green', totalCents: 5500, tipCents: 1100 },
        { visitId: 'v2', date: '2026-04-18T00:00:00Z', serviceName: 'Nail Art', technicianName: 'Charlotte Taylor', totalCents: 6800, tipCents: 1200 },
        { visitId: 'v3', date: '2026-04-02T00:00:00Z', serviceName: 'Classic Pedicure', technicianName: 'Samantha Green', totalCents: 4800, tipCents: 900 },
      ],
      auditSummary: [{ lastAction: 'updated', lastActorRole: 'OWNER', lastAt: '2026-05-05T14:02:00Z' }],
    });
  }
  return origGet(path, q);
};
(posCustomersApi as any).importPreview = async () => ({
  totalRows: 1284, toCreate: 1180, toUpdate: 0, duplicates: 86, errors: 18, invalidEmailsDropped: 12,
  detectedColumns: { firstName: 'mapped', lastName: 'mapped', fullName: undefined, phone: 'mapped', email: 'mapped', birthday: 'mapped' },
  sample: [
    { rowNumber: 1, firstName: 'Grace', lastName: 'Lee', phone: '(555) 201-7788', email: 'grace.lee@email.com', action: 'create' },
    { rowNumber: 2, firstName: 'Noah', lastName: 'Kim', phone: '(555) 332-1190', email: 'noah.kim@email.com', action: 'create' },
    { rowNumber: 3, firstName: 'Olivia', lastName: 'Brown', phone: '(555) 123-4567', email: 'olivia.brown@email.com', action: 'duplicate', reason: 'phone matches #CUST-1001' },
    { rowNumber: 4, firstName: 'Ethan', lastName: 'Park', phone: '', email: 'ethan.park@email.com', action: 'error', reason: 'missing mobile phone' },
    { rowNumber: 5, firstName: 'Maya', lastName: 'Singh', phone: '(555) 908-4521', email: 'not-an-email', action: 'error', reason: 'invalid email format' },
  ],
});
(posCustomersApi as any).duplicates = async () => [
  { duplicateGroupId: 'g1', reason: 'phone number', members: [
    { customerId: 'CUST-1001', displayName: 'Olivia Brown', phone: '(555) 123-4567', email: 'olivia.brown@email.com', status: 'active', visitCount: 24, totalSpendCents: 124875, loyaltyPoints: 2450, loyaltyTier: 'Gold', createdAt: '2024-03-12T00:00:00Z' },
    { customerId: 'CUST-1099', displayName: 'Olivia Brown', phone: '(555) 123-4567', email: 'o.brown@gmail.com', status: 'active', visitCount: 3, totalSpendCents: 15000, loyaltyPoints: 100, loyaltyTier: 'Bronze', createdAt: '2026-01-10T00:00:00Z' },
  ] },
];

const NAV = ['Overview', 'Dashboard', 'Check-In', 'Booking', 'Tech Queue', 'Customer Queue', 'Serving', 'Service Done', 'Checkout'];
const CUST_SUB = ['All Customers', 'VIP Customers', 'Loyalty Members', 'Inactive Customers', 'Customer Tags', 'Customer Groups'];

function Shell() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '248px minmax(0,1fr)', height: '100%', background: 'var(--page)' }}>
      <div style={{ background: 'var(--sidebar)', borderRight: '1px solid var(--line)', overflow: 'hidden', fontSize: 12.5 }}>
        <div style={{ padding: '14px 16px 8px' }}><img src="../public/brand/aipowersalon-logo.png" alt="AI PowerSalon" style={{ width: '100%', maxWidth: 184, display: 'block' }} /></div>
        <div style={{ padding: '6px 10px' }}>
          {NAV.map((n) => <a key={n} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px', borderRadius: 9, fontWeight: 600, color: '#6D5F50', marginBottom: 1 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#E2C686' }} />{n}</a>)}
          <div style={{ fontSize: 9, color: '#8A7A66', fontWeight: 800, letterSpacing: '.07em', padding: '10px 8px 3px' }}>CUSTOMERS</div>
          {CUST_SUB.map((n) => <a key={n} style={{ display: 'block', padding: '6px 10px 6px 22px', borderRadius: 8, fontWeight: n === 'All Customers' ? 800 : 600, color: n === 'All Customers' ? '#8B5A18' : '#6D5F50', background: n === 'All Customers' ? '#FCEFD8' : 'transparent', marginBottom: 1, fontSize: 12 }}>{n}</a>)}
          {['TEAM', 'SERVICES & PRODUCTS', 'PAYMENTS & MONEY', 'COMMUNICATIONS', 'MARKETING & GROWTH', 'AI CENTER', 'REPORTS', 'MANAGEMENT', 'DEVICES & INTEGRATIONS', 'ACCOUNT'].map((g) => <div key={g} style={{ fontSize: 9, color: '#8A7A66', fontWeight: 800, letterSpacing: '.07em', padding: '9px 8px 2px' }}>{g}</div>)}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateRows: '56px minmax(0,1fr)', height: '100%', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0 20px', borderBottom: '1px solid var(--line)', background: 'var(--card)' }}>
          <div style={{ fontWeight: 800, fontSize: 13 }}>Luxe Nails &amp; Spa<span style={{ display: 'block', fontSize: 9.5, color: '#8A7A66', fontWeight: 600 }}>Downtown Branch</span></div>
          <div style={{ flex: 1, maxWidth: 430, height: 38, border: '1px solid var(--line)', borderRadius: 11, background: '#FFFDF8', display: 'flex', alignItems: 'center', padding: '0 12px', color: '#9a8c79', fontSize: 12.5 }}>⌕ &nbsp;Search customers, phone, email, loyalty ID…</div>
          <div style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, textAlign: 'right' }}>May 06, 2026<span style={{ display: 'block', fontSize: 11, color: '#8A7A66' }}>2:34 PM</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginLeft: 8 }}><div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--grad)', border: '1px solid #C9933B' }} /><div><div style={{ fontSize: 12, fontWeight: 700 }}>Sophia Nguyen</div><div style={{ fontSize: 10, color: '#8A7A66' }}>Owner</div></div></div>
        </div>
        <div style={{ height: '100%', overflow: 'auto' }}><POSCustomersScreen /></div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('story')!).render(<MemoryRouter><div className="frame"><Shell /></div></MemoryRouter>);
