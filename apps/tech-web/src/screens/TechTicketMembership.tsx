import { useEffect, useState } from 'react';
import { techApi, type TechMembershipView, type TechMemberBenefit } from '../api/techApi';
import { centsToUsd } from '@aipowersalon/money';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display

// TechTicketMembership — shows the ticket customer's membership (plan/status/member#) and benefits with remaining credits,
// so the technician knows what's covered before marking Service Done. Reads /tech/tickets/:id/membership. Renders nothing
// for non-members. Read-only; redemption happens at the POS Service Done / checkout.

const money = (c: number) => centsToUsd(c);
const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending', trial: 'Trial', active: 'Active', grace: 'Grace', past_due: 'Past due', paused: 'Paused',
  canceling: 'Canceling', canceled: 'Canceled', expired: 'Expired', suspended: 'Suspended', comped: 'Comped', completed: 'Completed',
};

function remaining(b: TechMemberBenefit): string | null {
  if (b.benefitType === 'service_credit') return b.serviceCreditsAvailable > 0 ? `${b.serviceCreditsAvailable} left` : 'None left';
  if (b.benefitType === 'dollar_credit') return `${money(b.dollarCreditsAvailableCents)} left`;
  return null;
}

export function TechTicketMembership({ ticketId }: { ticketId: string }) {
  const [data, setData] = useState<TechMembershipView | null>(null);

  useEffect(() => {
    let live = true;
    techApi.ticketMembership(ticketId).then((d) => { if (live) setData(d); }).catch(() => { if (live) setData(null); });
    return () => { live = false; };
  }, [ticketId]);

  const m = data?.membership;
  if (!data || !data.hasMembership || !m) return null;

  return (
    <div className="tech-card" style={{ borderLeft: '3px solid var(--tech-primary)' }}>
      <div className="tech-label" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span aria-hidden style={{ color: 'var(--tech-primary)' }}>★</span>
        <span>Membership</span>
        <span className="tech-chip" style={{ background: 'var(--tech-primary-light)', color: 'var(--tech-primary-dark)', padding: '1px 7px' }}>{STATUS_LABEL[m.status] || m.status}</span>
      </div>
      <div style={{ fontWeight: 700 }}>{m.planName || 'Membership'}</div>
      {m.memberNumber ? <div className="tech-muted" style={{ fontSize: 12 }}>Member #{m.memberNumber}</div> : null}

      {data.benefits.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
          {data.benefits.map((b) => {
            const left = remaining(b);
            return (
              <div key={b.benefitId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
                <span>{b.label}</span>
                {left ? <span className="tech-chip" style={{ whiteSpace: 'nowrap' }}>{left}</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
