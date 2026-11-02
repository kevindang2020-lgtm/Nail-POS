// teamStaffParts.tsx — Team Management round 2 (Four-Module Completion Guide §10, 30 Oct 2026) on /tenant/team/members:
//   AddTeamMemberDialog   role-specific onboarding: receptionist / assistant / manager / the salon's custom roles go to
//                         /pos/team-onboarding/staff (server-checked role + branch authority, one identity, idempotency
//                         key, step-up); nail technician / stylist use the existing technician hire (POST /pos/technicians)
//                         and ONLY they see technician fields. Success → back to the list with ?created=<id>.
//   TeamBirthdaysPanel    upcoming 30 days from /pos/team-birthdays/upcoming — minimal (name · month/day · in N days),
//                         private birthdays only for managers; "Not recorded" only when nobody has one.
//   MemberBirthday        the profile's optional month/day (no year) with the "show to colleagues" choice.
//   TeamTrainingPanel     real completed / expiring / in-progress counts, or "Not configured" while the catalog is empty.
//   TeamTrainingCatalog   the salon's courses: add, archive (with a reason).
//   MemberTraining        the profile's Training tab: assignments (start / complete / cancel, history), certifications
//                         (unverified until verified — completion is never verification).
import { useEffect, useMemo, useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posTeamOnboardingApi, posTeamBirthdaysApi, posTeamTrainingApi, type OnboardRole } from '../api/posTeamStaffApi';
import { posTechniciansApi } from '../api/posTechniciansApi';
import { posWorkforceApi } from '../api/posWorkforceApi';
import { FitDialog, FitPanel, Pager, Empty, requestId } from '../components/FitKit';
import { useLoad, StateBlock, fmtYmdSafe } from '../components/FinanceKit';
import { useStepUp, isStepUpCancelled } from './access/accessUi';
import { pageOf, whenTime } from './technicianScreenParts';
import { nf } from './teamShared';

type Err = { status?: number; code?: string; message?: string; body?: any } | null;
const codeOf = (e: Err) => e?.code ?? e?.body?.code ?? e?.body?.error?.code ?? null;
const detailOf = (e: Err, k: string) => e?.body?.[k] ?? e?.body?.error?.details?.[k] ?? e?.body?.details?.[k] ?? null;
const errText = (e: unknown) => { const x = e as Err; const c = codeOf(x);
  return c && tx('tms.err.' + c) !== 'tms.err.' + c ? tx('tms.err.' + c) : x?.status === 409 ? tx('cr.err.conflict') : x?.status === 403 ? tx('tms.err.FORBIDDEN') : x?.message || tx('cr.err.generic'); };
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const monthName = (m: number) => tx('tms.month.' + m);
const roleText = (r: OnboardRole) => (r.custom ? r.label : tx('tms.role.' + r.key));

