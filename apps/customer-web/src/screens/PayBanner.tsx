// PayBanner.tsx — shown on Home when the customer has a service-done, unpaid bill. Tapping opens the Skip-the-Line flow.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { skipLineApi, type ActiveBill } from '../api/skipLineApi';
import { money2 } from '../lib/appt';

export function PayBanner() {
  const nav = useNavigate();
  const [bill, setBill] = useState<ActiveBill | null>(null);
  useEffect(() => { let live = true; skipLineApi.activeBill().then((d) => { if (live) setBill(d.bill && !d.bill.paid ? d.bill : null); }).catch(() => {}); return () => { live = false; }; }, []);
  if (!bill) return null;
  return (
    <button onClick={() => nav('/pay')} aria-label="Pay your bill"
      style={{ width: '100%', textAlign: 'left', border: 0, cursor: 'pointer', borderRadius: 'var(--customer-radius-card, 18px)', padding: 16, color: '#fff', display: 'flex', alignItems: 'center', gap: 12, background: 'linear-gradient(135deg, #C9971B, #A96F22 60%, #84561A)' }}>
      <span aria-hidden style={{ fontSize: 22 }}>💳</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 800, fontSize: 15 }}>Your bill is ready — skip the line</span>
        <span style={{ display: 'block', opacity: 0.9, fontSize: 13 }}>{bill.ticketNumber} · pay {money2(bill.totalDueCents)} from your phone</span>
      </span>
      <span aria-hidden style={{ fontWeight: 800 }}>›</span>
    </button>
  );
}
