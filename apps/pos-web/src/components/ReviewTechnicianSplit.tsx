// ReviewTechnicianSplit.tsx — Checkout "Review Technician Split" (spec §11/§13). Shown ONLY when more than two
// technicians performed services on the ticket, so staff can review per-technician service earnings + tip allocation
// before payment (it locks after payment). Read-only: it runs the canonical compensation engine server-side; it does
// not itself change any money.
import { useEffect, useState } from 'react';
import { posCheckoutApi } from '../api/posCheckoutApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

const money = (c: number) => '$' + ((c ?? 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Split = { participantCount: number; technicians: { technicianId: string; displayName?: string; serviceEarningsCents: number; cardTipCents: number; cashTipCents: number }[] };

export function ReviewTechnicianSplit({ ticketId, nameFor }: { ticketId: string; nameFor?: (technicianId: string) => string | undefined }) {
  const [split, setSplit] = useState<Split | null>(null);
  useEffect(() => {
    let alive = true;
    posCheckoutApi.technicianSplit(ticketId).then((s) => { if (alive) setSplit(s); }).catch(() => { if (alive) setSplit(null); });
    return () => { alive = false; };
  }, [ticketId]);

  if (!split || split.participantCount <= 2) return null;   // 1–2 technicians need no review (50/50 or single)

  return (
    <div aria-label={tx('pos.review_technician_split')} style={{ border: '1px solid #E4D8C4', borderRadius: 12, padding: 14, marginBottom: 12, background: '#FFFDF8' }}>
      <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8A7A5C', marginBottom: 8 }}>
        {tx('pos.review_technician_split_2')}{' '}{split.participantCount} {tx('pos.technicians_2')}
      </div>
      {split.technicians.map((t) => (
        <div key={t.technicianId} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5, padding: '4px 0' }}>
          <span style={{ fontWeight: 600 }}>{t.displayName || nameFor?.(t.technicianId) || t.technicianId}</span>
          <span style={{ color: '#5B4E38' }}>{money(t.serviceEarningsCents)} {tx('pos.earned')}{' '}{money(t.cardTipCents + t.cashTipCents)} {tx('pos.tip')}</span>
        </div>
      ))}
      <div style={{ fontSize: 11.5, color: '#8A7A5C', marginTop: 8 }}>{tx('pos.each_technician_keeps_their_own_service_1yh9')}</div>
    </div>
  );
}
