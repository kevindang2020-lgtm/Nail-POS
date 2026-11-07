import { useCallback, useEffect, useState } from 'react';
import { useScopedQuery, useStreamInvalidation, OfflineStatus } from '@aipowersalon/mobile-sdk';
import { techApi, type TechDashboardState, type TechTicketDetail } from '../api/techApi';
import { useTechNav } from '../shell/nav';
import { CashPendingBanner } from '../components/CashPendingBanner';
import { HelpRequestsCard } from '../components/HelpRequestsCard';
import { TimeClockCard } from '../components/TimeClockCard';
import { MyMetricsCard } from '../components/MyMetricsCard';
import { money2, elapsed, greeting, longDate, statusLabel, statusKind, clock } from '../lib/tech';
import { useTechStream } from '../lib/useTechStream';
import { TODAY_FILTER } from '../lib/techRelevance';

// Module 1 — Home Dashboard (1:1 with the Tech App reference). Reads GET /tech (server-truth) and, when a ticket is
// awaiting acceptance, the assigned ticket itself. Information architecture matches the reference: greeting → new
// assignment → current status (with inline Break) → current service (with progress) → today summary → next up. Every
// value is bound to real backend data; no value is invented. The service timer counts from the backend startedAt so it
// survives refresh/reconnect.
const Bell = () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" /></svg>);

const firstName = (full?: string) => (full || 'Technician').trim().split(/\s+/)[0];

export function TechDashboardScreen() {
  const nav = useTechNav();
  // BUILD_PLAN Phase 13: today's overview through the query layer (scoped, offline read cache, stream-invalidated). The
  // awaiting-acceptance ticket is part of the same read, so the New Assignment card and the overview stay in step.
  const dq = useScopedQuery<{ d: TechDashboardState; offer: TechTicketDetail | null }>({ key: ['tech', 'today'], persist: true, fn: async () => {
    const data = await techApi.dashboard();
    // Pull the awaiting-acceptance ticket so the New Assignment card shows real customer/service/countdown.
    let offer: TechTicketDetail | null = null;
    if (data.assignedTicketId && data.availableActions.canAcceptTicket) {
      try { offer = await techApi.ticket(data.assignedTicketId!); } catch { offer = null; }
    }
    return { d: data, offer };
  } });
  const d = dq.data?.d ?? null;
  const offer = dq.data?.offer ?? null;
  const error = !d && dq.isError ? ((dq.error as any)?.message || 'Failed to load your dashboard.') : null;
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const refetch = dq.refetch;
  const load = useCallback(async () => { await refetch(); }, [refetch]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useTechStream(useStreamInvalidation([['tech', 'today']]), undefined, TODAY_FILTER);

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setNote(null); setBusy(key);
    try { await fn(); if (ok) setNote(ok); await load(); } catch (e: any) { setNote(e?.message || 'Action failed.'); } finally { setBusy(null); }
  };

  if (error) return <div className="tech-state" role="alert" style={{ color: 'var(--tech-danger)' }}>{error}</div>;

  const t = d?.technician || ({} as any), ov = d?.overview || ({} as any), e = d?.earnings || ({} as any), cs = d?.currentService, aa = d?.availableActions || ({} as any);
  const newCount = aa.canAcceptTicket && d?.assignedTicketId ? 1 : 0;

  // New-assignment acceptance countdown (server-authoritative deadline; the card hides itself once expired).
  const deadline = offer?.acceptanceDeadline ? new Date(offer.acceptanceDeadline).getTime() : null;
  const remainMs = deadline != null ? deadline - now : null;
  const countdown = remainMs != null && remainMs > 0 ? `${Math.floor(remainMs / 60000)}:${String(Math.floor((remainMs % 60000) / 1000)).padStart(2, '0')}` : null;
  const offerLive = offer && (deadline == null || (remainMs ?? 1) > 0);
  const offerServices = (offer?.services || []).map((s) => s.name).join(' + ');

  // Current-service progress from elapsed vs estimated finish (real fields; omitted when no estimate exists).
  const csStart = cs?.startedAt ? new Date(cs.startedAt).getTime() : null;
  const csEnd = cs?.estimatedFinishTime ? new Date(cs.estimatedFinishTime).getTime() : null;
  const csProgress = csStart != null && csEnd != null && csEnd > csStart
    ? Math.min(100, Math.max(0, ((now - csStart) / (csEnd - csStart)) * 100)) : null;

  // Sep 2026 merge: until the data arrives, say so — the redesign rendered 0 appointments / $0 as if they were real
  if (!d && !error) return <div className="tech-state" role="status">Loading today’s overview…</div>;

  return (
    <div aria-busy={!d}>
      <OfflineStatus updatedAt={dq.dataUpdatedAt || undefined} failed={dq.isError} />
      {!d && <span role="status" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>Loading today…</span>}
      {/* Greeting — matches the reference header: time-of-day greeting, first name with a wave, new-assignment count. */}
      <div className="tech-tab-header" style={{ marginBottom: 32 }}>
        <div className="tech-tab-header__inner" style={{ paddingTop: 24, paddingBottom: 20 }}>
          <div className="tech-avatar">{!d ? <div className="tech-skel" style={{ width: '100%', height: '100%' }} /> : t.avatarUrl ? <img src={t.avatarUrl} alt="" /> : t.initials}</div>
        <div style={{ minWidth: 0 }}>
          <div className="tech-label">{greeting()},</div>
          <div className="tech-h-serif" style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.1 }}>
            {!d ? <div className="tech-skel" style={{ width: 140, height: 24, display: 'inline-block' }} /> : <>{firstName(t.fullName)} <span aria-hidden>👋</span></>}
          </div>
          <button className="tech-link" style={{ marginTop: 3 }} onClick={() => nav.go('tickets')} disabled={!d}>
            {!d ? <div className="tech-skel" style={{ width: 180, height: 16 }} /> : newCount ? `You have ${newCount} new assignment${newCount > 1 ? 's' : ''}` : 'You’re all caught up'}
          </button>
        </div>
        <button className="tech-iconbtn" style={{ marginLeft: 'auto', position: 'relative' }} aria-label="Notifications" onClick={() => nav.openNotifications()}>
          <Bell />{d?.notificationsCount ? <span style={{ position: 'absolute', top: 4, right: 4, minWidth: 16, height: 16, borderRadius: 8, background: 'var(--tech-danger)', color: '#fff', fontSize: 10, display: 'grid', placeItems: 'center', padding: '0 3px' }}>{d.notificationsCount}</span> : null}
        </button>
      </div>
      </div>
