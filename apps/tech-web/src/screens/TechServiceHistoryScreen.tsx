// TechServiceHistoryScreen.tsx — the dedicated Service History screen (mobile ecosystem Tech pass, Jul 29 2026).
// The design's screen 19: this technician's completed services, newest first — guest (first name + last initial),
// service, date, and the guest's satisfaction rating for that visit. The rating is the ticket's real
// satisfaction_rating and renders honestly: "Not rated" until a guest rates, never a fabricated score. The
// All-Services filter is fed by the technician's own distinct service names from the server.
import { useEffect, useState } from 'react';
import { techApi } from '../api/techApi';
import { useTechNav } from '../shell/nav';
import { fmtDate } from '@aipowersalon/mobile-sdk';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display

type Item = { ticketId: string; serviceName: string; customerName: string; completedAt: string | null; rating: number | null; lineTotalCents: number };

const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '·';
const day = (iso: string | null) => (iso ? fmtDate(iso) : '—');
const Back = () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>);
export function TechServiceHistoryScreen() {
  const nav = useTechNav();
  const [service, setService] = useState('');
  const [data, setData] = useState<{ items: Item[]; services: string[] } | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setData(undefined);
    techApi.serviceHistory(service || undefined)
      .then((r) => { if (active) setData(r); })
      .catch(() => { if (active) setData(null); });
    return () => { active = false; };
  }, [service]);

  return (
    <div className="tech-screen" style={{ paddingBottom: 90 }}>
      <div className="tech-topbar" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="tech-iconbtn" aria-label="Back" onClick={() => nav.back()}><Back /></button>
        <h1 style={{ margin: 0, fontSize: 19 }}>Service History</h1>
      </div>
      <div className="tech-main-2">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <select
            className="tech-select service-filter-select"
            aria-label="Filter by service"
            value={service}
            onChange={(e) => setService(e.target.value)}
            style={{ width: '100%' }}
          >
            <option value="">All Services</option>
            {(data?.services ?? []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

      {data === undefined && (
        <div className="tech-card" style={{ padding: 0 }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: '1px solid var(--tech-border, #EFE7D8)' }}>
              <div className="tech-skel" style={{ width: 40, height: 40, borderRadius: 20 }} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="tech-skel" style={{ width: '50%', height: 16 }} />
                <div className="tech-skel" style={{ width: '70%', height: 14 }} />
              </div>
              <div className="tech-skel" style={{ width: 60, height: 16 }} />
            </div>
          ))}
        </div>
      )}
      {data === null && <div className="tech-state">Your service history could not be loaded.</div>}
      {data && data.items.length === 0 && (
        <div className="tech-state">{service ? 'No completed services for that filter yet.' : 'No completed services yet — your finished tickets will appear here.'}</div>
      )}

      {data && data.items.length > 0 && (
        <div className="tech-card" style={{ padding: 0 }}>
          {data.items.map((it) => (
            <div key={`${it.ticketId}-${it.serviceName}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: '1px solid var(--tech-border, #EFE7D8)' }}>
              <div aria-hidden style={{ width: 40, height: 40, borderRadius: 20, background: 'var(--tech-gold-soft, #F3E9D7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: 'var(--tech-gold, #A96F22)' }}>{initials(it.customerName)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{it.customerName}</div>
                <div className="tech-muted" style={{ fontSize: 13 }}>{it.serviceName} · {day(it.completedAt)}</div>
              </div>
              <div style={{ fontWeight: 700, color: it.rating != null ? 'var(--tech-gold, #A96F22)' : 'var(--tech-muted, #8C7E6C)' }}>
                {it.rating != null ? `★ ${it.rating.toFixed(1)}` : 'Not rated'}
              </div>
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
