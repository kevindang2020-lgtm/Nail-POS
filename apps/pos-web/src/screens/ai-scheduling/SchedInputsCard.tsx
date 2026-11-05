// SchedInputsCard.tsx — "Time off & locks": the inputs the hard-constraint gate reads, editable here.
//  • Technician time off (approved time off is a hard block; writes need technicians.edit).
//  • Appointment locks: a locked appointment is never moved by the optimizer (checked-in / deposit-paid ones are locked
//    automatically server-side). Lock / unlock need ai_scheduling.review.
//  • Per-service setup / cleanup buffers and group capacity (ai_scheduling.configure).
import { useEffect, useState } from 'react';
import type { SchedServiceProfile, SchedTimeOff } from '@aipowersalon/api-contracts/tenant';
import { posAiSchedulingOptimizerApi as api } from '../../api/posAiSchedulingOptimizerApi';
import { P, type SchedCardProps, card, cardHead, btnGold, btnGhost, btnDanger, input, muted, errText, okText, pill, when, row, table, th, td, schedErrorText, pretty } from './schedUi';
import { fmtTime } from '../../i18n/format';
import type { DayAppointment } from './SchedRecommendationsCard';
import { TechnicianPickerButton } from '../../components/TechnicianPickerButton';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

const clock = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? iso : fmtTime(d); };

