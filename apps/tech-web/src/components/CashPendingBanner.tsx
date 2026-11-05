// CashPendingBanner.tsx — Dashboard alert when the technician has cash payments to confirm. Tapping opens the screen.
import { useEffect, useState } from 'react';
import { techApi } from '../api/techApi';
import { useTechNav } from '../shell/nav';

export function CashPendingBanner() {
  const nav = useTechNav();
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    try { const p = techApi.cashPending?.(); if (p && typeof (p as any).then === 'function') (p as Promise<{ items: unknown[] }>).then((r) => { if (live) setCount((r.items || []).length); }).catch(() => {}); } catch { /* ignore */ }
    return () => { live = false; };
  }, []);
  if (count <= 0) return null;
  return (
    <button onClick={() => nav.openCashPending()} aria-label="Cash payments waiting" className="tech-card"
      style={{ width: '100%', textAlign: 'left', cursor: 'pointer', border: 0, padding: 14, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, background: 'var(--tech-warning-bg)' }}>
      <span aria-hidden style={{ fontSize: 22 }}>💵</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 800, color: 'var(--tech-warning)' }}>{count} cash payment{count > 1 ? 's' : ''} to confirm</span>
        <span className="tech-muted" style={{ display: 'block', fontSize: 13 }}>Tap to confirm cash you’ve received</span>
      </span>
      <span aria-hidden style={{ fontWeight: 800, color: 'var(--tech-warning)' }}>›</span>
    </button>
  );
}
