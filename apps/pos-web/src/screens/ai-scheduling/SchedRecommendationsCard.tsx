// SchedRecommendationsCard.tsx — the recommendation list with real server-side filters (status / type / date — the
// audit's `{query}` filter bug is fixed in the client), and "Suggest a better time" for one appointment: the server picks
// the target (or validates the one given), re-runs every hard rule and the simulation itself — a 422 lists the broken
// rules and nothing is stored. Clicking a row opens the detail (also reachable from the booking calendar via ?rec=).
import { useEffect, useState } from 'react';
import type { SchedRecommendation, SchedRecStatus, SchedRecType, SchedViolation } from '@aipowersalon/api-contracts/tenant';
import { posAiSchedulingOptimizerApi as api } from '../../api/posAiSchedulingOptimizerApi';
import {
  P, type SchedCardProps, card, cardHead, btnGold, btnGhost, input, muted, errText, okText, pill, hm, pretty, row,
  STATUS_LABEL, TYPE_LABEL, statusTone, schedErrorText, violationsOf,
} from './schedUi';
import { TechnicianPickerButton } from '../../components/TechnicianPickerButton';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { fmtTime } from '../../i18n/format';
import { codedText } from '../../i18n/coded-text';
import { schedViolationCoded } from '@aipowersalon/api-contracts/tenant';

export interface DayAppointment { appointmentId: string; customerName: string; startTime: string; technicianId?: string | null; status: string }

const clock = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? hm(iso) : fmtTime(d); };

export function SchedRecommendationsCard({ tick, can, techName, onChanged, selectedId, onSelect, date, appointments }: SchedCardProps & {
  selectedId: string | null; onSelect: (id: string | null) => void; date: string;
  appointments: DayAppointment[];
}) {
  const [status, setStatus] = useState<SchedRecStatus | ''>('');
  const [type, setType] = useState<SchedRecType | ''>('');
  const [onDate, setOnDate] = useState('');
  const [list, setList] = useState<{ items: SchedRecommendation[]; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // generate
  const [apptId, setApptId] = useState('');
  const [tDate, setTDate] = useState('');
  const [tTime, setTTime] = useState('');
  const [tTech, setTTech] = useState('');
  const [genBusy, setGenBusy] = useState(false);
  const [genMsg, setGenMsg] = useState<{ ok: boolean; text: string; violations?: SchedViolation[] } | null>(null);

  useEffect(() => {
    api.recommendations({ status: status || null, type: type || null, date: onDate || null, limit: 50 })
      .then((r) => { setList({ items: Array.isArray(r?.items) ? r.items : [], total: r?.total ?? 0 }); setErr(null); })
      .catch((e) => setErr(schedErrorText(e, 'ops.sched.err.recommendations')));
  }, [status, type, onDate, tick]);

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

  return (
    <section style={card} aria-label={tx('pos.recommendations')}>
      <div style={cardHead}>{tx('pos.recommendations')}{' '}{list ? <span style={muted}>({list.total})</span> : null}</div>
      <div style={{ ...row, marginBottom: 10 }}>
        <select aria-label={tx('pos.filter_by_status')} value={status} onChange={(e) => setStatus(e.target.value as SchedRecStatus | '')} style={input}>
          <option value="">{tx('pos.any_status')}</option>
          {(Object.keys(STATUS_LABEL) as SchedRecStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select aria-label={tx('pos.filter_by_type')} value={type} onChange={(e) => setType(e.target.value as SchedRecType | '')} style={input}>
          <option value="">{tx('pos.any_type')}</option>
          {(Object.keys(TYPE_LABEL) as SchedRecType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
        <input type="date" aria-label={tx('pos.filter_by_date')} value={onDate} onChange={(e) => setOnDate(e.target.value)} style={input} />
      </div>
      {err ? <div style={errText}>{err}</div> : !list ? <div style={muted}>{tx('pos.loading')}</div> : list.items.length === 0 ? (
        <div style={muted}>{tx('pos.no_recommendations')}{status || type || onDate ? tx('pos.match_these_filters') : tx('pos.right_now_the_optimizer_only_suggests_1om4')}.</div>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {list.items.map((r) => {
            const tone = statusTone(r.status);
            const p = r.proposedState;
            return (
              <button key={r.id} data-testid="sched-rec-row" aria-pressed={selectedId === r.id} onClick={() => onSelect(selectedId === r.id ? null : r.id)}
                style={{ ...btnGhost, height: 'auto', padding: '8px 10px', textAlign: 'left', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderColor: selectedId === r.id ? '#A96F22' : undefined }}>
                <strong>{TYPE_LABEL[r.type] ?? pretty(r.type)}</strong>
                <span style={pill(tone.bg, tone.fg)}>{STATUS_LABEL[r.status] ?? pretty(r.status)}</span>
                {p ? <span style={muted}>→ {p.date} {hm(p.startTime)} · {techName(p.technicianId)}</span> : null}
                {r.requiresCustomerApproval ? <span style={pill('#FBEEDD', '#9B6B1E')}>{tx('pos.customer_approval')}</span> : null}
                {r.automated ? <span style={pill('#EEF0F7', '#4B5A8A')}>{tx('pos.automated')}</span> : null}
                <span style={{ ...muted, marginLeft: 'auto' }}>{Math.round((r.confidence ?? 0) * 100)}%</span>
              </button>
            );
          })}
        </div>
      )}

      {can(P.generate) && (
        <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 12 }} aria-label={tx('pos.suggest_a_better_time')}>
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
