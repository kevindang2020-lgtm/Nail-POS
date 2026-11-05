// TechnicianWorkforcePanel.tsx — the manager's workforce view of ONE technician inside the profile drawer (merge Oct 12
// 2026; the other chat's Technician Profile phase 3 on OUR routes + vocabulary). Every status is shown SEPARATELY,
// because they mean different things:
//   employment (works here?) · clock (punched in?) · shift (scheduled now?) · queue (can take a walk-in?) · service
// plus the manual "not taking customers" toggle, time off (requests to approve, entries on her behalf) and
// certifications (verify / revoke — verification feeds service eligibility). No native dialogs: reasons are collected
// with the inline ask bar. Errors show inline; data stays on screen while it refreshes.
import { useCallback, useEffect, useState } from 'react';
import { useInlineAsk } from '@aipowersalon/ui';
import { posWorkforceApi, type TechCertificationView, type TimeOffKind, type TimeOffEntry, type TechnicianWorkforceStateView } from '../api/posWorkforceApi';
import { useRealtime } from '../realtime/useRealtime';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { codeLabel } from './codeLabel';
import { fmtInZone } from '../i18n/format';

// a workforce code (employment / clock / shift / queue / time-off / certification) → its label, read at render
// (admin.workforce.<code>; codes stay the authority — compared and coloured as before)
export const workforceLabel = (v: string | null | undefined) => (v ? codeLabel('admin.workforce', v, ['teamMember', 'turnBoard']) : '—');
const fmtDate = (iso: string | null | undefined) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d.getTime()) ? '—' : fmtInZone(d, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const h3: React.CSSProperties = { margin: '28px 0 12px', fontSize: 13, color: '#B5821F', letterSpacing: '0.06em', fontWeight: 800, textTransform: 'uppercase' };
const chip = (tone: 'ok' | 'warn' | 'bad' | 'muted'): React.CSSProperties => ({
  display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 12,
  background: tone === 'ok' ? '#EEF7EF' : tone === 'warn' ? '#FFF4E5' : tone === 'bad' ? '#FDF0EE' : '#F8F6F3',
  color: tone === 'ok' ? '#2E7D32' : tone === 'warn' ? '#C26A12' : tone === 'bad' ? '#C0392B' : '#8A7A6D',
});
const ipt: React.CSSProperties = { border: '1px solid #EFEAE1', borderRadius: 8, padding: '6px 10px', fontSize: 12.5, font: 'inherit' };
const toneFor = (v: string) => (['active', 'CLOCKED_IN', 'ON_SHIFT', 'AVAILABLE', 'approved', 'VERIFIED'].includes(v) ? 'ok'
  : ['ON_BREAK', 'BREAK', 'ASSIGNED', 'SERVING', 'PAUSED', 'pending', 'UNVERIFIED'].includes(v) ? 'warn'
  : ['suspended', 'UNAVAILABLE', 'rejected', 'REVOKED', 'EXPIRED'].includes(v) ? 'bad' : 'muted');
const KINDS: TimeOffKind[] = ['VACATION', 'SICK', 'PERSONAL', 'UNAVAILABLE'];

export function TechnicianWorkforcePanel({ technicianId }: { technicianId: string }) {
  const [state, setState] = useState<TechnicianWorkforceStateView | null>(null);
  const [stateErr, setStateErr] = useState(false);
  const [timeOff, setTimeOff] = useState<TimeOffEntry[] | null>(null);
  const [certs, setCerts] = useState<TechCertificationView[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<{ start: string; end: string; kind: TimeOffKind; reason: string } | null>(null);
  const { ask, askUi } = useInlineAsk();

  const load = useCallback(() => Promise.all([
    posWorkforceApi.state(technicianId).then((s) => { setState(s); setStateErr(false); }).catch(() => setStateErr(true)),
    posWorkforceApi.timeOff(technicianId).then((r) => setTimeOff(Array.isArray(r) ? r : [])).catch(() => setTimeOff((p) => p ?? [])),
    posWorkforceApi.certifications(technicianId).then((r) => setCerts(Array.isArray(r) ? r : [])).catch(() => setCerts((p) => p ?? [])),
  ]), [technicianId]);
  useEffect(() => { void load(); }, [load]);
  useRealtime('technicians', load);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setErr(null);
    try { await fn(); await load(); } catch (e: any) { setErr(e?.message || tx('pos.action_failed')); } finally { setBusy(null); }
  };
  const saveTimeOff = () => {
    if (!form) return;
    if (!form.start || !form.end) { setErr(tx('pos.pick_a_start_and_an_end')); return; }
    const startsAt = new Date(form.start).toISOString(); const endsAt = new Date(form.end).toISOString();
    if (endsAt <= startsAt) { setErr(tx('pos.the_end_must_be_after_the_gl48')); return; }
    void act('to-new', () => posWorkforceApi.createTimeOff(technicianId, { startsAt, endsAt, kind: form.kind, ...(form.reason.trim() ? { reason: form.reason.trim() } : {}) }).then(() => setForm(null)));
  };

  const upcoming = (timeOff ?? []).filter((t) => t.status !== 'cancelled' && new Date(t.endsAt).getTime() >= Date.now() - 86_400_000);
  return (
    <section aria-label={tx('pos.workforce')}>
      {askUi}
      <h3 style={h3}>{tx('pos.status')}</h3>
      {err ? <div className="err" style={{ marginBottom: 8 }}>{err}</div> : null}
      {!state ? <div style={{ fontSize: 13, color: '#8A7A6D' }}>{stateErr ? tx('pos.live_status_is_unavailable_right_now') : tx('pos.loading')}</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 8 }}>
          {([[tx('admin.workforce.panel.employment'), state.employment], [tx('admin.workforce.panel.timeClock'), state.clock], [tx('admin.workforce.panel.shift'), state.shift], [tx('glossary.term.queue'), state.queue], [tx('glossary.term.service'), state.service]] as const).map(([k, v]) => (
            <div key={k} style={{ border: '1px solid #EFEAE1', borderRadius: 10, padding: '8px 10px', background: '#FAFAF9' }}>
              <div style={{ fontSize: 10.5, color: '#8A7A6D', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>{k}</div>
              <span style={{ ...chip(toneFor(v)), marginTop: 4 }}>{workforceLabel(v)}</span>
            </div>
          ))}
        </div>
      )}
      {state && state.employment === 'active' ? (
        <div style={{ marginTop: 10 }}>
          <button className="btn ghost" disabled={busy === 'unavail'} onClick={() => act('unavail', () => posWorkforceApi.setUnavailable(technicianId, !state.manualUnavailable))}>
            {state.manualUnavailable ? tx('pos.resume_taking_customers') : tx('pos.mark_not_taking_customers')}
          </button>
          <span style={{ fontSize: 11.5, color: '#8A7A6D', marginLeft: 8 }}>{tx('pos.clock_in_breaks_and_lunch_are_4ozq')}</span>
        </div>
      ) : null}

      <h3 style={h3}>{tx('pos.time_off')}</h3>
      {timeOff === null ? <div style={{ fontSize: 13, color: '#8A7A6D' }}>{tx('pos.loading')}</div> : upcoming.length === 0 ? <div style={{ fontSize: 13, color: '#8A7A6D' }}>{tx('pos.no_upcoming_time_off')}</div> : upcoming.map((t) => (
        <div key={t.id} style={{ border: '1px solid #EFEAE1', borderRadius: 10, padding: 10, marginBottom: 8, background: '#FAFAF9', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={chip(toneFor(t.status))}>{workforceLabel(t.status)}</span>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{workforceLabel(t.kind)}</span>
          <span style={{ fontSize: 12.5, color: '#2C2A29' }}>{fmtDate(t.startsAt)} → {fmtDate(t.endsAt)}</span>
          {t.reason ? <span style={{ fontSize: 12, color: '#8A7A6D' }}>· {t.reason}</span> : null}
          {t.status === 'pending' ? (
            <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
              <button className="btn" disabled={!!busy} onClick={() => act('to-' + t.id, () => posWorkforceApi.decideTimeOff(technicianId, t.id, 'approved'))}>{tx('pos.approve')}</button>
              <button className="btn ghost" disabled={!!busy} onClick={() => ask(tx('admin.workforce.askDeclineTimeOff'), (note) => { void act('to-' + t.id, () => posWorkforceApi.decideTimeOff(technicianId, t.id, 'rejected', note)); }, { confirmLabel: tx('pos.decline'), inputLabel: tx('admin.workforce.reason') })}>{tx('pos.decline')}</button>
            </span>
          ) : t.decisionNote ? <span style={{ fontSize: 12, color: '#8A7A6D' }}>· {t.decisionNote}</span> : null}
        </div>
      ))}
      {form ? (
        <div style={{ display: 'grid', gap: 8, border: '1px solid #EFEAE1', borderRadius: 10, padding: 10, background: '#fff' }} aria-label={tx('pos.add_time_off')}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input type="datetime-local" aria-label={tx('pos.time_off_start')} value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} style={ipt} />
            <input type="datetime-local" aria-label={tx('pos.time_off_end')} value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} style={ipt} />
            <select aria-label={tx('pos.time_off_kind')} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as TimeOffKind })} style={ipt}>
              {KINDS.map((k) => <option key={k} value={k}>{workforceLabel(k)}</option>)}
            </select>
          </div>
          <input placeholder={tx('pos.reason_optional')} aria-label={tx('pos.time_off_reason')} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} style={ipt} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" disabled={busy === 'to-new'} onClick={saveTimeOff}>{busy === 'to-new' ? tx('pos.saving_2') : tx('pos.save_time_off')}</button>
            <button className="btn ghost" onClick={() => setForm(null)}>{tx('pos.cancel')}</button>
          </div>
          <div style={{ fontSize: 11, color: '#8A7A6D' }}>{tx('pos.entered_by_a_manager_so_it_tpoe')}</div>
        </div>
      ) : <button className="btn ghost" onClick={() => setForm({ start: '', end: '', kind: 'VACATION', reason: '' })}>{tx('pos.add_time_off')}</button>}

      <h3 style={h3}>{tx('pos.certifications')}</h3>
      {certs === null ? <div style={{ fontSize: 13, color: '#8A7A6D' }}>{tx('pos.loading')}</div> : certs.length === 0 ? <div style={{ fontSize: 13, color: '#8A7A6D' }}>{tx('pos.no_certifications_on_file')}</div> : certs.map((c) => (
        <div key={c.id} style={{ border: '1px solid #EFEAE1', borderRadius: 10, padding: 10, marginBottom: 8, background: '#FAFAF9', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={chip(toneFor(c.verificationStatus))}>{workforceLabel(c.verificationStatus)}</span>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{c.name}</span>
          <span style={{ fontSize: 12, color: '#8A7A6D' }}>{c.issuer ? `${c.issuer} · ` : ''}{c.expiresAt ? tx('pos.expires_v0_v1', { v0: String(c.expiresAt.slice(0, 10)), v1: String(c.daysToExpiry != null && c.daysToExpiry <= 30 && c.daysToExpiry >= 0 ? tx('pos.daystoexpiry_days', { daysToExpiry: String(c.daysToExpiry) }) : '') }) : tx('pos.no_expiry')}{c.hasDocument ? tx('pos.document_on_file') : ''}</span>
          {c.revokedReason ? <span style={{ fontSize: 12, color: '#C0392B' }}>· {c.revokedReason}</span> : null}
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
            {c.verificationStatus === 'UNVERIFIED' ? <button className="btn" disabled={!!busy} onClick={() => act('c-' + c.id, () => posWorkforceApi.verifyCertification(technicianId, c.id, 'VERIFIED'))}>{tx('pos.verify')}</button> : null}
            {c.verificationStatus === 'VERIFIED' ? <button className="btn ghost" disabled={!!busy} onClick={() => ask(tx('admin.workforce.askRevokeCert'), (reason) => { void act('c-' + c.id, () => posWorkforceApi.verifyCertification(technicianId, c.id, 'REVOKED', reason)); }, { confirmLabel: tx('pos.revoke'), inputLabel: tx('admin.workforce.reason') })}>{tx('pos.revoke')}</button> : null}
          </span>
        </div>
      ))}
    </section>
  );
}
