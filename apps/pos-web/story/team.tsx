import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { POSTeamScreen } from '../src/screens/POSTeamScreen';
import { posTeamApi } from '../src/api/posTeamApi';

const row = (id: string, name: string, email: string, phone: string, role: string, level: string | null, dept: string, shift: string, status: string, perf: number | null, label: string | null, svc: number, rev: number, comm: number, provider: boolean) =>
  ({ employeeId: id, userId: id.toLowerCase(), technicianId: provider ? 't-'+id.toLowerCase() : null, name, email, phone, avatarUrl: null, role, roleLevel: level, department: dept, shift, status, performanceScore: perf, performanceLabel: label, servicesCount: svc, revenueCents: rev, commissionCents: comm, isProvider: provider });

const STATE = {
  kpis: { totalMembers: 28, activeToday: 18, onShiftNow: 12, avgPerformance: 4.6, totalServices: 1248, totalCommissionCents: 1284600, pendingApprovals: 4, openPositions: 3 },
  rows: {
    items: [
      row('EMP-1001', 'Samantha Green', 'samantha@luxe.com', '(555) 123-4567', 'Nail Technician', 'Level 2', 'Nail Services', '9:00 AM - 6:00 PM', 'on_shift', 4.8, 'Excellent', 48, 124875, 18731, true),
      row('EMP-1002', 'Charlotte Taylor', 'charlotte@luxe.com', '(555) 234-5678', 'Nail Technician', 'Level 3', 'Nail Services', '10:00 AM - 7:00 PM', 'on_shift', 4.7, 'Excellent', 42, 103250, 15488, true),
      row('EMP-1003', 'Olivia Brown', 'olivia@luxe.com', '(555) 345-6789', 'Stylist', 'Senior', 'Hair Services', '9:00 AM - 6:00 PM', 'on_shift', 4.9, 'Excellent', 36, 142500, 21375, true),
      row('EMP-1004', 'Emma Wilson', 'emma@luxe.com', '(555) 456-7890', 'Stylist', 'Senior', 'Hair Services', '11:00 AM - 8:00 PM', 'on_break', 4.6, 'Very Good', 29, 89250, 13388, true),
      row('EMP-1005', 'Isabella Davis', 'isabella@luxe.com', '(555) 567-8901', 'Nail Technician', 'Level 1', 'Nail Services', '9:00 AM - 6:00 PM', 'on_shift', 4.5, 'Very Good', 31, 64525, 9679, true),
      row('EMP-1006', 'Sophia Martinez', 'sophia@luxe.com', '(555) 678-9012', 'Nail Tech', 'Level 2', 'Nail Services', '10:00 AM - 7:00 PM', 'off_today', 4.4, 'Good', 26, 71225, 10684, true),
      row('EMP-1007', 'Mia Johnson', 'mia@luxe.com', '(555) 789-0123', 'Receptionist', null, 'Front Desk', '9:00 AM - 6:00 PM', 'on_shift', 4.7, 'Excellent', 0, 0, 0, false),
      row('EMP-1008', 'Liam Anderson', 'liam@luxe.com', '(555) 890-1234', 'Assistant', null, 'Support', '11:00 AM - 8:00 PM', 'on_shift', 4.3, 'Good', 12, 21000, 2100, true),
    ],
    pagination: { page: 1, pageSize: 8, totalItems: 28, totalPages: 4 },
  },
  tabs: [
    { id: '', label: 'All Members', count: 28 }, { id: 'stylists', label: 'Stylists', count: 12 }, { id: 'nail_technicians', label: 'Nail Technicians', count: 8 },
    { id: 'receptionists', label: 'Receptionists', count: 3 }, { id: 'assistants', label: 'Assistants', count: 4 }, { id: 'managers', label: 'Managers', count: 1 },
  ],
  facets: { roles: ['Nail Technician', 'Stylist', 'Receptionist', 'Assistant', 'Manager'], statuses: ['on_shift', 'on_break', 'off_today', 'absent'], shifts: ['scheduled', 'unscheduled'], departments: ['Nail Services', 'Hair Services', 'Front Desk', 'Support', 'Management'] },
  attendance: [{ status: 'Present', count: 18 }, { status: 'On Break', count: 3 }, { status: 'Absent', count: 4 }, { status: 'Off', count: 3 }],
  performance: { overall: 4.6, distribution: [{ label: 'Excellent (4.5 - 5.0)', count: 14 }, { label: 'Very Good (3.5 - 4.4)', count: 9 }, { label: 'Good (2.5 - 3.4)', count: 3 }, { label: 'Needs Improvement (<2.5)', count: 2 }] },
  topPerformers: [{ employeeId: 'EMP-1001', name: 'Samantha Green', avatarUrl: null, score: 4.9 }, { employeeId: 'EMP-1003', name: 'Olivia Brown', avatarUrl: null, score: 4.8 }, { employeeId: 'EMP-1002', name: 'Charlotte Taylor', avatarUrl: null, score: 4.7 }],
  birthdays: [{ employeeId: 'EMP-1004', name: 'Emma Wilson', avatarUrl: null, date: 'May 08' }, { employeeId: 'EMP-1006', name: 'Sophia Martinez', avatarUrl: null, date: 'May 12' }, { employeeId: 'EMP-1007', name: 'Mia Johnson', avatarUrl: null, date: 'May 15' }],
  shiftOverview: [{ label: 'Morning Shift', time: '9 AM - 2 PM', members: 8, present: 7, presentLabel: '7 Present' }, { label: 'Afternoon Shift', time: '2 PM - 7 PM', members: 10, present: 6, presentLabel: '6 Present' }, { label: 'Evening Shift', time: '7 PM - 11 PM', members: 7, present: 5, presentLabel: '5 Scheduled' }],
  productivity: { servicesCompleted: 1248, revenueCents: 874200, commissionCents: 124800 },
  approvals: [{ type: 'leave', label: 'Leave Requests', count: 2 }, { type: 'shift_swap', label: 'Shift Swap Request', count: 1 }, { type: 'document', label: 'Document Verification', count: 1 }],
  training: { certificationsExpiring: 8, trainingInProgress: 12, newTrainings: 5 },
  trends: { members: 12.5, performance: 0.3, services: 18.4, commission: 15.7, prodServices: 18.4, prodRevenue: 15.7, prodCommission: 16.3 },
};

