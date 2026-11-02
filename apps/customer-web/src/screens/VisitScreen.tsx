import { useCustomerStream } from '../api/useCustomerStream';
import { useCallback, useEffect, useRef, useState } from 'react';
import { customerApi, type CustomerActiveService } from '../api/customerApi';
import { fmtTime } from '@aipowersalon/mobile-sdk';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display

// Customer → My Visit — the live in-progress display the salon flow feeds: polls GET /customer/service-progress every
// 15s and ticks the elapsed time each second between polls. Shows the active service, a progress bar, elapsed time and
// estimated finish, and an "almost ready" cue as the service wraps. Server derives the customer from the session.
const statusLabel = (s: string) => {
  const v = (s || '').toLowerCase();
  if (v === 'serving') return 'In progress';
  if (v === 'nearly_finished') return 'Almost done';
  if (v === 'completed' || v === 'ready_checkout') return 'Ready for checkout';
  return s || 'In progress';
};
const fmtElapsed = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60), r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
};
const fmtFinish = (iso: string | null) => {
  if (!iso) return null;
  return fmtTime(iso) || null;
};

export function VisitScreen() {
  const [svc, setSvc] = useState<CustomerActiveService | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => {
    (customerApi.serviceProgress() as Promise<CustomerActiveService | null>)
      .then((r) => { setSvc(r); setError(null); setLoaded(true); })
      .catch((e: any) => { setError(e?.message || 'Could not load your visit.'); setLoaded(true); });
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(() => setNow(Date.now()), 1000);          // the on-screen elapsed clock, not a data poll
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [load]);

  // Constitution 9: this screen watches the customer's OWN visit, and the stream now subscribes to their active
  // ticket room — where ticket_service_line_added/updated/removed have been published since Constitution 8 with
  // nothing listening. Service-line and service-status changes now arrive live; the 15s unconditional poll that
  // ran even while connected is replaced by the shared client's fallback (only while live updates are down).
  useCustomerStream((ev) => {
    if (ev === 'reconcile' || ['ticket_service_line_added', 'ticket_service_line_updated', 'ticket_service_line_removed',
      'service_started', 'service_done', 'ticket_ready_checkout', 'ticket_paid'].includes(ev)) load();
  });

  if (!loaded) return <div style={{ padding: 16 }} className="muted">Loading your visit…</div>;
  if (error) return <div style={{ padding: 16 }}><h2 style={{ marginTop: 0 }}>My Visit</h2><div className="err">{error}</div></div>;

  if (!svc) {
    return (
      <div style={{ padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>My Visit</h2>
        <div className="muted" style={{ textAlign: 'center', padding: 28, border: '1px dashed var(--line)', borderRadius: 14, marginTop: 8 }}>
          You don’t have a service in progress right now.<br />We’ll see you at your next appointment! ✨
        </div>
      </div>
    );
  }

  const liveElapsed = svc.startedAt ? (now - new Date(svc.startedAt).getTime()) / 1000 : svc.elapsedSeconds;
  const pct = Math.max(0, Math.min(100, svc.progressPercent));
  const finish = fmtFinish(svc.estimatedFinishTime);
  const almost = pct >= 80 || (svc.status || '').toLowerCase() === 'nearly_finished';

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2 style={{ margin: 0 }}>My Visit</h2>
        <span className="pill" style={{ marginLeft: 'auto' }}>{statusLabel(svc.status)}</span>
      </div>

      <div style={{ marginTop: 12, background: 'var(--card, #fff)', border: '1px solid var(--line)', borderRadius: 16, padding: 18 }}>
        <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 22 }}>{svc.serviceName || 'Your service'}</div>
        <div className="s" style={{ opacity: 0.75, marginTop: 2 }}>Elapsed {fmtElapsed(liveElapsed)}{finish ? ` · est. finish ${finish}` : ''}</div>

        <div style={{ height: 12, background: 'var(--line)', borderRadius: 8, marginTop: 14, overflow: 'hidden' }}>
          <div style={{ height: 12, width: `${pct}%`, background: 'var(--gold, #caa45a)', borderRadius: 8, transition: 'width 0.6s ease' }} />
        </div>
        <div className="s" style={{ marginTop: 6, textAlign: 'right' }}>{pct}%</div>

        {almost ? (
          <div style={{ marginTop: 14, padding: '10px 12px', background: 'var(--gold-soft, #F6EFD9)', borderRadius: 10, fontWeight: 600 }}>
            Almost ready — your technician is wrapping up. 💅
          </div>
        ) : null}
      </div>

      <div className="s" style={{ marginTop: 10, opacity: 0.6, textAlign: 'center' }}>Updates automatically</div>
    </div>
  );
}