<div className="tech-main-2">


      <CashPendingBanner />
      <TimeClockCard ready={Boolean(d)} />
      <MyMetricsCard />
      <HelpRequestsCard />
      {note ? <div className="tech-card" style={{ marginBottom: 12, padding: 12, fontSize: 13 }} role="status">{note}</div> : null}

      {/* New Assignment — prominent gold card with the real customer, services, and acceptance countdown (spec §9). */}
      {offerLive ? (
        <div className="tech-assign" style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="tech-eyebrow">New Assignment</span>
            {countdown ? <span className="tech-countpill">Expires in {countdown}</span> : null}
          </div>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{offer!.ticketNumber ? `#${offer!.ticketNumber}` : 'New ticket'}</div>
          {offer!.customerName ? <div style={{ fontWeight: 700, marginTop: 2 }}>{offer!.customerName}</div> : null}
          {offerServices ? <div className="tech-label" style={{ marginTop: 2 }}>{offerServices}</div> : null}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14 }}>
            <button className="tech-btn outline" disabled={busy !== null} onClick={() => nav.openTicket(offer!.ticketId)}>Decline</button>
            <button className="tech-btn gold" disabled={busy !== null} onClick={() => act('accept', () => techApi.accept(offer!.ticketId, offer!.version), 'Ticket accepted.')}>Accept</button>
          </div>
          <button className="tech-link" style={{ display: 'block', margin: '10px auto 0' }} onClick={() => nav.openTicket(offer!.ticketId)}>Review details</button>
        </div>
      ) : null}

      {/* Current Status — status with an inline Break action, plus the "since" time when serving (spec §9). */}
      <div className="tech-card">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div className="tech-label">Current Status</div>
            {!d ? <div className="tech-skel" style={{ width: 100, height: 26, marginTop: 4 }} /> : (
              <div className={'tech-statusbig'} style={{ color: `var(--tech-${statusKind(t.status) === 'ok' ? 'success' : statusKind(t.status) === 'warn' ? 'warning' : statusKind(t.status) === 'danger' ? 'danger' : 'primary-dark'})`, marginTop: 4 }}>{statusLabel(t.status)}</div>
            )}
            {cs?.startedAt ? <div className="tech-muted" style={{ fontSize: 11.5, marginTop: 3 }}>Since {clock(cs.startedAt)}</div> : null}
          </div>
          {aa.canToggleBreak && d ? (
            <button className="tech-chip neutral" style={{ border: 'none', cursor: 'pointer' }} disabled={busy !== null}
              onClick={() => act('break', async () => { const r = await techApi.toggleBreak(); setNote(r.status === 'on_break' ? 'Break started.' : 'Break ended — you’re back in rotation.'); }, '')}>
              {t.status === 'on_break' ? 'End Break' : 'Break'}
            </button>
          ) : !d ? <div className="tech-skel" style={{ width: 60, height: 24, borderRadius: 12 }} /> : null}
        </div>
      </div>

      {/* Current Ticket — live service with a real progress bar, elapsed timer, and a link into the ticket workspace. */}
      <div className="tech-section-title" style={{ margin: '18px 0 8px' }}>Current Ticket</div>
      {!d ? (
        <div className="tech-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="tech-skel" style={{ width: 44, height: 44, borderRadius: '50%' }} />
            <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="tech-skel" style={{ width: '60%', height: 16 }} />
              <div className="tech-skel" style={{ width: '40%', height: 14 }} />
            </div>
          </div>
        </div>
      ) : cs ? (
        <div className="tech-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="tech-avatar">{cs.customerInitials}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 800 }}>{cs.customerName}</div>
              <div className="tech-label">{cs.serviceName}</div>
              {cs.startedAt ? <div className="tech-muted" style={{ fontSize: 11.5, marginTop: 2 }}>Started {clock(cs.startedAt)} · {elapsed(cs.startedAt, now)} elapsed</div> : null}
            </div>
            <span className={'tech-chip ' + statusKind(cs.status)}><span className="live" />{statusLabel(cs.status)}</span>
          </div>
          {csProgress != null ? (
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="tech-progress" style={{ flex: 1 }}><span style={{ width: `${csProgress}%` }} /></div>
              <span className="tech-label" style={{ whiteSpace: 'nowrap' }}>{cs.status === 'nearly_finished' ? 'Finishing up' : `${Math.round(csProgress)}%`}</span>
            </div>
          ) : null}
          <button className="tech-btn gold" style={{ marginTop: 14 }} onClick={() => nav.openTicket(cs.ticketId)}>View Ticket</button>
        </div>
      ) : (
        <div className="tech-card tech-state" style={{ boxShadow: 'none' }}>You do not have an active service.</div>
      )}

      {/* Today Summary — compact stat band (keeps the canonical overview counts) plus sales/tips and est. commission. */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '18px 0 8px' }}>
        <div className="tech-section-title">Today Summary</div><div className="tech-label">{longDate()}</div>
      </div>
      <div className="tech-grid cols-3">
        <div className="tech-metric"><div className="mv">{!d ? <div className="tech-skel" style={{ width: 40, height: 28, margin: '0 auto' }} /> : ov.bookings}</div><div className="ml">Today’s Tickets</div></div>
        <div className="tech-metric"><div className="mv">{!d ? <div className="tech-skel" style={{ width: 40, height: 28, margin: '0 auto' }} /> : ov.inService}</div><div className="ml">In Service</div></div>
        <div className="tech-metric"><div className="mv">{!d ? <div className="tech-skel" style={{ width: 40, height: 28, margin: '0 auto' }} /> : ov.completed}</div><div className="ml">Completed</div></div>
      </div>
      <div className="tech-grid cols-2" style={{ marginTop: 10 }}>
        <div className="tech-metric"><div className="mv">{!d ? <div className="tech-skel" style={{ width: 80, height: 28, margin: '0 auto' }} /> : money2(ov.totalSalesCents)}</div><div className="ml">Today’s Sales</div>{ov.totalSalesTrendPercent ? <div className={'tech-trend ' + (ov.totalSalesTrendPercent >= 0 ? 'up' : 'down')}>{ov.totalSalesTrendPercent >= 0 ? '↑' : '↓'} {Math.abs(ov.totalSalesTrendPercent)}% vs yesterday</div> : null}</div>
        <div className="tech-metric"><div className="mv">{!d ? <div className="tech-skel" style={{ width: 80, height: 28, margin: '0 auto' }} /> : (e.tipsCents == null ? '—' : money2(e.tipsCents))}</div><div className="ml">Today’s Tips</div></div>
      </div>
      <div className="tech-metric" style={{ marginTop: 10 }}>
        <div className="mv">{!d ? <div className="tech-skel" style={{ width: 120, height: 28, margin: '0 auto' }} /> : (e.estimatedCommissionCents == null ? '—' : money2(e.estimatedCommissionCents))}</div>
        <div className="ml">Est. Commission{!d ? '' : ov.totalSalesCents > 0 && e.estimatedCommissionCents != null && e.estimatedCommissionCents > 0 ? ` · ${((e.estimatedCommissionCents / ov.totalSalesCents) * 100).toFixed(1)}% of sales` : ''}</div>{d && e.note ? <div className="ml" role="note">{e.note}</div> : null}
      </div>

      {d && d.nextAppointment ? (<>
        <div className="tech-section-title" style={{ margin: '18px 0 8px' }}>Next Up</div>
        <div className="tech-card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="tech-avatar">{d.nextAppointment.customerInitials}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700 }}>{d.nextAppointment.customerName}</div>
            <div className="tech-label">{d.nextAppointment.serviceName}</div>
            <div className="tech-muted" style={{ fontSize: 11.5, marginTop: 2 }}>{clock(d.nextAppointment.startTime)}</div>
          </div>
          <span className={'tech-chip ' + statusKind(d.nextAppointment.status)}>{statusLabel(d.nextAppointment.status)}</span>
        </div>
      </>) : null}
    </div>
    </div>
  );
}