(posTeamApi as any).getState = async () => STATE;
(posTeamApi as any).getMember = async (userId: string) => {
  const r = STATE.rows.items.find((x: any) => x.userId === userId) || STATE.rows.items[0];
  return {
    userId: r.userId, technicianId: r.technicianId, employeeId: r.employeeId, name: r.name, email: r.email, phone: r.phone, avatarUrl: r.avatarUrl,
    role: r.role, roleLevel: r.roleLevel, department: r.department, status: r.status, shift: r.shift, isProvider: r.isProvider,
    hireDate: '2024-03-12T00:00:00Z', branchId: 'b1',
    performanceScore: r.performanceScore, performanceLabel: r.performanceLabel, reviewCount: 64,
    servicesCount: r.servicesCount, revenueCents: r.revenueCents, commissionCents: r.commissionCents,
    skills: r.isProvider ? ['Gel Manicure', 'Classic Pedicure', 'Acrylic Full Set', 'Nail Art', 'Dip Powder'] : [],
    access: { lastLoginAt: '2026-05-06T13:58:00Z', mfaEnabled: true, accountStatus: 'active' },
  };
};

const NAV = ['Overview', 'Dashboard', 'Check-In', 'Booking', 'Tech Queue', 'Customer Queue', 'Serving', 'Service Done', 'Checkout', 'Customers'];
const TEAM_SUB = ['All Team Members', 'Roles & Permissions', 'Shifts & Schedules', 'Attendance', 'Performance', 'Commissions', 'Training & Certifications'];

function Shell() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '248px minmax(0,1fr)', height: '100%', background: 'var(--page)' }}>
      <div style={{ background: 'var(--sidebar)', borderRight: '1px solid var(--line)', overflow: 'hidden', fontSize: 12.5 }}>
        <div style={{ padding: '14px 16px 8px' }}><img src="../public/brand/aipowersalon-logo.png" alt="AI PowerSalon" style={{ width: '100%', maxWidth: 184, display: 'block' }} /></div>
        <div style={{ padding: '6px 10px' }}>
          {NAV.map((n) => <a key={n} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px', borderRadius: 9, fontWeight: 600, color: '#6D5F50', marginBottom: 1 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#E2C686' }} />{n}</a>)}
          <div style={{ fontSize: 9, color: '#8A7A66', fontWeight: 800, letterSpacing: '.07em', padding: '10px 8px 3px' }}>TEAM</div>
          {TEAM_SUB.map((n) => <a key={n} style={{ display: 'block', padding: '6px 10px 6px 22px', borderRadius: 8, fontWeight: n === 'All Team Members' ? 800 : 600, color: n === 'All Team Members' ? '#8B5A18' : '#6D5F50', background: n === 'All Team Members' ? '#FCEFD8' : 'transparent', marginBottom: 1, fontSize: 12 }}>{n}</a>)}
          {['SERVICES & PRODUCTS', 'PAYMENTS & MONEY', 'COMMUNICATIONS', 'MARKETING & GROWTH', 'AI CENTER', 'REPORTS', 'MANAGEMENT', 'DEVICES & INTEGRATIONS', 'ACCOUNT'].map((g) => <div key={g} style={{ fontSize: 9, color: '#8A7A66', fontWeight: 800, letterSpacing: '.07em', padding: '9px 8px 2px' }}>{g}</div>)}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateRows: '56px minmax(0,1fr)', height: '100%', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0 20px', borderBottom: '1px solid var(--line)', background: 'var(--card)' }}>
          <div style={{ fontWeight: 800, fontSize: 13 }}>Luxe Nails &amp; Spa<span style={{ display: 'block', fontSize: 9.5, color: '#8A7A66', fontWeight: 600 }}>Downtown Branch</span></div>
          <div style={{ flex: 1, maxWidth: 430, height: 38, border: '1px solid var(--line)', borderRadius: 11, background: '#FFFDF8', display: 'flex', alignItems: 'center', padding: '0 12px', color: '#9a8c79', fontSize: 12.5 }}>⌕ &nbsp;Search team members, role, skills, or performance…</div>
          <div style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, textAlign: 'right' }}>May 06, 2026<span style={{ display: 'block', fontSize: 11, color: '#8A7A66' }}>2:34 PM</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginLeft: 8 }}><div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--grad)', border: '1px solid #C9933B' }} /><div><div style={{ fontSize: 12, fontWeight: 700 }}>Sophia Nguyen</div><div style={{ fontSize: 10, color: '#8A7A66' }}>Owner</div></div></div>
        </div>
        <div style={{ height: '100%', overflow: 'auto' }}><POSTeamScreen /></div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('story')!).render(<MemoryRouter><div className="frame"><Shell /></div></MemoryRouter>);
