import { useCallback, useEffect, useState } from 'react';
import { techApi, type TechTicketDetail, type TechEditOptions } from '../api/techApi';
import { TechTicketMembership } from './TechTicketMembership';
import { useTechNav } from '../shell/nav';
import { money2, clock, statusLabel, statusKind, initials } from '../lib/tech';
import { useTechStream } from '../lib/useTechStream';

// Module 3 — Ticket / Service Detail. Reads GET /tech/tickets/:id (server-truth; ownership enforced server-side).
// Actions call the real endpoints: accept → start-service → service-done, plus add-note and request-cancel.
const Back = () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>);
const Phone = () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3 19.5 19.5 0 01-6-6 19.8 19.8 0 01-3-8.6A2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.3 1.8.6 2.6a2 2 0 01-.5 2.1L8 9.5a16 16 0 006 6l1.1-1.1a2 2 0 012.1-.5c.8.3 1.7.5 2.6.6a2 2 0 011.7 2z" /></svg>);
const Msg = () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.4 8.4 0 01-9 8.4 8.5 8.5 0 01-3.9-.9L3 20l1-3.1A8.4 8.4 0 1121 11.5z" /></svg>);

import { useEscapeKey } from '../hooks/useEscapeKey';
import { RequestHelpModal } from '../components/RequestHelpModal';

