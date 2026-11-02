import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AssignTechSheet, type AssignTech, type AssignGuest } from '../src/components/AssignTechSheet';

// Real technician roster shape (workingStatus + activeAssignments drive the availability/load badges).
const ROSTER: AssignTech[] = [
  { technicianId: 't1', displayName: 'Lily Adams', workingStatus: 'available', activeAssignments: 1, status: 'active' },
  { technicianId: 't2', displayName: 'Grace Hall', workingStatus: 'available', activeAssignments: 0, status: 'active' },
  { technicianId: 't3', displayName: 'Mia Johnson', workingStatus: 'in_service', activeAssignments: 2, status: 'active' },
  { technicianId: 't4', displayName: 'Charlotte Taylor', workingStatus: 'in_service', activeAssignments: 1, status: 'active' },
  { technicianId: 't5', displayName: 'Emma Wilson', workingStatus: 'on_break', activeAssignments: 0, status: 'active' },
];

const GUESTS: AssignGuest[] = [
  { id: 'q1', name: 'Olivia Brown', meta: 'Acrylic Full Set · waiting 18m', isVip: true },
  { id: 'q2', name: 'Emma Wilson', meta: 'Gel X Full Set · waiting 11m' },
  { id: 'q3', name: 'Sophia Martinez', meta: 'Nail Art · waiting 6m' },
  { id: 'q4', name: 'Isabella Davis', meta: 'Pedicure · waiting 4m' },
];

const NAV = (active: string) => ['Overview', 'Dashboard', 'Check-In', 'Booking', 'Tech Queue', 'Customer Queue', 'Serving', 'Service Done', 'Checkout'].map((n) => (
  <a key={n} className={'nav-a' + (n === active ? ' active' : '')} style={navA(n === active)}><span style={dot(n === active)} />{n}</a>
));
function navA(on: boolean): React.CSSProperties { return { display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px', borderRadius: 9, fontSize: 12.5, fontWeight: on ? 800 : 600, color: on ? '#2C2118' : '#6D5F50', marginBottom: 1, background: on ? 'linear-gradient(135deg,#F3D58C,#D8A646)' : 'transparent', border: on ? '1px solid #D7AE5C' : '1px solid transparent' }; }
function dot(on: boolean): React.CSSProperties { return { width: 6, height: 6, borderRadius: '50%', background: on ? '#8B5A18' : '#E2C686' }; }

function Shell({ active, title, sub, children }: { active: string; title: string; sub: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px minmax(0,1fr)', height: '100%', background: 'var(--page)' }}>
      <div style={{ background: 'var(--sidebar)', borderRight: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 16px 12px' }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--grad)', border: '1px solid #C9933B' }} />
          <div><div style={{ fontFamily: '"Playfair Display",serif', fontWeight: 700, fontSize: 15 }}>AI POWERSALON</div><div style={{ fontSize: 8, color: '#A96F22', fontWeight: 800, letterSpacing: '.06em', marginTop: 3 }}>SMARTER SALON</div></div>
        </div>
        <div style={{ padding: '6px 10px' }}>{NAV(active)}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateRows: '56px minmax(0,1fr)', height: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0 20px', borderBottom: '1px solid var(--line)', background: 'var(--card)' }}>
          <div style={{ fontWeight: 800, fontSize: 13 }}>Luxe Nails &amp; Spa <span style={{ display: 'block', fontSize: 9.5, color: '#8A7A66', fontWeight: 600 }}>Downtown Branch</span></div>
          <div style={{ flex: 1, maxWidth: 420, height: 38, border: '1px solid var(--line)', borderRadius: 11, background: '#FFFDF8', display: 'flex', alignItems: 'center', padding: '0 12px', color: '#9a8c79', fontSize: 12.5 }}>⌕ &nbsp;Search customers, appointments, services…</div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 9 }}><div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--grad)', border: '1px solid #C9933B' }} /><div><div style={{ fontSize: 12, fontWeight: 700 }}>Sophia Nguyen</div><div style={{ fontSize: 10, color: '#8A7A66' }}>Owner</div></div></div>
        </div>
        <div className="work" style={{ padding: '16px 20px', overflow: 'hidden', height: '100%' }}>
          <div className="vh"><h1 style={{ fontFamily: '"Playfair Display",serif', fontSize: 20 }}>{title}</h1><div style={{ fontSize: 11, color: '#8A7A66', marginTop: 2 }}>{sub}</div></div>
          {children}
        </div>
      </div>
    </div>
  );
}

