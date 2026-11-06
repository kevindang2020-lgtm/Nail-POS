// TechnicianDaysOffSkills.tsx — Technician Profile & Team Management guide (Nov 5 2026, G3 §7 / §8):
//   WeeklyDaysOffPanel     Schedule › Days Off: Set Day Off / Working Pattern (repeat every week on chosen weekdays from a
//                          date, until changed or an end date), Before / After preview, the bookings on the new days off
//                          (kept — never cancelled), Save, Remove Recurrence, this month's calendar and the history.
//                          One day / a few dates go through the existing Edit Shift for Selected Date.
//   TechnicianSkillsPanel  Skills & Services: the technician's skills with their real status, Assign Skills (several at
//                          once from the salon's catalog), Remove (with the services and future bookings it affects).
//   SkillsCatalogDialog    Manage Skills Catalog: create / edit / archive, linked to EXISTING services, search, status
//                          filter, numbered pages (newest first).
// Every rule is the server's; buttons hide without permission and the server still refuses.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posWeeklyDaysOffApi, posSkillsCatalogApi } from '../api/posTeamScheduleSkillsApi';
import { posServicesApi } from '../api/posServicesApi';
import { errorTextOf } from '../i18n/error-text';
import { FitDialog } from './FitKit';
import { fmtInZone } from '../i18n/format';   // the location's clock (not the device's)

