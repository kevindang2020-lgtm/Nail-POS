import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { customerFollowUpApi, type CustomerFollowUp } from '../api/customerFollowUpApi';
import { CustomerRebookFromFollowUpButton } from './CustomerFollowUpCard';
import { CustomerFollowUpReplyBox } from './CustomerFollowUpReplyBox';
import { fmtInZone } from '@aipowersalon/mobile-sdk';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display

// Service Follow-Up detail — the full message from the technician, with Book Again (preselects the tech), Rate My Tech,
// and a reply box. Opening marks it viewed server-side. Reading is server-truth; the reply box defers to the backend,
// which enforces whether the salon allows replies.
const fmtDate = (iso: string | null) => (iso ? fmtInZone(iso, { weekday: 'short', month: 'short', day: 'numeric' }) : '');

export function CustomerFollowUpDetailScreen() {
  const nav = useNavigate();
  const { id = '' } = useParams();
  const [item, setItem] = useState<CustomerFollowUp | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let live = true;
    customerFollowUpApi.get(id).then((d) => { if (live) setItem(d); }).catch((e: { message?: string }) => live && setError(e?.message || 'Could not load this follow-up.'));
    return () => { live = false; };
  }, [id]);
  useEffect(() => load(), [load]);

  const reply = async (text: string) => { await customerFollowUpApi.reply(id, text); };
  const rebook = async () => customerFollowUpApi.rebook(id);

  return (
    <div style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button onClick={() => nav(-1)} aria-label="Back" style={{ border: 0, background: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--customer-text)' }}>‹</button>
        <h1 className="cust-h1" style={{ fontSize: 20 }}>Service Follow-Up</h1>
      </div>

      {error ? <div className="cust-card" style={{ padding: 16, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{error}</div>
        : !item ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="cust-card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="cust-skel" style={{ width: 40, height: 40, borderRadius: 12 }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div className="cust-skel" style={{ width: 120, height: 16 }} />
                  <div className="cust-skel" style={{ width: 140, height: 14 }} />
                </div>
              </div>
              <div className="cust-skel" style={{ width: '100%', height: 14, marginTop: 16 }} />
              <div className="cust-skel" style={{ width: '90%', height: 14, marginTop: 6 }} />
              <div className="cust-skel" style={{ width: '70%', height: 14, marginTop: 6 }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="cust-skel" style={{ width: '100%', height: 50, borderRadius: 12 }} />
              <div className="cust-skel" style={{ width: '100%', height: 48, borderRadius: 12 }} />
            </div>
            <div className="cust-card" style={{ padding: 16 }}>
              <div className="cust-skel" style={{ width: 60, height: 14, marginBottom: 8 }} />
              <div className="cust-skel" style={{ width: '100%', height: 100, borderRadius: 12 }} />
            </div>
          </div>
        )
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="cust-card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span aria-hidden style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--customer-primary-light)', color: 'var(--customer-primary)', display: 'grid', placeItems: 'center', fontSize: 18, fontWeight: 800 }}>💬</span>
                <div>
                  <div style={{ fontWeight: 800 }}>{item.technicianName}</div>
                  <div className="cust-sub" style={{ fontSize: 13 }}>{item.serviceName}{fmtDate(item.completedAt) ? ` · ${fmtDate(item.completedAt)}` : ''}</div>
                </div>
              </div>
              <div style={{ marginTop: 12, fontSize: 15, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{item.sentMessage || item.suggestedMessage}</div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <CustomerRebookFromFollowUpButton technicianName={item.technicianName} onRebook={rebook} />
              <button className="cust-btn cust-btn-ghost" style={{ height: 48 }} onClick={() => nav(`/rate-tech/${item.ticketId}/${item.technicianId}`)}>Rate my tech</button>
            </div>

            <div className="cust-card" style={{ padding: 16 }}>
              <div className="cust-label" style={{ marginBottom: 8 }}>Reply</div>
              <CustomerFollowUpReplyBox onSend={reply} />
            </div>
          </div>
        )}
    </div>
  );
}
