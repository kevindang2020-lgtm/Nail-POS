// SchedFindTimeCard.tsx — "Find a time": ranked, rule-checked options for chosen services (the same `findOptions` the AI
// receptionist and Reception Copilot use). Each option shows its per-service blocks and plain reasons; a rule-based
// fallback (thin signal) is labelled as such. "Hold" keeps the top option for the customer while staff book it; the hold
// can be released. Booking itself still happens in the booking calendar.
import { useState } from 'react';
import type { SchedOptionsResponse } from '@aipowersalon/api-contracts/tenant';
import { posAiSchedulingOptimizerApi as api } from '../../api/posAiSchedulingOptimizerApi';
import { P, type Can, card, cardHead, btnGold, btnGhost, input, muted, errText, okText, pill, hm, when, row, schedErrorText } from './schedUi';
import { TechnicianPickerButton } from '../../components/TechnicianPickerButton';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { codedText } from '../../i18n/coded-text';

export function SchedFindTimeCard({ can, date, services }: {
  can: Can; date: string; services: { serviceId: string; name: string; durationMinutes?: number }[];
}) {
  const [d, setD] = useState(date);
  const [chosen, setChosen] = useState<string[]>([]);
  const [time, setTime] = useState('');
  const [pref, setPref] = useState('');
  const [group, setGroup] = useState(1);
  const [res, setRes] = useState<SchedOptionsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const search = async (hold: boolean) => {
    if (!chosen.length) { setMsg({ ok: false, text: tx('pos.choose_at_least_one_service') }); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await api.options({ date: d, serviceIds: chosen, preferredTime: time || null, preferredTechnicianId: pref || null, groupSize: group > 1 ? group : null, limit: 5, hold: hold ? { channel: 'pos' } : null });
      setRes(r);
      if (hold) setMsg(r.hold ? { ok: true, text: tx('pos.held_starttime_until_expiresat', { startTime: String(hm(r.options[0]?.startTime)), expiresAt: String(when(r.hold.expiresAt)) }) } : { ok: false, text: tx('pos.nothing_could_be_held') });
    } catch (e) { setMsg({ ok: false, text: schedErrorText(e, 'ops.sched.err.findOptions') }); } finally { setBusy(false); }
  };
  const release = async () => {
    if (!res?.hold) return;
    try { await api.releaseHold(res.hold.holdId); setRes({ ...res, hold: null }); setMsg({ ok: true, text: tx('pos.hold_released') }); }
    catch (e) { setMsg({ ok: false, text: schedErrorText(e, 'ops.sched.err.releaseHold') }); }
  };
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  return (
    <section style={card} aria-label={tx('pos.find_a_time')}>
      <div style={cardHead}>{tx('pos.find_a_time')}</div>
      <div style={row}>
        <input type="date" aria-label={tx('pos.date')} value={d} onChange={(e) => setD(e.target.value)} style={input} />
        <input type="time" aria-label={tx('pos.preferred_time')} value={time} onChange={(e) => setTime(e.target.value)} style={input} />
        <TechnicianPickerButton value={pref} emptyLabel={tx('pos.no_preference')} anyLabel={tx('pos.no_preference')} ariaLabel={tx('pos.preferred_technician')}
          date={d || date} onChange={(id) => setPref(id)} />
        <label style={{ ...muted, display: 'flex', alignItems: 'center', gap: 4 }}>{tx('pos.guests')}{' '}<input aria-label={tx('pos.group_size')} type="number" min={1} max={10} value={group} onChange={(e) => setGroup(Math.max(1, Number(e.target.value) || 1))} style={{ ...input, width: 60 }} /></label>
      </div>
      <div style={{ ...row, marginTop: 8 }} aria-label={tx('pos.services')}>
        {services.length === 0 ? <span style={muted}>{tx('pos.no_services_loaded')}</span> : services.map((s) => (
          <label key={s.serviceId} style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={chosen.includes(s.serviceId)} onChange={() => toggle(s.serviceId)} />{s.name}
          </label>
        ))}
      </div>
      <div style={{ ...row, marginTop: 8 }}>
        <button style={btnGold} disabled={busy} onClick={() => search(false)}>{busy ? tx('pos.searching_2') : tx('pos.find_options')}</button>
        {can(P.generate) ? <button style={btnGhost} disabled={busy} onClick={() => search(true)}>{tx('pos.find_hold_the_best')}</button> : null}
        {res?.hold ? <button style={btnGhost} onClick={release}>{tx('pos.release_hold')}</button> : null}
      </div>
      {msg ? <div role={msg.ok ? 'status' : 'alert'} style={{ ...(msg.ok ? okText : errText), marginTop: 6 }}>{msg.text}</div> : null}
      {res && (
        <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
          {!res.forecastAvailable ? <div style={muted}>{tx('pos.no_demand_forecast_for_this_day_ncqx')}</div> : null}
          {res.options.length === 0 ? <div style={muted}>{tx('pos.no_time_fits_every_rule_on_1j3u')}</div> : res.options.map((o, i) => (
            <div key={o.id} data-testid="sched-option" style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 8, fontSize: 12.5, background: '#fff' }}>
              <div style={row}>
                <strong>{hm(o.startTime)}–{hm(o.endTime)}</strong><span>{o.technicianName}</span>
                {i === 0 ? <span style={pill('#E4F0E7', '#3B6B47')}>{tx('pos.best')}</span> : null}
                {o.fallback ? <span style={pill('#F3ECE1', '#6C6965')}>{tx('pos.rule_based')}</span> : null}
                {res.hold?.optionId === o.id ? <span style={pill('#FBEEDD', '#9B6B1E')}>{tx('pos.held_2')}</span> : null}
                <span style={{ ...muted, marginLeft: 'auto' }}>{tx('pos.score_2')}{' '}{o.score.toFixed(2)}</span>
              </div>
              {o.blocks.length > 1 ? <div style={muted}>{o.blocks.map((b) => `${services.find((s) => s.serviceId === b.serviceId)?.name ?? tx('pos.service_3')} ${hm(b.startTime)}–${hm(b.endTime)}`).join(' → ')}</div> : null}
              {o.reasons.length ? <div style={muted}>{(o.reasonCodes && o.reasonCodes.length === o.reasons.length ? o.reasonCodes.map((c, i) => codedText({ code: 'SCHED_REASON.' + c }, o.reasons[i])) : o.reasons).join(' · ')}</div> : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