export function SchedInputsCard({ tick, can, techName, onChanged, services, appointments, lockedIds }: SchedCardProps & {
  services: { serviceId: string; name: string }[];
  appointments: DayAppointment[]; lockedIds: Set<string>;
}) {
  const [timeOff, setTimeOff] = useState<SchedTimeOff[] | null>(null);
  const [toErr, setToErr] = useState<string | null>(null);
  const [form, setForm] = useState({ technicianId: '', startsAt: '', endsAt: '', reason: '' });
  const [profiles, setProfiles] = useState<Record<string, SchedServiceProfile>>({});
  const [lockReason, setLockReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [reload, setReload] = useState(0);
  // locked = staff locks (GET locks) ∪ the calendar's computed locks (checked in, deposit paid, …) passed in as lockedIds
  const [manualLocks, setManualLocks] = useState<Set<string>>(() => new Set());
  const [locked, setLocked] = useState<Set<string>>(lockedIds);
  useEffect(() => setLocked(new Set([...lockedIds, ...manualLocks])), [lockedIds, manualLocks]);

  useEffect(() => {
    api.timeOff().then((r) => { setTimeOff(r); setToErr(null); }).catch((e) => setToErr(schedErrorText(e, 'ops.sched.err.timeOff')));
    api.locks().then((ls) => setManualLocks(new Set(ls.map((l) => l.appointmentId)))).catch(() => setManualLocks(new Set()));
    api.serviceProfiles().then((ps) => setProfiles(Object.fromEntries(ps.map((p) => [p.serviceId, p])))).catch(() => setProfiles({}));
  }, [tick, reload]);

  const doIt = async (fn: () => Promise<unknown>, ok: string, after?: () => void) => {
    setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); after?.(); onChanged(); setReload((x) => x + 1); }
    catch (e) { setMsg({ ok: false, text: schedErrorText(e) }); }
  };
  const addTimeOff = () => {
    if (!form.technicianId || !form.startsAt || !form.endsAt) { setMsg({ ok: false, text: tx('pos.choose_the_technician_start_and_end') }); return; }
    const s = new Date(form.startsAt), e = new Date(form.endsAt);
    if (!(e > s)) { setMsg({ ok: false, text: tx('pos.the_end_must_be_after_the_gl48') }); return; }
    void doIt(() => api.addTimeOff({ technicianId: form.technicianId, startsAt: s.toISOString(), endsAt: e.toISOString(), reason: form.reason.trim() || null }), tx('ops.sched.ok.timeOffAdded'), () => setForm({ technicianId: '', startsAt: '', endsAt: '', reason: '' }));
  };
  const setProfile = (serviceId: string, k: 'setupMin' | 'cleanupMin' | 'maxGroupSize', v: string) => setProfiles((p) => {
    const cur = p[serviceId] ?? { serviceId, setupMin: 0, cleanupMin: 0, maxGroupSize: null };
    const n = v === '' ? (k === 'maxGroupSize' ? null : 0) : Math.max(0, Math.round(Number(v) || 0));
    return { ...p, [serviceId]: { ...cur, [k]: n } };
  });
  const canTimeOff = can('technicians.edit');
  const canLock = can(P.review);
  const canConfigure = can(P.configure);

  return (
    <section style={{ ...card, display: 'grid', gap: 14 }} aria-label={tx('pos.time_off_and_locks')}>
      <div style={cardHead}>{tx('pos.time_off_locks_service_buffers')}</div>
      {msg ? <div role={msg.ok ? 'status' : 'alert'} style={msg.ok ? okText : errText}>{msg.text}</div> : null}

      <div aria-label={tx('pos.time_off')}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{tx('pos.technician_time_off')}</div>
        {toErr ? <div style={errText}>{toErr}</div> : !timeOff ? <div style={muted}>{tx('pos.loading')}</div> : timeOff.length === 0 ? <div style={muted}>{tx('pos.no_time_off_recorded')}</div> : (
          <table style={table}><thead><tr><th style={th}>{tx('pos.technician')}</th><th style={th}>{tx('pos.from')}</th><th style={th}>{tx('pos.to_2')}</th><th style={th}>{tx('pos.status')}</th><th style={th} /></tr></thead>
            <tbody>{timeOff.map((t) => (
              <tr key={t.id} data-testid="sched-timeoff"><td style={td}>{techName(t.technicianId)}{t.reason ? <div style={muted}>{t.reason}</div> : null}</td><td style={td}>{when(t.startsAt)}</td><td style={td}>{when(t.endsAt)}</td>
                <td style={td}><span style={pill('#F3ECE1', '#6C6965')}>{pretty(t.status)}</span></td>
                <td style={td}>{canTimeOff && t.status !== 'cancelled' ? <button style={btnDanger} onClick={() => doIt(() => api.removeTimeOff(t.id), tx('ops.sched.ok.timeOffRemoved'))}>{tx('pos.remove')}</button> : null}</td></tr>
            ))}</tbody></table>
        )}
        {canTimeOff && (
          <div style={{ ...row, marginTop: 6 }}>
            <TechnicianPickerButton value={form.technicianId} emptyLabel={tx('pos.technician_2')} ariaLabel={tx('pos.time_off_technician')}
              onChange={(id) => setForm({ ...form, technicianId: id })} />
            <input type="datetime-local" aria-label={tx('pos.time_off_from')} value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} style={input} />
            <input type="datetime-local" aria-label={tx('pos.time_off_to')} value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} style={input} />
            <input aria-label={tx('pos.time_off_reason')} placeholder={tx('pos.reason_optional')} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} style={input} />
            <button style={btnGold} onClick={addTimeOff}>{tx('pos.add_time_off')}</button>
          </div>
        )}
      </div>

      <div aria-label={tx('pos.appointment_locks')}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{tx('pos.appointment_locks')}</div>
        <div style={muted}>{tx('pos.a_locked_appointment_is_never_moved_1iup')}</div>
        {canLock ? <input aria-label={tx('pos.lock_reason')} placeholder={tx('pos.why_lock_it_optional')} value={lockReason} onChange={(e) => setLockReason(e.target.value)} style={{ ...input, margin: '6px 0', width: '100%' }} /> : null}
        {appointments.length === 0 ? <div style={muted}>{tx('pos.no_appointments_on_this_day')}</div> : (
          <div style={{ display: 'grid', gap: 4 }}>{appointments.map((a) => (
            <div key={a.appointmentId} style={{ ...row, fontSize: 12.5 }} data-testid="sched-lock-row">
              <span style={{ flex: 1 }}>{a.customerName} · {clock(a.startTime)} · {techName(a.technicianId)}</span>
              {locked.has(a.appointmentId) ? <span style={pill('#F3ECE1', '#6C6965')}>{tx('pos.locked_3')}</span> : null}
              {canLock ? (locked.has(a.appointmentId)
                ? <button style={btnGhost} onClick={() => doIt(() => api.unlock(a.appointmentId), tx('ops.sched.ok.unlocked'), () => setLocked((s) => { const n = new Set(s); n.delete(a.appointmentId); return n; }))}>{tx('pos.unlock')}</button>
                : <button style={btnGhost} onClick={() => doIt(() => api.lock(a.appointmentId, lockReason.trim() || null), tx('ops.sched.ok.locked'), () => setLocked((s) => new Set(s).add(a.appointmentId)))}>{tx('pos.lock')}</button>) : null}
            </div>
          ))}</div>
        )}
      </div>

      <div aria-label={tx('pos.service_buffers')}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{tx('pos.service_setup_cleanup_group_size')}</div>
        {services.length === 0 ? <div style={muted}>{tx('pos.no_services_loaded')}</div> : (
          <table style={table}><thead><tr><th style={th}>{tx('pos.service_3')}</th><th style={th}>{tx('pos.setup_min')}</th><th style={th}>{tx('pos.cleanup_min')}</th><th style={th}>{tx('pos.max_group')}</th><th style={th} /></tr></thead>
            <tbody>{services.map((s) => {
              const p = profiles[s.serviceId];
              return (
                <tr key={s.serviceId}>
                  <td style={td}>{s.name}</td>
                  <td style={td}><input aria-label={tx('pos.name_setup_minutes', { name: String(s.name) })} type="number" min={0} disabled={!canConfigure} value={p?.setupMin ?? 0} onChange={(e) => setProfile(s.serviceId, 'setupMin', e.target.value)} style={{ ...input, width: 70 }} /></td>
                  <td style={td}><input aria-label={tx('pos.name_cleanup_minutes', { name: String(s.name) })} type="number" min={0} disabled={!canConfigure} value={p?.cleanupMin ?? 0} onChange={(e) => setProfile(s.serviceId, 'cleanupMin', e.target.value)} style={{ ...input, width: 70 }} /></td>
                  <td style={td}><input aria-label={tx('pos.name_max_group', { name: String(s.name) })} type="number" min={1} disabled={!canConfigure} value={p?.maxGroupSize ?? ''} placeholder="—" onChange={(e) => setProfile(s.serviceId, 'maxGroupSize', e.target.value)} style={{ ...input, width: 70 }} /></td>
                  <td style={td}>{canConfigure ? <button style={btnGhost} onClick={() => { const v = profiles[s.serviceId] ?? { setupMin: 0, cleanupMin: 0, maxGroupSize: null }; void doIt(() => api.saveServiceProfile(s.serviceId, { setupMin: v.setupMin, cleanupMin: v.cleanupMin, maxGroupSize: v.maxGroupSize }), tx('ops.sched.ok.profileSaved', { name: s.name })); }}>{tx('pos.save_2')}</button> : null}</td>
                </tr>
              );
            })}</tbody></table>
        )}
      </div>
    </section>
  );
}