const WD = [1, 2, 3, 4, 5, 6, 0];   // Monday first on the chips (values are 0 = Sunday … 6 = Saturday)
const dayList = (days: number[]) => days.map((d) => tx(`tpx.wd.${d}`)).join(' + ');
const PROF = ['BASIC', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'];

export function WeeklyDaysOffPanel({ technicianId, canEdit }: { technicianId: string; canEdit: boolean }) {
  const nav = useNavigate();
  const [d, setD] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<{ mode: 'week' | 'once'; days: number[]; from: string; to: string; reason: string } | null>(null);
  const [pv, setPv] = useState<any | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [endFrom, setEndFrom] = useState('');
  const load = useCallback(() => { posWeeklyDaysOffApi.list(technicianId).then((x) => { setD(x); setErr(null); }).catch((e) => setErr(errorTextOf(e, tx('tpx.failed')))); }, [technicianId]);
  useEffect(() => { load(); }, [load]);
  const body = () => ({ technicianId, weekdays: form!.days, effectiveFrom: form!.from, effectiveTo: form!.to || null, reason: form!.reason || null, expectedVersion: d?.version ?? 0 });
  const preview = async () => { setBusy(true); setNote(null); setAck(false); try { setPv(await posWeeklyDaysOffApi.preview(body())); } catch (e) { setNote(errorTextOf(e, tx('tpx.failed'))); } finally { setBusy(false); } };
  const save = async () => {
    setBusy(true); setNote(null);
    try { const r = await posWeeklyDaysOffApi.save({ ...body(), acknowledgeConflicts: ack }); setD(r); setForm(null); setPv(null); setNote(tx('tpx.wo.saved')); }
    catch (e) { setNote(errorTextOf(e, tx('tpx.failed'))); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!d?.current || !endFrom) return; setBusy(true); setNote(null);
    try { const r = await posWeeklyDaysOffApi.end({ technicianId, ruleId: d.current.id, endFrom, expectedVersion: d.current.version }); setD(r); setNote(tx('tpx.wo.ended', { d: endFrom })); setEndFrom(''); }
    catch (e) { setNote(errorTextOf(e, tx('tpx.failed'))); } finally { setBusy(false); }
  };
  if (err) return <div className="err" style={{ fontSize: 12 }}>{err}</div>;
  if (!d) return <div className="muted" style={{ fontSize: 12 }}>{tx('tpx.loading')}</div>;
  const fmtRule = (r: any) => tx('tpx.wo.current', { days: dayList(r.weekdays), from: r.effectiveFrom, to: r.effectiveTo ? tx('tpx.wo.until', { d: r.effectiveTo }) : tx('tpx.wo.untilChanged') });
  const blocking = pv && pv.conflicts?.length > 0;
  return (
    <div data-testid="weekly-days-off" style={{ fontSize: 12.5 }}>
      <div style={{ fontWeight: 800, margin: '10px 0 4px' }}>{tx('tpx.wo.title')}</div>
      {d.current ? <div data-testid="wo-current">{fmtRule(d.current)}</div> : <div className="muted">{tx('tpx.wo.none')}</div>}
      {d.upcoming?.map((r: any) => <div key={r.id} className="muted">{tx('tpx.wo.upcoming', { from: r.effectiveFrom, days: dayList(r.weekdays) })}</div>)}
      {canEdit && !form ? <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn" onClick={() => { setForm({ mode: 'week', days: d.current?.weekdays ?? [], from: d.today, to: '', reason: '' }); setPv(null); }} data-testid="wo-open">{tx('tpx.wo.set')}</button>
        {d.current ? <><label className="muted">{tx('tpx.wo.worksAgain')} <input type="date" value={endFrom} min={d.today} onChange={(e) => setEndFrom(e.target.value)} data-testid="wo-end-from" /></label>
          <button className="btn ghost" disabled={!endFrom || busy} onClick={remove} data-testid="wo-remove">{tx('tpx.wo.remove')}</button></> : null}
      </div> : null}
      {form ? (
        <div className="panel" style={{ padding: 10, marginTop: 8 }} data-testid="wo-form">
          <div role="tablist" style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {(['week', 'once'] as const).map((m) => <button key={m} role="tab" aria-selected={form.mode === m} className={'btn ' + (form.mode === m ? '' : 'ghost')} onClick={() => setForm({ ...form, mode: m })}>{tx(m === 'week' ? 'tpx.wo.mode.week' : 'tpx.wo.mode.once')} {m === 'once' ? `/ ${tx('tpx.wo.mode.range')}` : ''}</button>)}
          </div>
          {form.mode === 'once' ? <div><div className="muted">{tx('tpx.wo.onceHint')}</div><button className="btn ghost" style={{ marginTop: 6 }} onClick={() => nav('/technicians/schedule')}>{tx('tpx.wo.openLive')}</button></div> : <>
            <div className="muted" style={{ marginBottom: 4 }}>{tx('tpx.wo.days')}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {WD.map((w) => { const on = form.days.includes(w); return <button key={w} type="button" aria-pressed={on} className={'btn ' + (on ? '' : 'ghost')} style={{ minWidth: 52, minHeight: 40 }} data-testid={`wo-day-${w}`}
                onClick={() => { setPv(null); setForm({ ...form, days: on ? form.days.filter((x) => x !== w) : [...form.days, w] }); }}>{tx(`tpx.wd.${w}`)}</button>; })}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
              <label>{tx('tpx.wo.from')} <input type="date" value={form.from} min={d.today} onChange={(e) => { setPv(null); setForm({ ...form, from: e.target.value }); }} data-testid="wo-from" /></label>
              <label>{tx('tpx.wo.to')} <input type="date" value={form.to} min={form.from} onChange={(e) => { setPv(null); setForm({ ...form, to: e.target.value }); }} data-testid="wo-to" /></label>
              <label style={{ flex: 1, minWidth: 200 }}>{tx('tpx.wo.reason')} <input className="fk-input" value={form.reason} maxLength={500} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
            </div>
            {pv ? (
              <div style={{ marginTop: 8 }} data-testid="wo-preview">
                <table className="tbl" style={{ fontSize: 12 }}><thead><tr><th /><th>{tx('tpx.wo.before')}</th><th>{tx('tpx.wo.after')}</th></tr></thead>
                  <tbody>{WD.map((w) => { const b = pv.before.find((x: any) => x.weekday === w); const a = pv.after.find((x: any) => x.weekday === w);
                    const cell = (x: any) => (x.off ? <b>{tx('tpx.wo.off')}</b> : x.hours ?? tx('tpx.wo.storeHours'));
                    return <tr key={w}><td>{tx(`tpx.wd.${w}`)}</td><td>{cell(b)}</td><td>{cell(a)}</td></tr>; })}</tbody></table>
                {pv.keptWorkingDates?.length ? <div className="muted">{tx('tpx.wo.kept', { d: pv.keptWorkingDates.join(', ') })}</div> : null}
                {blocking ? <div className="fk-hint warn" data-testid="wo-conflicts">{tx('tpx.wo.conflicts', { n: String(pv.conflicts.length) })}
                  <ul style={{ margin: '4px 0 0 16px' }}>{pv.conflicts.slice(0, 20).map((c: any) => <li key={c.appointmentId}>{c.date} {c.startTime} · {c.customer ?? '—'}</li>)}</ul>
                  <label style={{ display: 'block', marginTop: 4 }}><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="wo-ack" /> {tx('tpx.wo.ack')}</label></div>
                  : <div className="muted">{tx('tpx.wo.noConflicts')}</div>}
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn ghost" onClick={() => { setForm(null); setPv(null); }}>{tx('tpx.wo.cancel')}</button>
              <button className="btn ghost" disabled={busy || !form.days.length || !form.from} onClick={preview} data-testid="wo-preview-btn">{tx('tpx.wo.preview')}</button>
              <button className="btn" disabled={busy || !pv || (blocking && !ack)} onClick={save} data-testid="wo-save">{tx('tpx.wo.save')}</button>
            </div>
          </>}
        </div>
      ) : null}
      {note ? <div className="fk-hint" role="status" style={{ marginTop: 6 }} data-testid="wo-note">{note}</div> : null}
      <div style={{ fontWeight: 700, margin: '10px 0 4px' }}>{tx('tpx.wo.calendar')} · {d.month}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 3 }} data-testid="wo-calendar">
        {[0, 1, 2, 3, 4, 5, 6].map((w) => <div key={'h' + w} className="muted" style={{ fontSize: 11, textAlign: 'center' }}>{tx(`tpx.wd.${w}`)}</div>)}
        {Array.from({ length: new Date(`${d.month}-01T12:00:00Z`).getUTCDay() }).map((_, i) => <div key={'p' + i} />)}
        {d.calendar.map((c: any) => <div key={c.date} title={tx(`tpx.wo.state.${c.state}`)} className={'pill ' + (c.state.startsWith('off') ? 'warn' : c.state === 'working_override' ? 'ok' : '')}
          style={{ textAlign: 'center', fontSize: 11, padding: '3px 0', fontWeight: c.date === d.today ? 800 : 500 }}>{Number(c.date.slice(8))}</div>)}
      </div>
      {d.history?.length ? <details style={{ marginTop: 8 }}><summary className="muted">{tx('tpx.wo.history')}</summary>
        <ul style={{ margin: '4px 0 0 16px' }}>{d.history.slice(0, 10).map((h: any) => <li key={h.id}>{h.at ? fmtInZone(h.at, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''} · {tx(`tpx.wo.act.${h.action}`)}{h.after?.weekdays ? ` · ${dayList(h.after.weekdays)}` : ''}{h.actor ? ` · ${h.actor}` : ''}{h.reason ? ` · ${h.reason}` : ''}</li>)}</ul></details> : null}
    </div>
  );
}

export function TechnicianSkillsPanel({ technicianId, canEdit }: { technicianId: string; canEdit: boolean }) {
  const [d, setD] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [cat, setCat] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<string[]>([]);
  const [prof, setProf] = useState('');
  const [rm, setRm] = useState<{ a: any; pv: any; reason: string; ack: boolean } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [manage, setManage] = useState(false);
  const load = useCallback(() => { posSkillsCatalogApi.technician(technicianId).then((x) => { setD(x); setErr(null); }).catch((e) => setErr(errorTextOf(e, tx('tpx.failed')))); }, [technicianId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!assigning) return; const h = setTimeout(() => { posSkillsCatalogApi.list({ q: q || undefined, status: 'active', pageSize: 100 }).then((r) => setCat(r.items ?? [])).catch((e) => setNote(errorTextOf(e, tx('tpx.failed')))); }, 250); return () => clearTimeout(h); }, [assigning, q]);
  const held = useMemo(() => new Set((d?.items ?? []).filter((i: any) => i.status !== 'REVOKED').map((i: any) => i.skillId)), [d]);
  const assign = async () => {
    setBusy(true); setNote(null);
    try { const r = await posSkillsCatalogApi.assign({ technicianId, skillIds: pick, proficiency: prof || null }); setD(r); setAssigning(false); setPick([]);
      setNote([r.assigned?.length ? tx('tpx.sk.assigned', { s: r.assigned.join(', '), n: String(r.servicesGranted ?? 0) }) : '', r.already?.length ? tx('tpx.sk.already', { s: r.already.join(', ') }) : ''].filter(Boolean).join(' ')); }
    catch (e) { setNote(errorTextOf(e, tx('tpx.failed'))); } finally { setBusy(false); }
  };
  const startRemove = async (a: any) => { setNote(null); try { setRm({ a, pv: await posSkillsCatalogApi.revokePreview(technicianId, a.id), reason: '', ack: false }); } catch (e) { setNote(errorTextOf(e, tx('tpx.failed'))); } };
  const remove = async () => {
    if (!rm) return; setBusy(true);
    try { const r = await posSkillsCatalogApi.revoke({ technicianId, assignmentId: rm.a.id, reason: rm.reason, expectedVersion: rm.a.version, acknowledgeBookings: rm.ack }); setD(r); setRm(null); }
    catch (e) { setNote(errorTextOf(e, tx('tpx.failed'))); } finally { setBusy(false); }
  };
  if (err) return <div className="err" style={{ fontSize: 12 }}>{err}</div>;
  if (!d) return <div className="muted" style={{ fontSize: 12 }}>{tx('tpx.loading')}</div>;
  return (
    <div data-testid="tech-skills" style={{ fontSize: 12.5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 4px' }}>
        <b>{tx('tpx.sk.title')}</b><span className="muted">{tx('tpx.sk.eligible', { n: String(d.eligibleServices) })}</span>
        {canEdit ? <><button className="btn" style={{ marginLeft: 'auto' }} onClick={() => setAssigning((v) => !v)} data-testid="sk-assign-open">{tx('tpx.sk.assign')}</button>
          <button className="btn ghost" onClick={() => setManage(true)} data-testid="sk-manage">{tx('tpx.sk.manage')}</button></> : null}
      </div>
      {d.items.length ? <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>{d.items.map((a: any) => (
        <li key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '3px 0', opacity: a.status === 'REVOKED' ? 0.6 : 1 }}>
          <span className={'pill ' + (a.status === 'APPROVED' ? 'ok' : a.status === 'REVOKED' ? '' : 'warn')}>{tx(`tpx.sk.st.${a.status}`)}</span>
          <b>{a.name}</b>{a.proficiency ? <span className="muted">{tx(`tpx.prof.${a.proficiency}`)}</span> : null}
          <span className="muted">{a.services.length ? tx('tpx.sk.services', { s: a.services.map((s: any) => s.name).join(', ') }) : tx('tpx.sk.noServices')}</span>
          {canEdit && a.status !== 'REVOKED' ? <button className="btn ghost" style={{ marginLeft: 'auto', fontSize: 11 }} onClick={() => startRemove(a)} data-testid={`sk-remove-${a.id}`}>{tx('tpx.sk.remove')}</button> : null}
        </li>))}</ul> : <div className="muted">{tx('tpx.sk.none')}</div>}
      {assigning ? <div className="panel" style={{ padding: 10, marginTop: 6 }} data-testid="sk-assign">
        <input className="fk-input" placeholder={tx('tpx.sk.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tx('tpx.sk.search')} />
        <div style={{ maxHeight: 220, overflowY: 'auto', marginTop: 6 }}>
          {cat == null ? <div className="muted">{tx('tpx.loading')}</div> : cat.length ? cat.map((k: any) => (
            <label key={k.id} style={{ display: 'flex', gap: 6, padding: '3px 0', opacity: held.has(k.id) ? 0.5 : 1 }}>
              <input type="checkbox" disabled={held.has(k.id)} checked={pick.includes(k.id)} onChange={(e) => setPick((p) => (e.target.checked ? [...p, k.id] : p.filter((x) => x !== k.id)))} data-testid={`sk-pick-${k.id}`} />
              <span><b>{k.name}</b>{k.category ? ` · ${k.category}` : ''} <span className="muted">{k.services.length ? k.services.map((s: any) => s.name).join(', ') : tx('tpx.sk.noServices')}</span></span>
            </label>)) : <div className="muted">{tx('tpx.cat.empty')}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
          <label>{tx('tpx.sk.proficiency')} <select value={prof} onChange={(e) => setProf(e.target.value)}><option value="">—</option>{PROF.map((p) => <option key={p} value={p}>{tx(`tpx.prof.${p}`)}</option>)}</select></label>
          <button className="btn" style={{ marginLeft: 'auto' }} disabled={busy || !pick.length} onClick={assign} data-testid="sk-assign-save">{tx('tpx.sk.save')}</button>
        </div>
      </div> : null}
      {rm ? <div className="panel" style={{ padding: 10, marginTop: 6 }} data-testid="sk-remove">
        <div>{rm.pv.servicesRemoved.length ? tx('tpx.sk.removeWarn', { s: rm.pv.servicesRemoved.map((s: any) => s.name).join(', ') }) : tx('tpx.sk.removeNone')}</div>
        {rm.pv.futureBookings.length ? <div className="fk-hint warn">{tx('tpx.sk.futureBookings', { n: String(rm.pv.futureBookings.length) })}
          <label style={{ display: 'block' }}><input type="checkbox" checked={rm.ack} onChange={(e) => setRm({ ...rm, ack: e.target.checked })} data-testid="sk-ack" /> {tx('tpx.wo.ack')}</label></div> : null}
        <label style={{ display: 'block', marginTop: 6 }}>{tx('tpx.sk.reason')} <input className="fk-input" value={rm.reason} maxLength={500} onChange={(e) => setRm({ ...rm, reason: e.target.value })} data-testid="sk-reason" /></label>
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}><button className="btn ghost" onClick={() => setRm(null)}>{tx('tpx.wo.cancel')}</button>
          <button className="btn" disabled={busy || rm.reason.trim().length < 3 || (rm.pv.futureBookings.length > 0 && !rm.ack)} onClick={remove} data-testid="sk-remove-confirm">{tx('tpx.sk.confirmRemove')}</button></div>
      </div> : null}
      {note ? <div className="fk-hint" role="status" style={{ marginTop: 6 }} data-testid="sk-note">{note}</div> : null}
      {manage ? <SkillsCatalogDialog onClose={() => { setManage(false); load(); }} /> : null}
    </div>
  );
}

export function SkillsCatalogDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState(''); const [status, setStatus] = useState('active'); const [page, setPage] = useState(1);
  const [d, setD] = useState<any | null>(null); const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<any | null>(null); const [services, setServices] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false); const [note, setNote] = useState<string | null>(null);
  const load = useCallback(() => { posSkillsCatalogApi.list({ q: q || undefined, status, page, pageSize: 25 }).then((x) => { setD(x); setErr(null); }).catch((e) => setErr(errorTextOf(e, tx('tpx.failed')))); }, [q, status, page]);
  useEffect(() => { const h = setTimeout(load, 200); return () => clearTimeout(h); }, [load]);
  useEffect(() => { setPage(1); }, [q, status]);
  useEffect(() => { if (edit && services == null) posServicesApi.list().then((r: any) => setServices((Array.isArray(r) ? r : r?.items ?? r?.services ?? []).filter((s: any) => (s.status ?? 'active') === 'active'))).catch(() => setServices([])); }, [edit, services]);
  const save = async () => {
    setBusy(true); setNote(null);
    try { await posSkillsCatalogApi.save({ id: edit.id ?? null, name: edit.name, category: edit.category || null, description: edit.description || null, requiredCertification: edit.requiredCertification || null, serviceIds: edit.serviceIds, expectedVersion: edit.version ?? null }); setEdit(null); load(); }
    catch (e) { setNote(errorTextOf(e, tx('tpx.failed'))); } finally { setBusy(false); }
  };
  const archive = async (k: any) => { try { await posSkillsCatalogApi.archive(k.id, k.status === 'active'); load(); } catch (e) { setNote(errorTextOf(e, tx('tpx.failed'))); } };
  return (
    <FitDialog title={tx('tpx.cat.title')} onClose={onClose} wide testId="skills-catalog" footer={<button className="btn ghost" onClick={onClose}>{tx('tpx.close')}</button>}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input className="fk-input" style={{ flex: 1 }} placeholder={tx('tpx.sk.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tx('tpx.sk.search')} />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={tx('pos.status')}>{['active', 'archived', 'all'].map((s) => <option key={s} value={s}>{tx(`tpx.cat.status.${s}`)}</option>)}</select>
        {d?.canEdit ? <button className="btn" onClick={() => setEdit({ name: '', category: '', description: '', requiredCertification: '', serviceIds: [] })} data-testid="cat-new">{tx('tpx.cat.new')}</button> : null}
      </div>
      {edit ? <div className="panel" style={{ padding: 10, marginBottom: 8 }} data-testid="cat-form">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label>{tx('tpx.cat.name')}<input className="fk-input" value={edit.name} maxLength={80} onChange={(e) => setEdit({ ...edit, name: e.target.value })} data-testid="cat-name" /></label>
          <label>{tx('tpx.cat.category')}<input className="fk-input" value={edit.category ?? ''} maxLength={60} list="tpx-cats" onChange={(e) => setEdit({ ...edit, category: e.target.value })} /></label>
          <label style={{ gridColumn: '1 / -1' }}>{tx('tpx.cat.description')}<input className="fk-input" value={edit.description ?? ''} maxLength={500} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></label>
          <label style={{ gridColumn: '1 / -1' }}>{tx('tpx.cat.cert')}<input className="fk-input" value={edit.requiredCertification ?? ''} maxLength={120} onChange={(e) => setEdit({ ...edit, requiredCertification: e.target.value })} /></label>
        </div>
        <datalist id="tpx-cats">{(d?.categories ?? []).map((c: string) => <option key={c} value={c} />)}</datalist>
        <div style={{ fontWeight: 700, marginTop: 8 }}>{tx('tpx.cat.services')}</div><div className="muted">{tx('tpx.cat.noPrice')}</div>
        <div style={{ maxHeight: 180, overflowY: 'auto', columns: 2 }}>{services == null ? tx('tpx.loading') : services.map((s: any) => (
          <label key={s.id} style={{ display: 'block' }}><input type="checkbox" checked={edit.serviceIds.includes(s.id)} onChange={(e) => setEdit({ ...edit, serviceIds: e.target.checked ? [...edit.serviceIds, s.id] : edit.serviceIds.filter((x: string) => x !== s.id) })} /> {s.name}</label>))}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}><button className="btn ghost" onClick={() => setEdit(null)}>{tx('tpx.wo.cancel')}</button>
          <button className="btn" disabled={busy || !edit.name.trim()} onClick={save} data-testid="cat-save">{tx('tpx.sk.save')}</button></div>
      </div> : null}
      {err ? <div className="err">{err}</div> : !d ? <div className="muted">{tx('tpx.loading')}</div> : d.items.length ? (
        <table className="tbl" style={{ fontSize: 12.5 }}><tbody>{d.items.map((k: any) => (
          <tr key={k.id}><td><b>{k.name}</b>{k.category ? <div className="muted">{k.category}</div> : null}</td>
            <td className="muted">{k.services.length ? k.services.map((s: any) => s.name).join(', ') : tx('tpx.sk.noServices')}</td>
            <td>{tx('tpx.cat.techs', { n: String(k.technicians) })}</td><td><span className={'pill ' + (k.status === 'active' ? 'ok' : '')}>{tx(`tpx.cat.status.${k.status}`)}</span></td>
            <td>{d.canEdit ? <><button className="btn ghost" style={{ fontSize: 11 }} onClick={() => setEdit({ id: k.id, name: k.name, category: k.category ?? '', description: k.description ?? '', requiredCertification: k.requiredCertification ?? '', serviceIds: k.services.map((s: any) => s.id), version: k.version })}>{tx('tpx.cat.edit')}</button>
              <button className="btn ghost" style={{ fontSize: 11 }} onClick={() => archive(k)}>{tx(k.status === 'active' ? 'tpx.cat.archive' : 'tpx.cat.restore')}</button></> : null}</td></tr>))}</tbody></table>
      ) : <div className="muted">{tx('tpx.cat.empty')}</div>}
      {d && d.totalPages > 1 ? <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
        <button className="btn ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>{tx('tpx.prev')}</button>
        {Array.from({ length: d.totalPages }, (_, i) => i + 1).slice(0, 10).map((p) => <button key={p} className={'btn ' + (p === d.page ? '' : 'ghost')} onClick={() => setPage(p)}>{p}</button>)}
        <button className="btn ghost" disabled={page >= d.totalPages} onClick={() => setPage(page + 1)}>{tx('tpx.next')}</button>
        <span className="muted">{tx('tpx.cat.page', { p: String(d.page), t: String(d.totalPages), n: String(d.totalItems) })}</span></div> : null}
      {note ? <div className="fk-hint" role="status">{note}</div> : null}
    </FitDialog>
  );
}