// ── Add Team Member ─────────────────────────────────────────────────────────────────────────────────────────────────
export function AddTeamMemberDialog({ onClose, onCreated, onOpenMember }: { onClose: () => void; onCreated: (memberId: string) => void; onOpenMember: (memberId: string) => void }) {
  const opts = useLoad(() => posTeamOnboardingApi.options(), []);
  const o = opts.data;
  const [role, setRole] = useState(''); const [fullName, setFullName] = useState(''); const [first, setFirst] = useState(''); const [last, setLast] = useState('');
  const [email, setEmail] = useState(''); const [phone, setPhone] = useState(''); const [commission, setCommission] = useState(''); const [branches, setBranches] = useState<string[]>([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<Err>(null); const [done, setDone] = useState<any | null>(null);
  const [key, setKey] = useState(() => requestId());   // one idempotency key per attempt: a retry of the SAME form reuses it
  const { run, prompt } = useStepUp(tx('tms.add.stepUp'));
  const sel = o?.roles.find((r) => r.key === role) ?? null;
  useEffect(() => { if (o && !role) { const first0 = o.roles.find((r) => r.allowed); if (first0) setRole(first0.key); } if (o && !branches.length && o.sessionBranchId) setBranches([o.sessionBranchId]); }, [o]);   // eslint-disable-line react-hooks/exhaustive-deps
  const change = (fn: () => void) => { fn(); setErr(null); setKey(requestId()); };   // a changed form is a new request
  const submit = async () => {
    if (!sel) return; setBusy(true); setErr(null);
    try {
      if (sel.flow === 'technician') {
        const body: Record<string, unknown> = { firstName: first.trim(), lastName: last.trim(), status: 'active', ...(phone.trim() ? { phone: phone.trim() } : {}), ...(email.trim() ? { email: email.trim() } : {}),
          ...(commission.trim() ? { defaultCommissionPercent: Number(commission) } : {}) };
        const r = await posTechniciansApi.create(body, key) as { technicianId?: string; userId?: string | null; invite?: { acceptUrl?: string | null; deliveryStatus?: string | null } };
        if (sel.key === 'stylist' && r?.technicianId) await posTechniciansApi.update(r.technicianId, { roleLabel: 'Stylist' });
        setDone({ memberId: r?.userId ?? r?.technicianId, role: sel.key, technicianRecord: true, invite: r?.invite ?? null });
      } else {
        const r = await run(() => posTeamOnboardingApi.createStaff({ role: sel.key, fullName: fullName.trim(), ...(email.trim() ? { email: email.trim() } : {}), ...(phone.trim() ? { phone: phone.trim() } : {}),
          branchIds: branches, idempotencyKey: key }));
        setDone(r);
      }
    } catch (e) { if (!isStepUpCancelled(e)) setErr(e as Err); } finally { setBusy(false); }
  };
  const existing = err && codeOf(err) === 'DUPLICATE_IDENTITY' ? detailOf(err, 'existingMemberId') : null;
  const ready = !!sel && sel.allowed && (sel.flow === 'technician' ? first.trim().length > 0 && last.trim().length > 0 : fullName.trim().length >= 2 && (email.trim() || phone.trim()));
  return (
    <FitDialog title={tx('tms.add.title')} onClose={onClose} busy={busy} testId="dlg-add-member"
      footer={done ? <><button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.close')}</button><button type="button" className="fk-btn primary" onClick={() => onCreated(String(done.memberId))} data-testid="add-show-in-list">{tx('tms.add.showInList')}</button></>
        : <><button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.cancel')}</button><button type="button" className="fk-btn primary" disabled={!ready || busy} aria-busy={busy} onClick={submit} data-testid="add-submit">{busy ? tx('pos.saving_2') : tx('tms.add.submit')}</button></>}>
      {opts.error ? <StateBlock error={opts.error} onRetry={opts.reload} /> : !o ? <div className="fk-loading">{tx('pos.loading')}</div> : !o.canOnboard ? <Empty title={tx('tms.add.cannot')}><span className="fk-hint">{tx('tms.add.cannotWhy')}</span></Empty>
        : done ? <div data-testid="add-done">
          <div className="fk-note ok" role="status"><span>{tx('tms.add.done', { role: sel ? roleText(sel) : '' })}</span></div>
          <dl className="fk-dl mo-dl"><dt>{tx('tms.add.status')}</dt><dd>{done.technicianRecord ? tx('tms.add.techCreated') : tx('tms.add.invited')}{done.replayed ? <span className="fk-li-s">{tx('tms.add.replayed')}</span> : null}</dd>
            <dt>{tx('tms.add.delivery')}</dt><dd>{done.invite?.deliveryStatus ? tx('tms.delivery.' + done.invite.deliveryStatus) : '—'}</dd></dl>
          {done.invite?.acceptUrl ? <label className="fk-field">{tx('tms.add.link')}<input className="fk-input" readOnly value={done.invite.acceptUrl} onFocus={(e) => e.currentTarget.select()} data-testid="add-invite-link" /></label> : null}
          {!done.technicianRecord ? <p className="fk-hint">{tx('tms.add.noTechData')}</p> : null}
        </div> : <div className="tms-form">
          <label className="fk-field">{tx('tms.add.role')}<select className="fk-select" value={role} onChange={(e) => change(() => setRole(e.target.value))} data-testid="add-role">
            {o.roles.map((r) => <option key={r.key} value={r.key} disabled={!r.allowed}>{roleText(r)}{r.allowed ? '' : ` — ${tx('tms.reason.' + (r.reason ?? 'FORBIDDEN'))}`}</option>)}</select></label>
          {sel?.flow === 'technician' ? <fieldset className="tms-fs" data-testid="add-tech-fields"><legend>{tx('tms.add.techFields')}</legend>
            <div className="tms-grid"><label className="fk-field">{tx('tms.add.first')}<input className="fk-input" value={first} onChange={(e) => change(() => setFirst(e.target.value))} data-testid="add-first" /></label>
              <label className="fk-field">{tx('tms.add.last')}<input className="fk-input" value={last} onChange={(e) => change(() => setLast(e.target.value))} data-testid="add-last" /></label>
              <label className="fk-field">{tx('tms.add.phone')}<input className="fk-input" inputMode="tel" value={phone} onChange={(e) => change(() => setPhone(e.target.value))} /></label>
              <label className="fk-field">{tx('tms.add.email')}<input className="fk-input" type="email" value={email} onChange={(e) => change(() => setEmail(e.target.value))} /></label>
              <label className="fk-field">{tx('tms.add.commission')}<input className="fk-input" inputMode="decimal" value={commission} onChange={(e) => change(() => setCommission(e.target.value.replace(/[^0-9.]/g, '')))} data-testid="add-commission" /></label></div>
            <p className="fk-hint">{tx('tms.add.techRule')}</p></fieldset>
            : sel ? <div className="tms-grid" data-testid="add-staff-fields">
              <label className="fk-field">{tx('tms.add.name')}<input className="fk-input" value={fullName} onChange={(e) => change(() => setFullName(e.target.value))} data-testid="add-name" /></label>
              <label className="fk-field">{tx('tms.add.email')}<input className="fk-input" type="email" value={email} onChange={(e) => change(() => setEmail(e.target.value))} data-testid="add-email" /></label>
              <label className="fk-field">{tx('tms.add.phone')}<input className="fk-input" inputMode="tel" value={phone} onChange={(e) => change(() => setPhone(e.target.value))} data-testid="add-phone" /></label>
              <fieldset className="tms-fs"><legend>{tx('tms.add.branches')}</legend>
                {o.branches.map((b) => <label key={b.id} className="tms-check"><input type="checkbox" checked={branches.includes(b.id)} disabled={!o.anyBranch}
                  onChange={(e) => change(() => setBranches((xs) => (e.target.checked ? [...xs, b.id] : xs.filter((x) => x !== b.id))))} />{b.name}</label>)}
                {!o.anyBranch ? <span className="fk-hint">{tx('tms.add.ownBranch')}</span> : null}</fieldset>
              <p className="fk-hint">{tx('tms.add.staffRule')}</p></div> : null}
          {err ? <div className="fk-note bad" role="alert" data-testid="add-error"><span>{errText(err)}</span>{existing ? <button type="button" className="fk-btn ghost sm" onClick={() => onOpenMember(String(existing))} data-testid="add-open-existing">{tx('tms.add.openExisting')}</button> : null}</div> : null}
        </div>}
      {prompt}
    </FitDialog>
  );
}

// ── Birthdays ───────────────────────────────────────────────────────────────────────────────────────────────────────
export function TeamBirthdaysPanel({ tick, onOpenMember }: { tick: number; onOpenMember: (memberId: string) => void }) {
  const b = useLoad(() => posTeamBirthdaysApi.upcoming({ days: 30 }), [tick]);
  const d: any = b.data;
  return (
    <FitPanel testId="birthdays" title={tx('pos.upcoming_birthdays')} actions={<span className="fk-muted">{tx('tms.bd.next30')}</span>}>
      {b.error ? <StateBlock error={b.error} onRetry={b.reload} /> : !d ? <div className="fk-loading">{tx('pos.loading')}</div>
        : !d.recorded ? <Empty title={tx('tmm.bd.notRecorded')}><span className="fk-hint">{tx('tms.bd.optional')}</span></Empty>
          : d.items.length === 0 ? <Empty title={tx('tms.bd.noneSoon')} />
            : <ul className="fk-list dense" data-testid="birthday-list">{d.items.map((x: any) => <li key={x.memberId} className="fk-li" data-testid="birthday-row">
              <span className="fk-li-t">{x.name}<span className="fk-li-s">{monthName(x.month)} {x.shownOnFeb28 ? 28 : x.day}{x.shownOnFeb28 ? ` · ${tx('tms.bd.feb29')}` : ''}{x.private ? ` · ${tx('tms.bd.private')}` : ''}</span></span>
              <span className={'fk-chip ' + (x.inDays === 0 ? 'ok' : 'mut')}>{x.inDays === 0 ? tx('tms.bd.today') : tx('tms.bd.inDays', { n: nf(x.inDays) })}</span>
              <button type="button" className="fk-btn ghost sm" onClick={() => onOpenMember(x.memberId)}>{tx('pos.profile_2')}</button></li>)}</ul>}
      <div className="fk-hint">{tx('tms.bd.rule')}</div>
    </FitPanel>
  );
}
export function MemberBirthday({ memberId }: { memberId: string }) {
  const [tick, setTick] = useState(0); const b = useLoad(() => posTeamBirthdaysApi.get(memberId), [memberId, tick]); const d: any = b.data;
  const [edit, setEdit] = useState(false); const [m, setM] = useState(1); const [day, setDay] = useState(1); const [vis, setVis] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const open = () => { setM(d?.month ?? 1); setDay(d?.day ?? 1); setVis(!!d?.visibleToTeam); setErr(null); setEdit(true); };
  const save = async (clear = false) => { setBusy(true); setErr(null); try { await posTeamBirthdaysApi.set(memberId, clear ? { month: null, day: null } : { month: m, day, visibleToTeam: vis }); setEdit(false); setTick((n) => n + 1); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } };
  if (b.error) return <span className="fk-hint">—</span>;
  if (!d) return <span className="fk-loading">{tx('pos.loading')}</span>;
  return <span data-testid="member-birthday">
    {!edit ? <>{d.recorded ? `${monthName(d.month)} ${d.day}` : d.hidden ? tx('tms.bd.hidden') : tx('tmm.bd.notRecorded')}{d.recorded ? <span className="fk-li-s">{d.visibleToTeam ? tx('tms.bd.shared') : tx('tms.bd.private')}</span> : null}
      {d.canEdit ? <button type="button" className="fk-btn ghost sm" onClick={open} data-testid="birthday-edit">{d.recorded ? tx('pos.edit') : tx('tms.bd.add')}</button> : null}</>
      : <span className="tms-bd-edit">
        <select className="fk-select" value={m} aria-label={tx('tms.bd.month')} onChange={(e) => { const v = Number(e.target.value); setM(v); setDay((x) => Math.min(x, DAYS_IN[v - 1])); }} data-testid="birthday-month">{MONTHS.map((x) => <option key={x} value={x}>{monthName(x)}</option>)}</select>
        <select className="fk-select" value={day} aria-label={tx('tms.bd.day')} onChange={(e) => setDay(Number(e.target.value))} data-testid="birthday-day">{Array.from({ length: DAYS_IN[m - 1] }, (_, i) => i + 1).map((x) => <option key={x} value={x}>{x}</option>)}</select>
        <label className="tms-check"><input type="checkbox" checked={vis} onChange={(e) => setVis(e.target.checked)} data-testid="birthday-share" />{tx('tms.bd.share')}</label>
        <button type="button" className="fk-btn primary sm" disabled={busy} onClick={() => save(false)} data-testid="birthday-save">{tx('pos.save')}</button>
        {d.recorded ? <button type="button" className="fk-btn ghost sm" disabled={busy} onClick={() => save(true)}>{tx('tms.bd.remove')}</button> : null}
        <button type="button" className="fk-btn ghost sm" onClick={() => setEdit(false)}>{tx('pos.cancel')}</button>
        <span className="fk-li-s">{tx('tms.bd.noYear')}</span>
        {err ? <span className="fk-note bad" role="alert">{err}</span> : null}</span>}
  </span>;
}

// ── Training ────────────────────────────────────────────────────────────────────────────────────────────────────────
function Ring({ value, max, color, label, sub, testId }: { value: number | null; max: number; color: string; label: string; sub: string; testId: string }) {
  const R = 22, C = 2 * Math.PI * R; const frac = value != null && max ? Math.min(1, value / max) : 0;
  return <div className="tmm-ring" data-testid={testId}><svg viewBox="0 0 56 56" width={56} height={56} aria-hidden><circle cx="28" cy="28" r={R} fill="none" stroke="#EFE6D6" strokeWidth="6" />
    <circle cx="28" cy="28" r={R} fill="none" stroke={color} strokeWidth="6" strokeDasharray={`${frac * C} ${C}`} strokeLinecap="round" transform="rotate(-90 28 28)" />
    <text x="28" y="33" textAnchor="middle" style={{ fontSize: 15, fontWeight: 800, fill: '#2A2118' }}>{value == null ? '—' : value}</text></svg><b>{label}</b><span>{sub}</span></div>;
}
export function TeamTrainingPanel({ tick, certs, onCatalog }: { tick: number; certs: any; onCatalog: () => void }) {
  const s = useLoad(() => posTeamTrainingApi.summary(), [tick]); const d: any = s.data;
  return (
    <FitPanel testId="training" title={tx('pos.training_certifications')} actions={d?.canManage || d?.configured ? <button type="button" className="fk-btn ghost sm" onClick={onCatalog} data-testid="view-training">{d?.configured ? tx('tms.tr.catalog') : tx('tms.tr.setUp')}</button> : null}>
      {s.error ? <StateBlock error={s.error} onRetry={s.reload} /> : !d ? <div className="fk-loading">{tx('pos.loading')}</div>
        : !d.configured ? <><Empty title={tx('tmm.notConfigured')}><span className="fk-hint">{tx('tms.tr.notConfiguredWhy')}</span></Empty>
          {certs ? <div className="fk-hint" data-testid="training-cert-line">{tx('tmm.tr.rule', { v: nf(certs.valid), x: nf(certs.expired), f: nf(certs.verified) })}</div> : null}</>
          : <><div className="tmm-rings">
            <Ring testId="ring-completed" value={d.assignments.completed} max={Math.max(1, d.assignments.completed + d.assignments.inProgress + d.assignments.assigned)} color="#2E7D32" label={tx('tms.tr.completed')} sub={tx('tms.tr.completedSub')} />
            <Ring testId="ring-expiring" value={d.assignments.expiringSoon + (certs?.expiringSoon ?? 0)} max={Math.max(1, d.assignments.completed + (certs?.valid ?? 0))} color="#E8852B" label={tx('tmm.tr.expiring')} sub={tx('tms.tr.expiringSub', { n: nf(d.expiringWindowDays) })} />
            <Ring testId="ring-progress" value={d.assignments.inProgress} max={Math.max(1, d.assignments.inProgress + d.assignments.assigned)} color="#2C6BB0" label={tx('tmm.tr.progress')} sub={tx('tms.tr.assignedSub', { n: nf(d.assignments.assigned) })} /></div>
            <div className="fk-hint" data-testid="training-rule">{tx('tms.tr.rule', { e: nf(d.assignments.expired), o: nf(d.assignments.overdue), v: nf((certs?.verified ?? 0) + d.staffCertifications.verified), u: nf(d.staffCertifications.unverified) })}</div></>}
    </FitPanel>
  );
}
export function TeamTrainingCatalog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [page, setPage] = useState(1); const [tick, setTick] = useState(0); const list = useLoad(() => posTeamTrainingApi.courses({ page, pageSize: 6 }), [page, tick]); const d: any = list.data;
  const [name, setName] = useState(''); const [category, setCategory] = useState(''); const [validity, setValidity] = useState(''); const [cert, setCert] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [archiving, setArchiving] = useState<any | null>(null); const [reason, setReason] = useState('');
  const add = async () => { setBusy(true); setErr(null); try { await posTeamTrainingApi.createCourse({ name: name.trim(), ...(category.trim() ? { category: category.trim() } : {}), validityMonths: validity ? Number(validity) : null, ...(cert.trim() ? { certificationName: cert.trim() } : {}) });
    setName(''); setCategory(''); setValidity(''); setCert(''); setTick((n) => n + 1); onChanged(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } };
  const archive = async () => { if (!archiving) return; setBusy(true); setErr(null); try { await posTeamTrainingApi.archiveCourse(archiving.id, { expectedVersion: archiving.version, reason: reason.trim() }); setArchiving(null); setReason(''); setTick((n) => n + 1); onChanged(); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); } };
  return (
    <FitDialog wide title={tx('tms.tr.catalog')} onClose={onClose} busy={busy} testId="dlg-training-catalog" footer={<button type="button" className="fk-btn primary" onClick={onClose}>{tx('pos.close')}</button>}>
      {list.error ? <StateBlock error={list.error} onRetry={list.reload} /> : !d ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        {d.items.length === 0 ? <Empty title={tx('tms.tr.noCourses')} /> : <table className="fk-table fn-table cg-table" data-testid="course-table"><thead><tr><th>{tx('tms.tr.course')}</th><th>{tx('pos.category')}</th><th>{tx('tms.tr.validity')}</th><th className="num">{tx('tms.tr.open')}</th><th className="num">{tx('tms.tr.completed')}</th><th aria-label={tx('pos.actions')}>{tx('pos.actions')}</th></tr></thead>
          <tbody>{d.items.map((c: any) => <tr key={c.id} data-testid="course-row"><td>{c.name}{c.certificationName ? <span className="fk-li-s">{tx('tms.tr.prepares', { c: c.certificationName })}</span> : null}</td><td>{c.category ?? '—'}</td>
            <td>{c.validityMonths ? tx('tms.tr.months', { n: nf(c.validityMonths) }) : tx('tms.tr.noExpiry')}</td><td className="num">{nf(c.open)}</td><td className="num">{nf(c.completed)}</td>
            <td>{d.canManage ? <button type="button" className="fk-btn ghost sm" onClick={() => { setArchiving(c); setReason(''); }}>{tx('tms.tr.archive')}</button> : null}</td></tr>)}</tbody></table>}
        <Pager info={pageOf(d)} onPage={setPage} compact />
        {archiving ? <div className="tms-inline" data-testid="course-archive"><label className="fk-field">{tx('tms.tr.archiveWhy', { c: archiving.name })}<input className="fk-input" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <button type="button" className="fk-btn" disabled={busy || reason.trim().length < 5} onClick={archive}>{tx('tms.tr.archive')}</button><button type="button" className="fk-btn ghost" onClick={() => setArchiving(null)}>{tx('pos.cancel')}</button></div> : null}
        {d.canManage ? <fieldset className="tms-fs" data-testid="course-add"><legend>{tx('tms.tr.addCourse')}</legend><div className="tms-grid">
          <label className="fk-field">{tx('tms.tr.course')}<input className="fk-input" value={name} onChange={(e) => setName(e.target.value)} data-testid="course-name" /></label>
          <label className="fk-field">{tx('pos.category')}<input className="fk-input" value={category} onChange={(e) => setCategory(e.target.value)} /></label>
          <label className="fk-field">{tx('tms.tr.validityMonths')}<input className="fk-input" inputMode="numeric" value={validity} onChange={(e) => setValidity(e.target.value.replace(/[^0-9]/g, ''))} data-testid="course-validity" /></label>
          <label className="fk-field">{tx('tms.tr.certName')}<input className="fk-input" value={cert} onChange={(e) => setCert(e.target.value)} /></label></div>
          <button type="button" className="fk-btn primary" disabled={busy || name.trim().length < 2} onClick={add} data-testid="course-save">{tx('tms.tr.addCourse')}</button></fieldset> : null}
        {err ? <div className="fk-note bad" role="alert"><span>{err}</span></div> : null}
        <p className="fk-hint">{tx('tms.tr.catalogRule')}</p></>}
    </FitDialog>
  );
}
const STATUS_TONE: Record<string, string> = { assigned: 'info', in_progress: 'warn', completed: 'ok', expired: 'bad', canceled: 'mut' };
const CERT_TONE: Record<string, string> = { valid: 'ok', expiring: 'warn', expired: 'bad', revoked: 'bad', rejected: 'bad' };
export function MemberTraining({ memberId, today }: { memberId: string; today: string }) {
  const [tick, setTick] = useState(0); const r = useLoad(() => posTeamTrainingApi.member(memberId), [memberId, tick]); const d: any = r.data;
  const courses = useLoad(() => (d?.canManage && d?.configured ? posTeamTrainingApi.courses({ pageSize: 100 }) : Promise.resolve(null)), [d?.canManage, d?.configured, tick]);
  const [courseId, setCourseId] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [cancel, setCancel] = useState<any | null>(null); const [reason, setReason] = useState(''); const [certOpen, setCertOpen] = useState(false);
  const [cName, setCName] = useState(''); const [cIssuer, setCIssuer] = useState(''); const [cExp, setCExp] = useState(''); const [cAsg, setCAsg] = useState('');
  const go = async (fn: () => Promise<unknown>) => { setBusy(true); setErr(null); try { await fn(); setTick((n) => n + 1); } catch (e) { setErr(errText(e)); if ((e as Err)?.status === 409) setTick((n) => n + 1); } finally { setBusy(false); } };
  const open = useMemo(() => new Set((d?.assignments ?? []).filter((a: any) => a.status === 'assigned' || a.status === 'in_progress').map((a: any) => a.courseId)), [d]);
  if (r.error) return <StateBlock error={r.error} onRetry={r.reload} />;
  if (!d) return <div className="fk-loading">{tx('pos.loading')}</div>;
  return <div data-testid="member-training">
    {!d.configured ? <div className="fk-note mut"><span>{tx('tmm.tr.notConfigured')}</span></div> : null}
    <h3 className="fk-h3">{tx('tms.tr.records')}</h3>
    {d.assignments.length === 0 ? <p className="fk-hint">{tx('tms.tr.noRecords')}</p> : <ul className="fk-list dense" data-testid="training-list">{d.assignments.map((a: any) => <li key={a.id} className="fk-li tms-asg" data-testid="training-row">
      <span className="fk-li-t">{a.course}<span className="fk-li-s">{a.completedOn ? tx('tms.tr.completedOn', { d: fmtYmdSafe(a.completedOn) }) : a.dueDate ? tx('tms.tr.due', { d: fmtYmdSafe(a.dueDate) }) : tx('tms.tr.assignedAt', { d: whenTime(a.assignedAt) })}
        {a.expiresOn ? ` · ${tx('tmm.expires', { d: fmtYmdSafe(a.expiresOn) })}` : ''}{a.linkedCertification ? ` · ${tx('tms.tr.certLinked')}` : ''}</span>
        {a.history.length ? <span className="fk-li-s">{a.history.map((h: any) => `${tx('tms.ev.' + h.type)} ${whenTime(h.at)}${h.actor ? ` · ${h.actor}` : ''}`).join(' ← ')}</span> : null}</span>
      <span className={'fk-chip ' + (STATUS_TONE[a.status] ?? 'mut')} data-testid="training-status">{tx('tms.st.' + a.status)}</span>
      {d.canManage ? <span className="tms-acts">{a.actions.includes('start') ? <button type="button" className="fk-btn ghost sm" disabled={busy} onClick={() => go(() => posTeamTrainingApi.start(a.id, { expectedVersion: a.version }))} data-testid="training-start">{tx('tms.tr.start')}</button> : null}
        {a.actions.includes('complete') ? <button type="button" className="fk-btn ghost sm" disabled={busy} onClick={() => go(() => posTeamTrainingApi.complete(a.id, { expectedVersion: a.version, completedOn: today }))} data-testid="training-complete">{tx('tms.tr.complete')}</button> : null}
        {a.actions.includes('cancel') ? <button type="button" className="fk-btn ghost sm" disabled={busy} onClick={() => { setCancel(a); setReason(''); }}>{tx('tms.tr.cancel')}</button> : null}</span> : null}</li>)}</ul>}
    {cancel ? <div className="tms-inline"><label className="fk-field">{tx('tms.tr.cancelWhy', { c: cancel.course })}<input className="fk-input" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <button type="button" className="fk-btn" disabled={busy || reason.trim().length < 5} onClick={() => go(async () => { await posTeamTrainingApi.cancel(cancel.id, { expectedVersion: cancel.version, reason: reason.trim() }); setCancel(null); })}>{tx('tms.tr.cancel')}</button>
      <button type="button" className="fk-btn ghost" onClick={() => setCancel(null)}>{tx('pos.close')}</button></div> : null}
    {d.canManage && d.configured ? <div className="tms-inline" data-testid="training-assign"><select className="fk-select" value={courseId} onChange={(e) => setCourseId(e.target.value)} aria-label={tx('tms.tr.course')} data-testid="training-course">
      <option value="">{tx('tms.tr.pickCourse')}</option>{((courses.data as { items?: any[] } | null)?.items ?? []).filter((c: any) => !open.has(c.id)).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <button type="button" className="fk-btn" disabled={busy || !courseId} onClick={() => go(async () => { await posTeamTrainingApi.assign({ memberId, courseId }); setCourseId(''); })} data-testid="training-assign-btn">{tx('tms.tr.assign')}</button></div> : null}
    <h3 className="fk-h3">{tx('tmm.certs')}</h3>
    {d.certifications.length === 0 ? <p className="fk-hint">{tx('tmm.noCerts')}</p> : <ul className="fk-list dense" data-testid="training-cert-list">{d.certifications.map((c: any) => <li key={c.kind + c.id} className="fk-li" data-testid="training-cert-row">
      <span className="fk-li-t">{c.name}<span className="fk-li-s">{c.issuer ?? '—'} · {c.expiresOn ? tx('tmm.expires', { d: fmtYmdSafe(c.expiresOn) }) : tx('tmm.noExpiry')}</span></span>
      <span className={'fk-chip ' + (c.verified ? 'ok' : 'warn')} data-testid="cert-verification">{tx('tms.ver.' + c.verification)}</span>
      <span className={'fk-chip ' + (CERT_TONE[c.state] ?? 'mut')}>{tx('tms.cert.' + c.state)}</span>
      {d.canVerify && !c.verified && c.verification === 'UNVERIFIED' ? <button type="button" className="fk-btn ghost sm" disabled={busy} data-testid="cert-verify"
        onClick={() => go(() => (c.kind === 'technician' ? posWorkforceApi.verifyCertification(String(d.technicianId), c.id, 'VERIFIED', tx('tms.tr.verifiedNote')) : posTeamTrainingApi.verifyCertification(c.id, { expectedVersion: c.version, decision: 'VERIFIED', note: tx('tms.tr.verifiedNote') })))}>{tx('tms.tr.verify')}</button> : null}</li>)}</ul>}
    <p className="fk-hint">{tx('tms.tr.completionRule')}</p>
    {d.canManage ? (!certOpen ? <button type="button" className="fk-btn ghost" onClick={() => setCertOpen(true)} data-testid="cert-add-open">{tx('tms.tr.addCert')}</button>
      : <fieldset className="tms-fs" data-testid="cert-add"><legend>{tx('tms.tr.addCert')}</legend><div className="tms-grid">
        <label className="fk-field">{tx('tms.tr.certName')}<input className="fk-input" value={cName} onChange={(e) => setCName(e.target.value)} data-testid="cert-name" /></label>
        <label className="fk-field">{tx('tms.tr.issuer')}<input className="fk-input" value={cIssuer} onChange={(e) => setCIssuer(e.target.value)} data-testid="cert-issuer" /></label>
        <label className="fk-field">{tx('tms.tr.expiresOn')}<input className="fk-input" type="date" min={today} value={cExp} onChange={(e) => setCExp(e.target.value)} /></label>
        <label className="fk-field">{tx('tms.tr.forTraining')}<select className="fk-select" value={cAsg} onChange={(e) => setCAsg(e.target.value)}><option value="">—</option>{d.assignments.map((a: any) => <option key={a.id} value={a.id}>{a.course}</option>)}</select></label></div>
        <button type="button" className="fk-btn primary" disabled={busy || cName.trim().length < 2} data-testid="cert-save"
          onClick={() => go(async () => { await posTeamTrainingApi.addCertification({ memberId, name: cName.trim(), ...(cIssuer.trim() ? { issuer: cIssuer.trim() } : {}), expiresOn: cExp || null, assignmentId: cAsg || null }); setCertOpen(false); setCName(''); setCIssuer(''); setCExp(''); setCAsg(''); })}>{tx('pos.save')}</button>
        <button type="button" className="fk-btn ghost" onClick={() => setCertOpen(false)}>{tx('pos.cancel')}</button></fieldset>) : null}
    {err ? <div className="fk-note bad" role="alert" data-testid="training-error"><span>{err}</span></div> : null}
  </div>;
}