export function TicketDetailScreen({ ticketId }: { ticketId: string }) {
  const nav = useTechNav();
  const [t, setT] = useState<TechTicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<null | 'done' | 'note' | 'cancel' | 'edit' | 'decline'>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  useEscapeKey(!!modal, () => setModal(null));
  const [edit, setEdit] = useState<TechEditOptions | null>(null);       // editOptions payload
  const [svcSearch, setSvcSearch] = useState('');
  const [svcCat, setSvcCat] = useState('All');
  const [chgLine, setChgLine] = useState<string | null>(null); // lineId mid-change
  const [chgNew, setChgNew] = useState('');
  const [chgReason, setChgReason] = useState('');
  const [text, setText] = useState('');
  const [vis, setVis] = useState<'internal' | 'customer'>('internal');
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    try { setT(await techApi.ticket(ticketId)); setError(null); } catch (e: any) { setError(e?.message || 'Failed to load this ticket.'); }
  }, [ticketId]);
  useEffect(() => { load(); }, [load]);
  useTechStream(load);
  // §12 acceptance countdown — tick once a second only while a deadline is pending, then reload so the (now-expired)
  // server state shows. The server is authoritative; this is display only.
  const deadlineMs = t?.status === 'assigned' && t?.acceptanceDeadline ? new Date(t.acceptanceDeadline).getTime() : null;
  useEffect(() => {
    if (!deadlineMs) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadlineMs]);
  useEffect(() => { if (deadlineMs && nowMs >= deadlineMs) load(); }, [deadlineMs, nowMs, load]);
  const secsLeft = deadlineMs ? Math.max(0, Math.round((deadlineMs - nowMs) / 1000)) : null;

  const runEdit = async (fn: () => Promise<any>, fallbackOk: string) => {
    setNote(null); setBusy('edit');
    try {
      const res = await fn();
      setNote((res && res.message) || fallbackOk);
      setChgLine(null);
      await load();
      const o = await techApi.editOptions(ticketId).catch(() => null);
      if (o) setEdit(o);
    } catch (e: any) { setNote(e?.message || 'Edit failed.'); } finally { setBusy(null); }
  };

  const act = async (key: string, fn: () => Promise<unknown>, ok: string, close = true) => {
    setNote(null); setBusy(key);
    try { await fn(); setNote(ok); if (close) setModal(null); setText(''); await load(); }
    catch (e: any) { setNote(e?.message || 'Action failed.'); } finally { setBusy(null); }
  };

  const header = (
    <div className="tech-topbar" style={{ marginBottom: 16, position: 'sticky' }}>
      <button className="tech-iconbtn" aria-label="Back" onClick={() => nav.back()}><Back /></button>
      <div className="t-title">{t?.ticketNumber ? `Ticket ${t.ticketNumber}` : 'Ticket'}</div>
      <button className="tech-iconbtn" aria-label="More actions" onClick={() => setNote('Add Service, Transfer, and Customer History are handled by the front desk.')}>⋯</button>
    </div>
  );

  if (error) return <div style={{ paddingBottom: 90 }}>{header}<div className="tech-main-2"><div className="tech-state" role="alert" style={{ color: 'var(--tech-danger)' }}>{error}</div></div></div>;
  if (!t) return (
    <div style={{ paddingBottom: 90 }}>
      {header}
      <div className="tech-main-2">
        <div className="tech-card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="tech-skel" style={{ width: 44, height: 44, borderRadius: '50%' }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="tech-skel" style={{ width: '60%', height: 16 }} />
            <div className="tech-skel" style={{ width: '40%', height: 14 }} />
          </div>
          <div className="tech-skel" style={{ width: 38, height: 38, borderRadius: 8 }} />
          <div className="tech-skel" style={{ width: 38, height: 38, borderRadius: 8 }} />
        </div>
        <div className="tech-card" style={{ marginTop: 14 }}>
          <div className="tech-skel" style={{ width: 100, height: 16, marginBottom: 12 }} />
          {[1, 2].map(i => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--tech-border)' }}>
              <div className="tech-skel" style={{ width: '50%', height: 14 }} />
              <div className="tech-skel" style={{ width: 60, height: 14 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const status = t.status; const services = t.services || [];
  const startWindow = t.scheduledStart
    ? `${new Date(t.scheduledStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${clock(t.scheduledStart)}${t.scheduledEnd ? ` – ${clock(t.scheduledEnd)}` : ''}`
    : null;
  const primary = status === 'assigned'
    ? { label: 'Accept Ticket', fn: () => techApi.accept(ticketId, t?.version), ok: 'Ticket accepted.' }
    : status === 'paused'
      ? { label: 'Resume Service', fn: () => techApi.resumeService(ticketId), ok: 'Service resumed.' }
      : status === 'accepted'
        ? { label: 'Start Service', fn: () => techApi.startService(ticketId), ok: 'Service started.' }
        : (status === 'serving' || status === 'nearly_finished')
          ? { label: 'Service Done', fn: null as any, ok: '' } // opens confirm modal
          : null;

  return (
    <div style={{ paddingBottom: 90 }}>
      {header}
      <div className="tech-main-2">
        {note ? <div className="tech-card" style={{ marginBottom: 12, padding: 12, fontSize: 13 }} role="status">{note}</div> : null}

        {/* customer header */}
        <div className="tech-card" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div className="tech-avatar">{initials(t.customerName)}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
              {t.customerName || 'Customer'}
              {t.vip ? <span className="tech-chip" style={{ background: 'var(--tech-primary-light)', color: 'var(--tech-primary-dark)', padding: '1px 7px' }}>VIP</span> : null}
              {t.loyaltyTier ? <span className="tech-muted" style={{ fontSize: 11, fontWeight: 600 }}>{t.loyaltyTier}</span> : null}
            </div>
            {t.customerPhoneMasked ? <div className="tech-muted" style={{ fontSize: 12.5 }}>{t.customerPhoneMasked}</div> : null}
            <span className={'tech-chip ' + statusKind(status)} style={{ marginTop: 6 }}>{statusLabel(status)}</span>
            {(status === 'serving' || status === 'nearly_finished') && (t as any).startSource ? (
              <span className="tech-chip" style={{ marginTop: 6, marginLeft: 6, background: (t as any).startSource === 'pos' ? '#E0F2FE' : '#DCFCE7', color: (t as any).startSource === 'pos' ? '#0369A1' : '#15803D' }}>
                {(t as any).startSource === 'pos' ? 'Started by Front Desk' : 'Started by You'}
              </span>
            ) : null}
          </div>
          <button className="tech-iconbtn" aria-label="Call customer (via salon)" onClick={() => setNote('Calls are placed through the front desk; the customer’s number is not shared.')}><Phone /></button>
          <button className="tech-iconbtn" aria-label="Message customer (via salon)" onClick={() => setNote('Messages are sent through the salon, not directly.')}><Msg /></button>
        </div>

      {/* safety — allergies/sensitivities, highlighted (rendered only when the backend provides them; never invented) */}
      {(t.allergies?.length || t.safetyNotes) ? (
        <div className="tech-card" style={{ borderColor: 'var(--tech-danger)', background: 'var(--tech-danger-bg)' }}>
          <div className="tech-label" style={{ color: 'var(--tech-danger)', marginBottom: 4 }}>⚠ Safety — confirm before service</div>
          {t.allergies?.length ? <div style={{ fontSize: 13.5, fontWeight: 700 }}>Allergies: {t.allergies.join(', ')}</div> : null}
          {t.safetyNotes ? <div style={{ fontSize: 13 }}>{t.safetyNotes}</div> : null}
        </div>
      ) : null}

      {/* membership — the ticket customer's plan + covered benefits (rendered only for members) */}
      <TechTicketMembership ticketId={ticketId} />

      {/* new assignment — reference treatment: eyebrow + reason/requested/start-window (countdown sits by the actions) */}
      {status === 'assigned' ? (
        <div className="tech-assign">
          <span className="tech-eyebrow">New Assignment</span>
          <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
            {t.assignmentReason ? <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span className="tech-muted" style={{ fontSize: 12.5 }}>Assignment reason</span><span style={{ fontSize: 12.5, fontWeight: 600, textAlign: 'right' }}>{t.assignmentReason}</span></div> : null}
            {t.requestedTechnician ? <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span className="tech-muted" style={{ fontSize: 12.5 }}>Requested</span><span style={{ fontSize: 12.5, fontWeight: 600 }}>{t.requestedTechnician}</span></div> : null}
            {startWindow ? <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span className="tech-muted" style={{ fontSize: 12.5 }}>Start window</span><span style={{ fontSize: 12.5, fontWeight: 600 }}>{startWindow}</span></div> : null}
            {t.inspoUrl ? <button className="tech-link" style={{ textAlign: 'left' }} onClick={() => t.inspoUrl && window.open(t.inspoUrl, '_blank', 'noopener')}>Go to inspo →</button> : null}
          </div>
        </div>
      ) : null}

      {/* services */}
      <div className="tech-card">
        <div className="tech-label" style={{ marginBottom: 8 }}>{status === 'assigned' ? 'Requested Services' : 'Services'}</div>
        {services.length ? services.map((s) => (
          <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--tech-border)' }}>
            <span>{s.name}</span><span style={{ fontWeight: 600 }}>{money2(s.priceCents)}</span>
          </div>
        )) : <div className="tech-muted" style={{ fontSize: 13 }}>No service lines yet.</div>}
        <div className="tech-divider" />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span className="tech-muted">Duration</span>
          <span>{t.durationMinutes ? `${t.durationMinutes} min` : '—'}{t.scheduledStart ? `  ·  ${clock(t.scheduledStart)} – ${clock(t.scheduledEnd)}` : ''}</span>
        </div>
      </div>

      {/* poster screen 4: Add-on Suggestions — real catalog Add-on services, addable only while serving */}
      {status === 'serving' && (t as any).addOnSuggestions?.length ? (
        <div className="tech-card">
          <div className="tech-label" style={{ marginBottom: 8 }}>Add-on Suggestions</div>
          {((t as any).addOnSuggestions as any[]).map((a) => (
            <div key={a.serviceId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--tech-border)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{a.serviceName}</div>
                <div className="tech-muted" style={{ fontSize: 11.5 }}>{money2(a.priceCents)}</div>
              </div>
              <button className="tech-btn ghost" style={{ minWidth: 72 }} disabled={busy !== null}
                onClick={() => act('addon' + a.serviceId, () => techApi.addAddOn(ticketId, a.serviceId), `${a.serviceName} added to the ticket.`)}>+ Add</button>
            </div>
          ))}
        </div>
      ) : null}

      {/* notes */}
      <div className="tech-card">
        <div className="tech-label" style={{ marginBottom: 6 }}>Notes</div>
        <div style={{ fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{t.notes ? t.notes : <span className="tech-muted">No notes yet.</span>}</div>
      </div>

      {/* request help — the primary asks a qualified colleague to take one service line */}
      {services.length > 0 && ['serving', 'in_service', 'accepted', 'in_progress'].includes(status) ? (
        <button className="tech-btn" onClick={() => setHelpOpen(true)} style={{ width: '100%', marginBottom: 12 }}>🙋 Request help with a service</button>
      ) : null}

      {helpOpen && services.length > 0 ? (
        <RequestHelpModal ticketId={ticketId} lines={services.map((s) => ({ id: s.id, name: s.name }))}
          onClose={() => setHelpOpen(false)} onDone={(m) => { setNote(m); setHelpOpen(false); }} />
      ) : null}

      {/* total */}
      <div className="tech-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="tech-section-title">Total</span><span className="tech-h-serif" style={{ fontSize: 22, fontWeight: 700 }}>{money2(t.totalCents)}</span>
      </div>

      {/* progress timeline */}
      <div className="tech-card">
        <div className="tech-grid cols-4" style={{ textAlign: 'center' }}>
          {[{ l: 'Accepted', at: t.acceptedAt }, { l: 'In Service', at: t.startedAt }, { l: 'Service Done', at: t.completedAt }, { l: 'Checkout', at: (status === 'done' || status === 'paid') ? t.completedAt : null }].map((st) => (
            <div key={st.l}>
              <div className="tech-tl" style={{ justifyContent: 'center' }}><span className={'tdot' + (st.at ? ' done' : '')} /></div>
              <div className="tech-label" style={{ marginTop: 6 }}>{st.l}</div>
              <div className="tech-muted" style={{ fontSize: 11 }}>{st.at ? clock(st.at) : '—'}</div>
            </div>
          ))}
        </div>
      </div>

      {/* actions */}
      <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
        {secsLeft !== null && status === 'assigned' ? (
          <div role="timer" aria-live="polite" style={{ textAlign: 'center', fontWeight: 800, fontSize: 13.5, padding: '9px 10px', borderRadius: 999, background: secsLeft <= 15 ? 'var(--tech-danger-bg)' : 'var(--tech-primary-light)', color: secsLeft <= 15 ? 'var(--tech-danger)' : 'var(--tech-primary-dark)' }}>
            {secsLeft > 0 ? `Expires in ${Math.floor(secsLeft / 60)}:${String(secsLeft % 60).padStart(2, '0')}` : 'This offer has expired — refreshing…'}
          </div>
        ) : null}
        {status === 'assigned' && primary ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <button className="tech-btn outline" disabled={busy !== null} onClick={() => { setText(''); setModal('decline'); }}>Decline</button>
            <button className="tech-btn gold" disabled={busy !== null} onClick={() => act('primary', primary.fn, primary.ok)}>{busy === 'primary' ? '…' : primary.label}</button>
          </div>
        ) : primary ? (
          <button className="tech-btn gold" disabled={busy !== null}
            onClick={() => primary.fn ? act('primary', primary.fn, primary.ok) : setModal('done')}>{busy === 'primary' ? '…' : primary.label}</button>
        ) : null}
        {(status === 'serving' || status === 'nearly_finished') ? (
          <button className="tech-btn outline" disabled={busy !== null} onClick={() => act('pause', () => techApi.pauseService(ticketId), 'Service paused.')}>{busy === 'pause' ? 'Pausing…' : 'Pause Service'}</button>
        ) : null}
        <button className="tech-btn outline" onClick={() => { setText(''); setVis('internal'); setModal('note'); }}>Add Note</button>
        {['accepted', 'serving', 'paused', 'nearly_finished'].includes(status) ? (
          <button className="tech-btn outline" onClick={() => { setChgLine(null); setSvcSearch(''); setSvcCat('All');
            techApi.editOptions(ticketId).then((o) => { setEdit(o); setModal('edit'); }).catch((e: any) => setNote(e?.message || 'Could not load edit options.')); }}>Edit Ticket</button>
        ) : null}
        {status !== 'done' && status !== 'cancelled' ? <button className="tech-btn danger-outline" onClick={() => { setText(''); setModal('cancel'); }}>Cancel Ticket</button> : null}
      </div>

      {/* modals */}
      {modal ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 12, 8, 0.55)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 100,
            padding: '16px',
            boxSizing: 'border-box',
          }}
          onClick={() => setModal(null)}
        >
          <div
            className="tech-card"
            style={{
              background: '#FFFFFF',
              width: '100%',
              maxWidth: modal === 'edit' ? 520 : 420,
              borderRadius: 24,
              margin: 0,
              padding: '24px 22px',
              boxShadow: '0 24px 60px -12px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(0, 0, 0, 0.05)',
              boxSizing: 'border-box',
              maxHeight: '88vh',
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {modal === 'done' ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(212, 175, 55, 0.15)', color: '#B89028', display: 'grid', placeItems: 'center', fontSize: 18 }}>
                      ✨
                    </span>
                    <div>
                      <div className="tech-section-title" style={{ fontSize: 18, margin: 0 }}>Complete this service?</div>
                      <div className="tech-muted" style={{ fontSize: 12 }}>Sends ticket to front-desk checkout</div>
                    </div>
                  </div>
                  <button
                    className="tech-iconbtn"
                    onClick={() => setModal(null)}
                    aria-label="Close modal"
                    style={{ border: 'none', background: '#F5F2EA', borderRadius: '50%', width: 32, height: 32, display: 'grid', placeItems: 'center', cursor: 'pointer' }}
                  >
                    ✕
                  </button>
                </div>

                <div className="tech-muted" style={{ fontSize: 13, marginBottom: 14, lineHeight: 1.45 }}>
                  Confirm all assigned services are finished. This sends the ticket to checkout.
                </div>

                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Final notes (optional)"
                  style={{
                    width: '100%',
                    minHeight: 80,
                    padding: 12,
                    borderRadius: 14,
                    border: '1.5px solid var(--tech-border, #E8E2D6)',
                    background: '#FAFAF8',
                    fontFamily: 'inherit',
                    fontSize: 13.5,
                    boxSizing: 'border-box',
                    outline: 'none',
                    resize: 'none',
                  }}
                />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 16 }}>
                  <button
                    type="button"
                    className="tech-btn outline"
                    style={{ borderRadius: 14, height: 44, margin: 0, fontWeight: 700 }}
                    onClick={() => setModal(null)}
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    className="tech-btn gold"
                    style={{ borderRadius: 14, height: 44, margin: 0, fontWeight: 700 }}
                    disabled={busy !== null}
                    onClick={() => act('done', () => techApi.serviceDone(ticketId, text || undefined), 'Service completed.')}
                  >
                    {busy === 'done' ? 'Finishing…' : 'Confirm Service Done'}
                  </button>
                </div>
              </>
            ) : modal === 'edit' ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div className="t-title" style={{ fontSize: 20, margin: 0 }}>Edit Live Ticket</div>
                  <button
                    className="tech-iconbtn"
                    onClick={() => setModal(null)}
                    aria-label="Close modal"
                    style={{ border: 'none', background: '#F5F2EA', borderRadius: '50%', width: 32, height: 32, display: 'grid', placeItems: 'center', cursor: 'pointer' }}
                  >
                    ✕
                  </button>
                </div>

                {!edit ? (
                  <div className="tech-muted" style={{ padding: '20px 0', textAlign: 'center' }}>Loading…</div>
                ) : !edit.editable ? (
                  <div className="tech-muted" style={{ fontSize: 13.5, lineHeight: 1.5, padding: '12px 0' }}>{edit.lockedReason}</div>
                ) : (
                  <div style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: 4 }}>
                    {edit.pendingChangeRequests?.length ? (
                      <div className="tech-card" style={{ marginBottom: 12, background: '#FFF8EA', border: '1px solid #FFE4A0', padding: 12, borderRadius: 14 }}>
                        <div className="tech-label" style={{ color: '#926200', fontWeight: 700 }}>Pending manager approval</div>
                        {edit.pendingChangeRequests.map((r) => (
                          <div key={r.id} className="tech-muted" style={{ fontSize: 12.5, padding: '3px 0' }}>
                            {r.requestType === 'remove_line' ? 'Remove' : 'Change'} {r.oldValue?.serviceName || ''}{r.newValue?.serviceName ? ` → ${r.newValue.serviceName}` : ''} · pending
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <div className="tech-label" style={{ margin: '4px 0 8px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Services on this ticket</div>
                    {services.map((l) => (
                      <div key={l.id} style={{ borderBottom: '1px solid var(--tech-border, #EFECE6)', padding: '10px 0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 14 }}>
                              {l.name} <span className="tech-muted" style={{ fontWeight: 500, fontSize: 13 }}>· {money2(l.priceCents)}</span>
                            </div>
                            <div className="tech-muted" style={{ fontSize: 12, marginTop: 2 }}>{l.status === 'done' ? 'Completed' : 'In progress'}</div>
                          </div>
                          {l.status !== 'done' ? (
                            <button className="tech-btn ghost" style={{ minWidth: 56, height: 32, padding: '0 10px', fontSize: 12.5 }} disabled={busy !== null} onClick={() => runEdit(() => techApi.patchLine(ticketId, l.id, { status: 'done' }), 'Marked done.')}>
                              Done
                            </button>
                          ) : null}
                          {edit.can?.changeService ? (
                            <button className="tech-btn ghost" style={{ minWidth: 62, height: 32, padding: '0 10px', fontSize: 12.5 }} onClick={() => { setChgLine(chgLine === l.id ? null : l.id); setChgNew(''); setChgReason(''); }}>
                              {chgLine === l.id ? 'Close' : 'Change'}
                            </button>
                          ) : null}
                          {edit.can?.removeLine ? (
                            <button className="tech-btn danger-outline" style={{ minWidth: 66, height: 32, padding: '0 10px', fontSize: 12.5 }} disabled={busy !== null} onClick={() => runEdit(() => techApi.removeLine(ticketId, l.id), 'Service removed.')}>
                              Remove
                            </button>
                          ) : null}
                        </div>
                        {chgLine === l.id ? (
                          <div style={{ marginTop: 10, display: 'grid', gap: 8, padding: 10, background: '#F8F6F2', borderRadius: 12 }}>
                            <select className="tech-input" value={chgNew} onChange={(e) => setChgNew(e.target.value)} aria-label="New service" style={{ height: 38, fontSize: 13 }}>
                              <option value="">Select new service…</option>
                              {edit.services.filter((sv) => sv.name !== l.name).map((sv) => <option key={sv.serviceId} value={sv.serviceId}>{sv.name} — {money2(sv.priceCents)}</option>)}
                            </select>
                            <input className="tech-input" placeholder="Reason for change" value={chgReason} onChange={(e) => setChgReason(e.target.value)} style={{ height: 38, fontSize: 13 }} />
                            <button className="tech-btn gold" style={{ height: 38, fontSize: 13, fontWeight: 700 }} disabled={!chgNew || busy !== null} onClick={() => runEdit(() => techApi.changeService(ticketId, l.id, chgNew, chgReason || undefined), 'Service updated.')}>Update Service</button>
                          </div>
                        ) : null}
                      </div>
                    ))}

                    {edit.can?.addService ? (
                      <>
                        <div className="tech-label" style={{ margin: '16px 0 8px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Add Service</div>
                        <input className="tech-input" placeholder="🔍 Search service…" value={svcSearch} onChange={(e) => setSvcSearch(e.target.value)} style={{ marginBottom: 10, height: 40, borderRadius: 12 }} />
                        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8 }}>
                          {['All', ...edit.categories].map((c: string) => (
                            <button key={c} className={'tech-chip' + (svcCat === c ? ' active' : '')} onClick={() => setSvcCat(c)}>{c}</button>
                          ))}
                        </div>
                        {edit.services
                          .filter((sv) => (svcCat === 'All' || sv.categoryName === svcCat) && (!svcSearch || sv.name.toLowerCase().includes(svcSearch.toLowerCase())))
                          .slice(0, 30)
                          .map((sv) => (
                            <div key={sv.serviceId} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 48, borderBottom: '1px solid var(--tech-border, #EFECE6)', padding: '6px 0' }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{sv.name}</div>
                                <div className="tech-muted" style={{ fontSize: 12, marginTop: 2 }}>{money2(sv.priceCents)} · {sv.durationMinutes} min{sv.isAddOn ? ' · add-on' : ''}</div>
                              </div>
                              <button className="tech-btn ghost" style={{ minWidth: 92, height: 32, fontSize: 12, padding: '0 8px' }} disabled={busy !== null} onClick={() => runEdit(() => techApi.addServiceLine(ticketId, { serviceId: sv.serviceId }), 'Service added to ticket.')}>+ Add</button>
                            </div>
                          ))}
                      </>
                    ) : null}
                  </div>
                )}

                <button className="tech-btn outline" style={{ marginTop: 14, borderRadius: 14, height: 42, fontWeight: 700 }} onClick={() => setModal(null)}>Close</button>
              </>
            ) : modal === 'note' ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(59, 130, 246, 0.12)', color: '#2563EB', display: 'grid', placeItems: 'center', fontSize: 18 }}>
                      📝
                    </span>
                    <div className="tech-section-title" style={{ fontSize: 18, margin: 0 }}>Add Note</div>
                  </div>
                  <button
                    className="tech-iconbtn"
                    onClick={() => setModal(null)}
                    aria-label="Close modal"
                    style={{ border: 'none', background: '#F5F2EA', borderRadius: '50%', width: 32, height: 32, display: 'grid', placeItems: 'center', cursor: 'pointer' }}
                  >
                    ✕
                  </button>
                </div>

                <div className="tech-seg" style={{ marginBottom: 14, padding: 3, background: '#F0ECE4', borderRadius: 12 }}>
                  <button className={vis === 'internal' ? 'sel' : ''} onClick={() => setVis('internal')} style={{ borderRadius: 10, fontWeight: 600 }}>Internal</button>
                  <button className={vis === 'customer' ? 'sel' : ''} onClick={() => setVis('customer')} style={{ borderRadius: 10, fontWeight: 600 }}>Customer-visible</button>
                </div>

                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Note (color/design, product used, result…)"
                  style={{
                    width: '100%',
                    minHeight: 90,
                    padding: 12,
                    borderRadius: 14,
                    border: '1.5px solid var(--tech-border, #E8E2D6)',
                    background: '#FAFAF8',
                    fontFamily: 'inherit',
                    fontSize: 13.5,
                    boxSizing: 'border-box',
                    outline: 'none',
                    resize: 'none',
                  }}
                />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 16 }}>
                  <button
                    type="button"
                    className="tech-btn outline"
                    style={{ borderRadius: 14, height: 44, margin: 0, fontWeight: 700 }}
                    onClick={() => setModal(null)}
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    className="tech-btn gold"
                    style={{ borderRadius: 14, height: 44, margin: 0, fontWeight: 700 }}
                    disabled={busy !== null || !text.trim()}
                    onClick={() => act('note', () => techApi.addNote(ticketId, text.trim(), vis), 'Note added.')}
                  >
                    {busy === 'note' ? 'Saving…' : 'Save Note'}
                  </button>
                </div>
              </>
            ) : modal === 'decline' ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(239, 68, 68, 0.12)', color: '#DC2626', display: 'grid', placeItems: 'center', fontSize: 18 }}>
                      ⚠️
                    </span>
                    <div>
                      <div className="tech-section-title" style={{ fontSize: 18, margin: 0 }}>Decline this assignment?</div>
                      <div className="tech-muted" style={{ fontSize: 12 }}>Returns to front desk</div>
                    </div>
                  </div>
                  <button
                    className="tech-iconbtn"
                    onClick={() => setModal(null)}
                    aria-label="Close modal"
                    style={{ border: 'none', background: '#F5F2EA', borderRadius: '50%', width: 32, height: 32, display: 'grid', placeItems: 'center', cursor: 'pointer' }}
                  >
                    ✕
                  </button>
                </div>

                <div className="tech-muted" style={{ fontSize: 13, marginBottom: 14, lineHeight: 1.45 }}>
                  The customer goes back to the front desk to be reassigned. A reason is required.
                </div>

                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Reason (e.g. running late, not my specialty)"
                  style={{
                    width: '100%',
                    minHeight: 80,
                    padding: 12,
                    borderRadius: 14,
                    border: '1.5px solid var(--tech-border, #E8E2D6)',
                    background: '#FAFAF8',
                    fontFamily: 'inherit',
                    fontSize: 13.5,
                    boxSizing: 'border-box',
                    outline: 'none',
                    resize: 'none',
                  }}
                />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 16 }}>
                  <button
                    type="button"
                    className="tech-btn outline"
                    style={{ borderRadius: 14, height: 44, margin: 0, fontWeight: 700 }}
                    onClick={() => setModal(null)}
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    className="tech-btn danger-outline"
                    style={{ borderRadius: 14, height: 44, margin: 0, fontWeight: 700 }}
                    disabled={busy !== null || !text.trim()}
                    onClick={() => act('decline', () => techApi.decline(ticketId, text.trim()), 'Assignment declined — sent back to the front desk.')}
                  >
                    {busy === 'decline' ? 'Declining…' : 'Confirm Decline'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(239, 68, 68, 0.12)', color: '#DC2626', display: 'grid', placeItems: 'center', fontSize: 18 }}>
                      ✕
                    </span>
                    <div>
                      <div className="tech-section-title" style={{ fontSize: 18, margin: 0 }}>Request cancellation</div>
                      <div className="tech-muted" style={{ fontSize: 12 }}>Sent to front desk</div>
                    </div>
                  </div>
                  <button
                    className="tech-iconbtn"
                    onClick={() => setModal(null)}
                    aria-label="Close modal"
                    style={{ border: 'none', background: '#F5F2EA', borderRadius: '50%', width: 32, height: 32, display: 'grid', placeItems: 'center', cursor: 'pointer' }}
                  >
                    ✕
                  </button>
                </div>

                <div className="tech-muted" style={{ fontSize: 13, marginBottom: 14, lineHeight: 1.45 }}>
                  Technicians can’t cancel directly — this sends a request to the front desk.
                </div>

                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Reason"
                  style={{
                    width: '100%',
                    minHeight: 80,
                    padding: 12,
                    borderRadius: 14,
                    border: '1.5px solid var(--tech-border, #E8E2D6)',
                    background: '#FAFAF8',
                    fontFamily: 'inherit',
                    fontSize: 13.5,
                    boxSizing: 'border-box',
                    outline: 'none',
                    resize: 'none',
                  }}
                />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 16 }}>
                  <button
                    type="button"
                    className="tech-btn outline"
                    style={{ borderRadius: 14, height: 44, margin: 0, fontWeight: 700 }}
                    onClick={() => setModal(null)}
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    className="tech-btn danger-outline"
                    style={{ borderRadius: 14, height: 44, margin: 0, fontWeight: 700 }}
                    disabled={busy !== null || !text.trim()}
                    onClick={() => act('cancel', () => techApi.requestCancel(ticketId, text.trim()), 'Cancellation request sent to the front desk.')}
                  >
                    {busy === 'cancel' ? 'Sending…' : 'Send Request'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
      </div>
    </div>
  );
}
