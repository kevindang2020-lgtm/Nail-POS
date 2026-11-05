// RealtimeToasts.tsx — developer merge (Oct 2026): the POS shell pops a short toast (with a soft chime) when something
// the front desk should notice happens anywhere in the salon — a booking made or cancelled, a guest checked in, a
// technician asking for help, a ticket ready for checkout or paid, a payment failing. It listens to the ONE realtime
// stream the screens already use (window 'aps:realtime', see realtime-client.ts) — no second connection, no polling.
// Only the events named below toast: plain refetch signals (settings_updated, reports_updated …) stay silent. A frame
// that carries its own title/body uses it. When the tab is hidden and the browser already granted notifications, the
// same text goes to an OS notification (the page never asks for that permission itself — web push owns the prompt).
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { REALTIME_EVENT, ensureRealtimeConnected, type RealtimeDetail } from '../realtime/realtime-client';
import { Icon } from './tenant-nav';

interface Toast { id: number; title: string; body: string; route: string }

/** event → [title, body, where a tap goes]. Read at call time so a language switch re-reads the catalogue. */
export function toastFor(event: string): [string, string, string] | null {
  switch (event) {
    case 'appointment_created': return [t('pos.rt_new_appointment'), t('pos.rt_new_appointment_body'), '/booking'];
    case 'appointment_updated': return [t('pos.rt_appointment_updated'), t('pos.rt_appointment_updated_body'), '/booking'];
    case 'appointment_cancelled': return [t('pos.rt_appointment_cancelled'), t('pos.rt_appointment_cancelled_body'), '/booking'];
    case 'customer_checked_in': return [t('pos.rt_customer_checked_in'), t('pos.rt_customer_checked_in_body'), '/check-in'];
    case 'technician_help_requested': return [t('pos.rt_technician_needs_help'), t('pos.rt_technician_needs_help_body'), '/queue'];
    case 'technician_help_accepted': return [t('pos.rt_help_request_accepted'), t('pos.rt_help_request_accepted_body'), '/queue'];
    case 'technician_help_declined': return [t('pos.rt_help_request_declined'), t('pos.rt_help_request_declined_body'), '/queue'];
    case 'ticket_ready_checkout': return [t('pos.rt_ready_for_checkout'), t('pos.rt_ready_for_checkout_body'), '/checkout'];
    case 'ticket_paid': return [t('pos.rt_ticket_paid'), t('pos.rt_ticket_paid_body'), '/checkout'];
    case 'payment_approved': return [t('pos.rt_payment_approved'), t('pos.rt_payment_approved_body'), '/checkout'];
    case 'payment_failed': return [t('pos.rt_payment_failed'), t('pos.rt_payment_failed_body'), '/checkout'];
    case 'tech_salon_membership_requested': return [t('pos.rt_membership_request'), t('pos.rt_membership_request_body'), '/tenant/team/members'];
    case 'customer_follow_up_received': return [t('pos.rt_customer_feedback'), t('pos.rt_customer_feedback_body'), '/customers'];
    case 'owner_alert_created': return [t('pos.rt_new_system_alert'), t('pos.rt_new_system_alert_body'), '/tenant/account/activity-logs'];
    case 'ticket_change_request_created': return [t('pos.rt_ticket_change_request'), t('pos.rt_ticket_change_request_body'), '/queue'];
    case 'ticket_change_request_approved': return [t('pos.rt_change_request_approved'), t('pos.rt_change_request_approved_body'), '/queue'];
    case 'ticket_change_request_rejected': return [t('pos.rt_change_request_rejected'), t('pos.rt_change_request_rejected_body'), '/queue'];
    case 'service_done': return [t('pos.rt_service_completed'), t('pos.rt_service_completed_body'), '/service-done'];
    default: return null;
  }
}

function playChime(): void {
  try {
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }; const Ctx = w.AudioContext || w.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.4);
    osc.onended = () => { try { ctx.close?.(); } catch { /* noop */ } };
  } catch { /* audio blocked until the page has been interacted with — the toast still shows */ }
}

export function RealtimeToasts({ ms = 7000 }: { ms?: number }) {
  const nav = useNavigate();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    ensureRealtimeConnected();   // the shell keeps the stream up even on a screen that does not subscribe
    const timers: ReturnType<typeof setTimeout>[] = [];
    const onEvent = (e: Event) => {
      const d = (e as CustomEvent<RealtimeDetail>).detail;
      if (!d?.event) return;
      const p = (d.payload && typeof d.payload === 'object' ? d.payload : {}) as Record<string, unknown>;
      const known = toastFor(d.event);
      const ownTitle = typeof p.title === 'string' && p.title ? p.title : '';
      if (!known && !ownTitle) return;                        // a plain refetch signal — stay quiet
      const title = ownTitle || known![0];
      const body = (typeof p.body === 'string' && p.body) || (typeof p.message === 'string' && p.message) || known?.[1] || '';
      const id = ++seq.current;
      setToasts((xs) => [...xs.slice(-3), { id, title, body, route: known?.[2] ?? '/booking' }]);   // at most four on screen
      playChime();
      if (typeof document !== 'undefined' && document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try { new Notification(title, { body, icon: '/brand/favicon-32.png' }); } catch { /* not allowed here */ }
      }
      timers.push(setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== id)), ms));
    };
    window.addEventListener(REALTIME_EVENT, onEvent);
    return () => { window.removeEventListener(REALTIME_EVENT, onEvent); timers.forEach(clearTimeout); };
  }, [ms]);

  if (!toasts.length) return null;
  const dismiss = (id: number) => setToasts((xs) => xs.filter((x) => x.id !== id));
  return (
    <div role="status" aria-live="polite" data-testid="realtime-toasts" style={{ position: 'fixed', top: 20, right: 20, zIndex: 99999, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 380, width: 'calc(100vw - 40px)', pointerEvents: 'none' }}>
      {toasts.map((x) => (
        <div key={x.id} data-testid="realtime-toast" style={{ pointerEvents: 'auto', background: '#FFFDF8', border: '1px solid #E5D5BC', borderRadius: 14, boxShadow: '0 12px 36px rgba(42,33,24,0.22)', padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: '#FCEFD8', color: '#A96F22', display: 'grid', placeItems: 'center', flexShrink: 0, marginTop: 2 }}><Icon name="bell" /></div>
          <button type="button" style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit' }} onClick={() => { dismiss(x.id); nav(x.route); }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, color: '#2A2118', marginBottom: 2 }}>{x.title}</div>
            {x.body ? <div style={{ fontSize: 12, color: '#6A5F52', lineHeight: 1.4 }}>{x.body}</div> : null}
          </button>
          <button type="button" aria-label={t('pos.dismiss')} onClick={() => dismiss(x.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#998A78', padding: '0 4px', fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
      ))}
    </div>
  );
}
