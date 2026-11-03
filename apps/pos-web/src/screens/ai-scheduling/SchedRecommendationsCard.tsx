// SchedRecommendationsCard.tsx — "Suggest a better time" for one appointment. Scheduling Optimizer guide (Nov 2026): the
// list that lived here (status / type / one date, first 50 rows) is replaced by SchedQueueCard over center/recommendations
// (search, status groups, which date, presets + range, numbered pages, stale marks). The server picks
// the target (or validates the one given), re-runs every hard rule and the simulation itself — a 422 lists the broken
// rules and nothing is stored. Clicking a row opens the detail (also reachable from the booking calendar via ?rec=).
import { useState } from 'react';
import type { SchedViolation } from '@aipowersalon/api-contracts/tenant';
import { posAiSchedulingOptimizerApi as api } from '../../api/posAiSchedulingOptimizerApi';
import { P, type SchedCardProps, card, cardHead, btnGold, input, muted, errText, okText, hm, row, schedErrorText, violationsOf } from './schedUi';
import { TechnicianPickerButton } from '../../components/TechnicianPickerButton';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { fmtTime } from '../../i18n/format';
import { codedText } from '../../i18n/coded-text';
import { schedViolationCoded } from '@aipowersalon/api-contracts/tenant';

export interface SchedDayAppointment { appointmentId: string; customerName: string; startTime: string; technicianId?: string | null; status: string }

const clock = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? hm(iso) : fmtTime(d); };

export function SchedRecommendationsCard({ can, techName, onChanged, onSelect, date, appointments }: SchedCardProps & {
  selectedId: string | null; onSelect: (id: string | null) => void; date: string;
  appointments: SchedDayAppointment[];
}) {
  // generate
  const [apptId, setApptId] = useState('');
  const [tDate, setTDate] = useState('');
  const [tTime, setTTime] = useState('');
  const [tTech, setTTech] = useState('');
  const [genBusy, setGenBusy] = useState(false);
  const [genMsg, setGenMsg] = useState<{ ok: boolean; text: string; violations?: SchedViolation[] } | null>(null);

  const generate = async () => {
    if (!apptId) { setGenMsg({ ok: false, text: tx('pos.pick_an_appointment_first') }); return; }
    setGenBusy(true); setGenMsg(null);
    const target = tDate || tTime || tTech ? { date: tDate || null, startTime: tTime || null, technicianId: tTech || null } : null;
    try {
      const r = await api.generate({ appointmentId: apptId, target });
      setGenMsg({ ok: true, text: tx('pos.suggestion_created_review_it_below') });
      onChanged();
      if (r?.recommendation?.id) onSelect(r.recommendation.id);
    } catch (e) {
      setGenMsg({ ok: false, text: schedErrorText(e, 'ops.sched.err.create'), violations: violationsOf(e) });
    } finally { setGenBusy(false); }
  };

  if (!can(P.generate)) return null;
  return (
    <section style={card} aria-label={tx('pos.suggest_a_better_time')}>
      <div style={cardHead}>{tx('pos.suggest_a_better_time')}</div>
      {can(P.generate) && (
        <div aria-label={tx('pos.suggest_a_better_time')}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{tx('pos.suggest_a_better_time_for_an_jr45')}{date})</div>
          <div style={row}>
            <select aria-label={tx('pos.appointment_3')} value={apptId} onChange={(e) => setApptId(e.target.value)} style={{ ...input, minWidth: 200 }}>
              <option value="">{tx('pos.choose_an_appointment')}</option>
              {appointments.filter((a) => !['cancelled', 'no_show', 'completed'].includes(a.status)).map((a) => (
                <option key={a.appointmentId} value={a.appointmentId}>{a.customerName} · {clock(a.startTime)} · {techName(a.technicianId)}</option>
              ))}
            </select>
            <input type="date" aria-label={tx('pos.target_date_optional')} value={tDate} onChange={(e) => setTDate(e.target.value)} style={input} />
            <input type="time" aria-label={tx('pos.target_time_optional')} value={tTime} onChange={(e) => setTTime(e.target.value)} style={input} />
            <TechnicianPickerButton value={tTech} emptyLabel={tx('pos.any_technician')} anyLabel={tx('pos.any_technician')} ariaLabel={tx('pos.target_technician_optional')}
              date={tDate || date} onChange={(id) => setTTech(id)} />
            <button style={btnGold} disabled={genBusy} onClick={generate}>{genBusy ? tx('pos.checking') : tx('pos.suggest')}</button>
          </div>
          <div style={{ ...muted, marginTop: 4 }}>{tx('pos.leave_the_target_empty_and_the_1q0p')}</div>
          {genMsg ? (
            <div role={genMsg.ok ? 'status' : 'alert'} style={{ ...(genMsg.ok ? okText : errText), marginTop: 6 }}>
              {genMsg.text}
              {genMsg.violations?.length ? <ul style={{ margin: '4px 0 0', paddingLeft: 18 }} aria-label={tx('pos.broken_rules')}>{genMsg.violations.map((v, i) => <li key={i}>{codedText(schedViolationCoded(v), v.message)}</li>)}</ul> : null}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