const KPI = (l: string, v: string) => <div className="kpi" key={l} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px' }}><div style={{ fontSize: 9, color: '#8A7A66', fontWeight: 800, textTransform: 'uppercase' }}>{l}</div><div style={{ fontFamily: '"Playfair Display",serif', fontSize: 18, marginTop: 3 }}>{v}</div></div>;
function Row({ ini, name, sub, pill, pillCls, action }: any) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10, background: '#FFFDF8', marginBottom: 7 }}>
      <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--grad)', border: '1px solid #C9933B', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9.5, fontWeight: 800, color: '#5a4413' }}>{ini}</div>
      <div><div style={{ fontWeight: 700, fontSize: 12 }}>{name}</div><div style={{ fontSize: 10.5, color: '#8A7A66' }}>{sub}</div></div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}><span className={'pill ' + pillCls}>{pill}</span>{action}</div>
    </div>
  );
}

function Frame1() {
  return (
    <div className="frame">
      <Shell active="Serving" title="Serving" sub="Real-time active service floor, technician progress, add-ons, and completion.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 10, margin: '12px 0 14px' }}>{[['Active Services', '21'], ['Ready to Finish', '8'], ['Avg Service Time', '52m'], ['Technicians Busy', '8/12'], ['Add-On Conv.', '31%'], ['On-Time', '87%']].map(([l, v]) => KPI(l, v))}</div>
        <div className="panel" style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: 13 }}>
          <h2 style={{ fontFamily: '"Playfair Display",serif', fontSize: 14, marginBottom: 9 }}>Live Service Floor</h2>
          <Row ini="JM" name="Jessica Miller" sub="Acrylic Full Set · Station 3 · 24 min" pill="Finishing" pillCls="warn" action={<span className="btn ghost" style={{ padding: '5px 11px' }}>Close</span>} />
          <Row ini="OB" name="Olivia Brown" sub="Gel X Full Set · Station 1 · 12 min" pill="In Service" pillCls="ok" action={<span className="btn ghost" style={{ padding: '5px 11px' }}>Manage</span>} />
          <Row ini="EW" name="Emma Wilson" sub="Spa Pedicure · Station 5 · 30 min" pill="Unassigned" pillCls="" action={<span className="btn ghost" style={{ padding: '5px 11px' }}>Manage</span>} />
        </div>
      </Shell>
      <AssignTechSheet open onClose={() => {}} context="Jessica Miller · Acrylic Full Set · Station 3 · 24 min" currentTechName="Samantha Green" allowUnassign confirmLabel="Assign technician" roster={ROSTER} onAssign={async () => {}} />
    </div>
  );
}

function Frame2() {
  const [gid, setGid] = useState('q1');
  return (
    <div className="frame">
      <Shell active="Customer Queue" title="Queue" sub="Live waiting list · 14 in queue">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 10, margin: '12px 0 14px' }}>{[['Waiting Guests', '14'], ['Avg Wait', '28m'], ['VIP Waiting', '5'], ['Ready for Tech', '8'], ['Walk-ins', '11'], ['Return Rate', '68%']].map(([l, v]) => KPI(l, v))}</div>
        <div className="panel" style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: 13 }}>
          <h2 style={{ fontFamily: '"Playfair Display",serif', fontSize: 14, marginBottom: 9 }}>Live Waiting List</h2>
          <Row ini="OB" name="Olivia Brown" sub="Acrylic Full Set · waiting 18 min" pill="Unassigned" pillCls="" action={<span className="btn" style={{ background: 'var(--orange)', borderColor: 'var(--orange)', color: '#fff', padding: '5px 11px' }}>Assign</span>} />
          <Row ini="EW" name="Emma Wilson" sub="Gel X Full Set · waiting 11 min" pill="Unassigned" pillCls="" action={<span className="btn" style={{ background: 'var(--orange)', borderColor: 'var(--orange)', color: '#fff', padding: '5px 11px' }}>Assign</span>} />
          <Row ini="SM" name="Sophia Martinez" sub="Nail Art · waiting 6 min" pill="Unassigned" pillCls="" action={<span className="btn" style={{ background: 'var(--orange)', borderColor: 'var(--orange)', color: '#fff', padding: '5px 11px' }}>Assign</span>} />
        </div>
      </Shell>
      <AssignTechSheet open onClose={() => {}} title="Quick Assign" context="Send a waiting guest to a technician" guests={GUESTS} selectedGuestId={gid} onSelectGuest={setGid} confirmLabel="Assign & send to tech" roster={ROSTER} onAssign={async () => {}} />
    </div>
  );
}

createRoot(document.getElementById('story')!).render(<div><div id="f1"><Frame1 /></div><div id="f2"><Frame2 /></div></div>);
