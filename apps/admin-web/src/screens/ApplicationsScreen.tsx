// ApplicationsScreen.tsx — Tenant Applications queue (Free POS Package intake). Website submissions land here with a
// public APS reference, consent evidence, and duplicate-risk findings. The full review lifecycle (assign, priority,
// follow-up, contact log, qualify, approve-with-note, reject-with-reason, duplicate/spam, archive) drives the REAL
// transition-enforced endpoints; Approve requires a note (spec) and the backend auto-opens the hardware package.
// EIN is masked; Reveal calls the audited, permission-gated endpoint. Convert to Tenant remains the deliberate
// manual flow (create the tenant via the existing Create Tenant flow, then paste the id — no duplicate path).
import { useEffect, useState } from 'react';
import { useEventCallback } from '@aipowersalon/ui';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { superAdminApi } from '../api/superAdminApi';

const TABS = ['new', 'under_review', 'contacted', 'awaiting_applicant', 'qualified', 'approved', 'rejected', 'duplicate', 'spam', 'converted', 'archived'];
const label = (s: string) => String(s || '').replace(/_/g, ' ');
const money = (c?: number | string | null) => c == null ? '—' : '$' + (Number(c) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 });

export function ApplicationsScreen() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const fromDashboard = params.get('source') === 'tenants-salons-dashboard';
  const [tab, setTab] = useState<string>(params.get('status') && TABS.includes(params.get('status')!) ? params.get('status')! : '');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any | null>(null);
  const [total, setTotal] = useState(0);
  const [openId, setOpenId] = useState<string | null>(params.get('focus'));
  const [note, setNote] = useState('');
  const [approveNote, setApproveNote] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [reviewerId, setReviewerId] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [contactChannel, setContactChannel] = useState('phone');
  const [contactNote, setContactNote] = useState('');
  const [convertTenantId, setConvertTenantId] = useState('');
  const [ein, setEin] = useState<{ ein: string | null; last4: string | null; reason?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useEventCallback(() => {
    setLoading(true);
    superAdminApi.applications({ pageSize: 100, ...(tab ? { status: tab } : {}), ...(search.trim() ? { search: search.trim() } : {}) })
      .then((r: any) => { setRows(r.rows || []); setTotal(r.total || 0); setErr(null); })
      .catch((e: any) => setErr(e?.message || 'Failed to load applications.'))
      .finally(() => setLoading(false));
  });
  useEffect(() => { const t = setTimeout(load, search ? 250 : 0); return () => clearTimeout(t); }, [tab, search, load]);
  const mayMetrics = useCan()('super_admin.applications.view');
  useEffect(() => { if (!mayMetrics) return; Promise.resolve().then(() => superAdminApi.applicationMetrics()).then((m) => setMetrics(m || null)).catch(() => setMetrics(null)); }, [mayMetrics]);

  const act = async (key: string, fn: () => Promise<any>) => {
    setBusy(key); setErr(null);
    try { await fn(); load(); } catch (e: any) { setErr(e?.message || 'Action failed.'); } finally { setBusy(null); }
  };
  const openRow = (id: string | null) => { setOpenId(id); setNote(''); setApproveNote(''); setRejectReason(''); setReviewerId(''); setFollowUp(''); setContactNote(''); setConvertTenantId(''); setEin(null); };
  const dupReasons = (a: any): string[] => { try { const v = typeof a.duplicate_reasons === 'string' ? JSON.parse(a.duplicate_reasons) : a.duplicate_reasons; return Array.isArray(v) ? v : []; } catch { return []; } };
  const CLOSED = ['approved', 'rejected', 'converted', 'converted_tenant', 'converted_onboarding', 'archived'];

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', overflowY: 'auto' }}>
      <div className="vh flex flex-col lg:flex-row justify-between gap-3">
        <div>
          <h1 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 24, fontWeight: 700, color: 'var(--text)', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            Tenant Applications
          </h1>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
            Review and manage new salon onboarding applications · {total} total{fromDashboard ? ' · from Tenants / Salons' : ''}
          </div>
        </div>
        <input
          placeholder="Search salon, applicant, email, phone, city…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inp(280), boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.02)' }}
        />
      </div>
      {metrics ? (
        <div className=" grid  grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 mb-3 mt-3">
          {[
            ['Received (30d)', metrics.received30],
            ['Open review', metrics.open],
            ['Approved', metrics.approved],
            ['Rejected', metrics.rejected],
            ['Dup-flagged', metrics.duplicatesFlagged],
            ['Follow-ups overdue', metrics.followUpsOverdue],
            ['Conversion', metrics.conversionRatePct == null ? '—' : `${metrics.conversionRatePct}%`],
            ['Avg approval', metrics.avgApprovalHours == null ? '—' : `${metrics.avgApprovalHours}h`],
            ['Avg first response', metrics.avgFirstResponseHours == null ? '—' : `${metrics.avgFirstResponseHours}h`],
          ].map(([k, v]) => (
            <div key={String(k)} style={{ ...limCard(), minWidth: 108, flex: '1 1 auto' }}>
              <div className="muted" style={{ fontSize: 11 }}>{k}</div>
              <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--text)', marginTop: 4 }}>{v ?? '—'}</div>
            </div>
          ))}
          {metrics.bySource?.length ? <div className="muted" style={{ fontSize: 11, alignSelf: 'flex-end', marginLeft: 'auto', paddingBottom: 4 }}>Top source: {metrics.bySource[0].key} ({metrics.bySource[0].count})</div> : null}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: '1px solid var(--line)', paddingBottom: 10 }}>
        <button style={btn(false, tab === '')} onClick={() => setTab('')}>All</button>
        {TABS.map((s) => <button key={s} style={btn(false, tab === s)} onClick={() => setTab(s)}>{label(s)}</button>)}
      </div>
      {err ? <div className="inline-note error " role="alert" style={{ background: '#FBEAEA', border: '1px solid #F0C9C9', padding: '10px 14px', borderRadius: 10, fontSize: 13, color: '#9B2C2C' }}>{err}</div> : null}
      {loading ? <div className="loading" style={{ padding: 24, fontSize: 13, color: 'var(--muted)' }}>Loading…</div> : rows.length === 0 ? <div className="muted" style={{ padding: 24, fontSize: 13 }}>No applications{tab ? ` with status "${label(tab)}"` : ''} yet. New website applications will appear here.</div> : (
        <section className="panel min-h-[80px]" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 0, overflow: 'hidden', boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="min-w-[900px]" style={tbl()}>
              <tbody>
                {rows.map((a) => (
                  <React.Fragment key={a.id}>
                    <tr>
                      <td style={td()}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
                          {a.salon_name} <span className="muted" style={{ fontWeight: 400 }}>· {a.owner_name}</span>
                          {a.reference_number ? <span className="muted" style={{ fontWeight: 400 }}> · {a.reference_number}</span> : null}
                          {Number(a.duplicate_risk_score) > 0 ? <span style={{ ...badgeStyle('#FBEED2', '#8a5a00', '#F2DBA6'), marginLeft: 8 }}>dup risk {a.duplicate_risk_score}</span> : null}
                        </div>
                        <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                          {[a.city, a.state].filter(Boolean).join(', ')} · {a.phone || '—'} · {a.email || '—'} · {a.technicians_count ?? '—'} techs{a.locations_count != null ? ` · ${a.locations_count} loc` : ''} · {a.card_volume_band || money(a.monthly_card_volume_cents) + '/mo'}
                          {a.priority ? ` · ${a.priority}` : ''}{a.follow_up_at ? ` · follow-up ${new Date(a.follow_up_at).toLocaleDateString()}` : ''}{a.source ? ` · via ${a.source}` : ''}
                        </div>
                      </td>
                      <td style={{ ...td(), textAlign: 'right' }}>
                        <span style={badgeStyle('#FFF9EF', '#8B5A18', 'var(--line)')}>{label(a.status)}</span>
                      </td>
                      <td style={{ ...td(), width: 80, textAlign: 'right' }}>
                        <button style={btn(false, false)} onClick={() => openRow(openId === a.id ? null : a.id)}>{openId === a.id ? 'Close' : 'Open'}</button>
                      </td>
                    </tr>
                    {openId === a.id && (
                      <tr>
                        <td colSpan={3} style={{ padding: '16px 20px', background: '#FAFAFA', borderBottom: '1px solid var(--cream2)' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {dupReasons(a).length > 0 ? (
                              <div style={{ padding: '10px 14px', border: '1px solid #E5C878', borderRadius: 10, background: '#FBF3DE', fontSize: 12, color: '#7A5210' }}>
                                <b style={{ display: 'block', marginBottom: 4 }}>Risk findings — review before approving:</b>
                                {dupReasons(a).map((r, i) => <div key={i}>• {r}</div>)}
                              </div>
                            ) : null}
                            <div style={{ fontSize: 12.5, color: 'var(--text)' }}>
                              {[a.address, a.zip].filter(Boolean).join(' · ') || null}
                              {a.referral_source ? <div style={{ marginTop: 2 }}>Heard about us: {a.referral_source}</div> : null}
                              {a.best_contact_time || a.preferred_contact_method ? <div style={{ marginTop: 2 }}>Contact: {[a.preferred_contact_method, a.best_contact_time].filter(Boolean).join(' · ')}</div> : null}
                              {a.applicant_message ? <div style={{ whiteSpace: 'pre-line', marginTop: 8, padding: '8px 12px', background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 8 }}>Message: {a.applicant_message}</div> : null}
                              {a.consent_given ? <div className="muted" style={{ marginTop: 4 }}>Consent recorded{a.consent_at ? ` ${new Date(a.consent_at).toLocaleString()}` : ''}{a.ip_address ? ` · IP ${a.ip_address}` : ''}</div> : null}
                              {a.ein_last4 ? (
                                <div style={{ marginTop: 8 }}>EIN: {ein?.ein ? <b>{ein.ein}</b> : `••-•••${a.ein_last4}`} {ein?.reason ? <span className="muted">({ein.reason})</span> : null}
                                  {!ein ? <button style={{ ...btn(busy === 'ein', false), marginLeft: 8 }} disabled={busy === 'ein'} onClick={() => act('ein', () => superAdminApi.applicationEin(a.id).then((r: any) => setEin(r)))}>Reveal EIN</button> : null}
                                  {ein ? <span className="muted" style={{ marginLeft: 6 }}>· reveal audited</span> : null}
                                </div>
                              ) : null}
                            </div>
                            
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              {!CLOSED.includes(a.status) && a.status !== 'under_review' && <button style={btn(!!busy, false)} disabled={!!busy} onClick={() => act('st', () => superAdminApi.applicationStatus(a.id, 'under_review'))}>Under Review</button>}
                              {!CLOSED.includes(a.status) && a.status !== 'awaiting_applicant' && <button style={btn(!!busy, false)} disabled={!!busy} onClick={() => act('st', () => superAdminApi.applicationStatus(a.id, 'awaiting_applicant'))}>Awaiting Applicant</button>}
                              {!CLOSED.includes(a.status) && a.status !== 'qualified' && <button style={btn(!!busy, false)} disabled={!!busy} onClick={() => act('st', () => superAdminApi.applicationStatus(a.id, 'qualified'))}>Mark Qualified</button>}
                              {!CLOSED.includes(a.status) && <button style={btn(!!busy, false)} disabled={!!busy} onClick={() => act('dup', () => superAdminApi.applicationDuplicate(a.id))}>Duplicate</button>}
                              {!CLOSED.includes(a.status) && <button style={btn(!!busy, false)} disabled={!!busy} onClick={() => act('spam', () => superAdminApi.applicationSpam(a.id))}>Spam</button>}
                              {a.status !== 'archived' && <button style={btn(!!busy, false)} disabled={!!busy} onClick={() => act('arch', () => superAdminApi.applicationArchive(a.id))}>Archive</button>}
                            </div>
                            
                            {!CLOSED.includes(a.status) ? (
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', background: '#FFFDF8', padding: 10, border: '1px solid var(--line)', borderRadius: 10 }}>
                                <input placeholder="Approval note (required)" value={approveNote} onChange={(e) => setApproveNote(e.target.value)} style={{ ...inp(), flex: 1, minWidth: 200 }} />
                                <button style={btn(approveNote.trim().length < 3 || !!busy, true)} disabled={approveNote.trim().length < 3 || !!busy} onClick={() => act('appr', () => superAdminApi.applicationApprove(a.id, approveNote.trim()))}>Approve Package</button>
                                <div style={{ width: 1, height: 24, background: 'var(--line)', margin: '0 4px' }} />
                                <input placeholder="Rejection reason (required)" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} style={{ ...inp(), flex: 1, minWidth: 200 }} />
                                <button style={btn(rejectReason.trim().length < 3 || !!busy, false)} disabled={rejectReason.trim().length < 3 || !!busy} onClick={() => act('rej', () => superAdminApi.applicationReject(a.id, rejectReason.trim()))}>Reject</button>
                              </div>
                            ) : null}
                            
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                              <input placeholder="Reviewer user id" value={reviewerId} onChange={(e) => setReviewerId(e.target.value)} style={{ ...inp(170) }} />
                              <button style={btn(!reviewerId.trim() || !!busy, false)} disabled={!reviewerId.trim() || !!busy} onClick={() => act('asg', () => superAdminApi.applicationAssign(a.id, reviewerId.trim()))}>Assign</button>
                              <select value={a.priority || ''} disabled={!!busy} onChange={(e) => act('pri', () => superAdminApi.applicationPriority(a.id, e.target.value))} style={inp()}>
                                <option value="" disabled>Priority…</option>
                                {['low', 'normal', 'high', 'urgent'].map((p) => <option key={p} value={p}>{p}</option>)}
                              </select>
                              <input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} style={inp()} />
                              <button style={btn(!followUp || !!busy, false)} disabled={!followUp || !!busy} onClick={() => act('fup', () => superAdminApi.applicationFollowUp(a.id, followUp))}>Set Follow-up</button>
                            </div>
                            
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                              <select value={contactChannel} onChange={(e) => setContactChannel(e.target.value)} style={inp()}>
                                {['phone', 'sms', 'email'].map((c) => <option key={c} value={c}>{c}</option>)}
                              </select>
                              <input placeholder="What happened on the call/text/email…" value={contactNote} onChange={(e) => setContactNote(e.target.value)} style={{ ...inp(), flex: 1, minWidth: 200 }} />
                              <button style={btn(!!busy, false)} disabled={!!busy} onClick={() => act('log', () => superAdminApi.applicationContactLog(a.id, contactChannel, contactNote.trim() || undefined).then(() => setContactNote('')))}>Log Contact</button>
                            </div>
                            
                            {a.status === 'approved' && !a.onboarding_id ? (
                              <div style={{ display: 'flex', gap: 12, alignItems: 'center', background: '#FFF9EF', padding: '12px 16px', border: '1px solid #E2C686', borderRadius: 10 }}>
                                <button style={btn(!!busy, true)} disabled={!!busy} onClick={() => act('ob', () => superAdminApi.applicationConvertToOnboarding(a.id))}>Start Onboarding</button>
                                <span className="muted" style={{ fontSize: 11.5 }}>Opens the 14-stage onboarding case; the application stays as the source record.</span>
                              </div>
                            ) : null}
                            
                            {a.onboarding_id ? <div style={{ fontSize: 12.5 }}>Onboarding case: <b>{a.onboarding_id}</b></div> : null}
                            
                            {a.status === 'approved' ? (
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                <button style={btn(false, false)} onClick={() => nav('/tenants?create=1')}>1. Create the tenant →</button>
                                <input placeholder="2. Paste the new tenant id" value={convertTenantId} onChange={(e) => setConvertTenantId(e.target.value)} style={{ ...inp(), flex: 1, minWidth: 240 }} />
                                <button style={btn(!convertTenantId || !!busy, true)} disabled={!convertTenantId || !!busy} onClick={() => act('conv', () => superAdminApi.applicationConverted(a.id, convertTenantId.trim()))}>Mark Converted</button>
                              </div>
                            ) : null}
                            
                            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                              <input placeholder="Add a note…" value={note} onChange={(e) => setNote(e.target.value)} style={{ ...inp(), flex: 1, minWidth: 240 }} />
                              <button style={btn(!note.trim() || !!busy, false)} disabled={!note.trim() || !!busy} onClick={() => act('note', () => superAdminApi.applicationNote(a.id, note.trim()).then(() => setNote('')))}>Add Note</button>
                            </div>
                            
                            {(Array.isArray(a.notes) ? a.notes : []).length > 0 ? (
                              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {(a.notes as any[]).map((n, i) => (
                                  <div key={i} style={{ padding: '8px 12px', background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }}>
                                    <div style={{ whiteSpace: 'pre-line', color: 'var(--text)' }}>{n.text}</div>
                                    <div className="muted" style={{ marginTop: 4, fontSize: 11 }}>— {n.by || 'admin'}{n.at ? `, ${new Date(n.at).toLocaleString()}` : ''}</div>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                            
                            {a.converted_tenant_id ? <div style={{ marginTop: 4, fontSize: 12.5 }}>Converted tenant: <b>{a.converted_tenant_id}</b></div> : null}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {total > rows.length ? <div className="muted" style={{ padding: '12px 16px', fontSize: 12, borderTop: '1px solid var(--line)', background: '#FAFAFA' }}>Showing first {rows.length} of {total}. Use search or the status filters to narrow the queue.</div> : null}
        </section>
      )}
    </div>
  );
}

// inline cream/gold style helpers
import React from 'react';
import { useCan } from '../auth/useCan';

function btn(disabled = false, primary = false) {
  return {
    height: 34, padding: '0 12px', borderRadius: 9, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
    border: '1px solid ' + (primary ? 'var(--g7)' : 'var(--line)'),
    background: disabled ? '#F3EDE3' : primary ? 'var(--g7)' : '#FFFDF8',
    color: disabled ? 'var(--muted)' : primary ? '#fff' : 'var(--text)', opacity: disabled ? 0.85 : 1,
  };
}
const inp = (w?: number) => ({ height: 32, width: w || 'auto', border: '1px solid var(--line)', borderRadius: 9, background: '#FFFDF8', padding: '0 10px', fontFamily: 'inherit', fontSize: 12 });
const tbl = () => ({ width: '100%', borderCollapse: 'collapse', fontSize: 12 } as any);
const td = () => ({ padding: '10px 16px', borderBottom: '1px solid var(--cream2)', verticalAlign: 'middle' } as any);
const limCard = () => ({ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', background: '#FFFDF8', boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)' });
const badgeStyle = (bg: string, fg: string, bd: string) => ({ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 600, background: bg, color: fg, border: '1px solid ' + bd });
