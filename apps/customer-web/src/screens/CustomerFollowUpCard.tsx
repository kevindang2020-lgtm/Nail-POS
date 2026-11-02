import { useNavigate } from 'react-router-dom';
import type { CustomerFollowUp, RebookPreselect } from '../api/customerFollowUpApi';
import { fmtMonthDay } from '@aipowersalon/mobile-sdk';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display

// One "Service Follow-Up" card in the customer's list. Shows who sent it, the service, and a message preview; tapping
// opens the detail. Server-truth only.
const fmtDate = (iso: string | null) => (iso ? fmtMonthDay(iso) : '');

export function CustomerFollowUpCard({ item, onOpen }: { item: CustomerFollowUp; onOpen: (id: string) => void }) {
  const msg = item.sentMessage || item.suggestedMessage;
  return (
    <button className="cust-card" onClick={() => onOpen(item.id)} aria-label={`Follow-up from ${item.technicianName}`}
      style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'flex-start', textAlign: 'left', width: '100%', cursor: 'pointer', border: 0 }}>
      <span aria-hidden style={{ width: 38, height: 38, borderRadius: 12, background: 'var(--customer-primary-light)', color: 'var(--customer-primary)', display: 'grid', placeItems: 'center', fontSize: 17, flex: '0 0 auto', fontWeight: 800 }}>💬</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700 }}>{item.technicianName} sent you a follow-up</div>
        <div className="cust-sub" style={{ fontSize: 13, marginTop: 2 }}>{item.serviceName}{fmtDate(item.completedAt) ? ` · ${fmtDate(item.completedAt)}` : ''}</div>
        {msg ? <div className="cust-sub" style={{ fontSize: 13, marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{msg}</div> : null}
        {item.status === 'rebooked' ? <span className="cust-pill cust-pill-green" style={{ marginTop: 8 }}>Rebooked</span> : item.status === 'customer_replied' ? <span className="cust-pill cust-pill-purple" style={{ marginTop: 8 }}>Replied</span> : null}
      </div>
    </button>
  );
}

// "Rebook with {tech}" — opens the booking flow preselecting the same technician (BookScreen reads ?techId=). Records
// the rebook click server-side first (audit), then navigates with the returned preselect.
export function CustomerRebookFromFollowUpButton({ technicianName, onRebook }: { technicianName: string; onRebook: () => Promise<RebookPreselect> }) {
  const nav = useNavigate();
  const go = async () => {
    try {
      const p = await onRebook();
      const qs = new URLSearchParams();
      if (p.technicianId) qs.set('techId', p.technicianId);
      if (p.serviceId) qs.set('serviceId', p.serviceId);
      nav(`/book?${qs.toString()}`);
    } catch { nav('/book'); }
  };
  return <button className="cust-btn" style={{ height: 50 }} onClick={go}>Rebook with {technicianName.split(' ')[0]}</button>;
}
