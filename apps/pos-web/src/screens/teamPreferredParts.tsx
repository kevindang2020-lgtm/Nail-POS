// teamPreferredParts.tsx — Team Management round 2A (TM-04, Four-Module Completion Guide §9.1, 30 Oct 2026): the optional
// PREFERRED TECHNICIAN of Find Qualified & Available Staff. The server (/pos/team-members-screen/preferred-check) checks her
// service mapping, branch, shift (one-date override › weekly template), breaks, blocked time, approved time off, chair-holding
// appointments and the full duration at the desired start (or her earliest valid start); the BOOKING ENGINE
// (/pos/booking/availability) must offer that same start too. She is shown first ONLY when both agree; otherwise the card says
// why and lists the qualified alternatives (each also confirmed against the engine's slots). Nothing is booked here: Open
// Booking hands over to the existing booking flow, which re-checks before it saves. The turn queue is never consulted or moved.
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posTeamMembersScreenApi } from '../api/posTeamScreensApi';
import { posBookingApi } from '../api/posBookingApi';
import { useLoad, StateBlock } from '../components/FinanceKit';
import { nf, hm12 } from './teamShared';

const REASON_ORDER = ['active', 'branch', 'qualified', 'past', 'shift', 'duration', 'breaks', 'time_off', 'blocked', 'appointments'];

/** the reason line for one failed check (pure, for the screen test too) */
export function reasonText(c: { key: string; detail?: any }): string {
  const d = c.detail ?? {};
  switch (c.key) {
    case 'qualified': return tx('tm2.pf.r.qualified', { s: (d.missing ?? []).join(', ') });
    case 'shift': return d.dayOff ? tx('tm2.pf.r.dayOff') : tx('tm2.pf.r.shift', { w: (d.windows ?? []).join(', ') || '—' });
    case 'duration': return tx('tm2.pf.r.duration', { m: nf(d.minutes), e: hm12(d.end) });
    case 'breaks': return tx('tm2.pf.r.breaks', { b: (d.breaks ?? []).join(', ') });
    case 'time_off': return tx('tm2.pf.r.timeOff', { r: (d.ranges ?? []).join(', ') });
    case 'blocked': return tx('tm2.pf.r.blocked', { r: (d.ranges ?? []).join(', ') });
    case 'appointments': return tx('tm2.pf.r.appointments', { a: (d.appointments ?? []).map((a: any) => `${hm12(a.start)}–${hm12(a.end)} (#${String(a.id).slice(0, 8)})`).join(', ') });
    default: return tx('tm2.pf.r.' + c.key);
  }
}

export function PreferredPicker({ value, onChange }: { value: string; onChange: (technicianId: string) => void }) {
  const list = useLoad(() => posTeamMembersScreenApi.directory({ pageSize: 100, sort: 'name' }), []);
  const providers = ((list.data as { items?: any[] } | null)?.items ?? []).filter((m: any) => m.isProvider && m.account !== 'archived');
  return (
    <label className="fk-field">{tx('tm2.pf.label')}
      <select className="fk-select" value={value} onChange={(e) => onChange(e.target.value)} data-testid="tf-preferred">
        <option value="">{tx('tm2.pf.none')}</option>{providers.map((m: any) => <option key={m.technicianId} value={m.technicianId}>{m.name}</option>)}
      </select></label>
  );
}

export function PreferredVerdict({ technicianId, date, time, serviceIds, engineSlots, onOpenMember, onBook }: {
  technicianId: string; date: string; time: string; serviceIds: string[]; engineSlots: Map<string, string[]> | null;
  onOpenMember: (id: string) => void; onBook: (technicianId: string, start: string) => void;
}) {
  const r = useLoad(() => Promise.all([posTeamMembersScreenApi.preferredCheck({ technicianId, date, time: time || undefined, serviceIds }), posBookingApi.availability({ date, serviceIds, technicianId })]),
    [technicianId, date, time, serviceIds.join(',')]);
  if (r.error) return <StateBlock error={r.error} onRetry={r.reload} />;
  if (!r.data) return <div className="fk-loading">{tx('pos.loading')}</div>;
  const [v, eng] = r.data as [any, { technicianId: string; slots: string[] }[]];
  const p = v.preferred; const mine = (Array.isArray(eng) ? eng : []).find((x) => x.technicianId === technicianId)?.slots ?? [];
  const engineOk = !!p.start && mine.includes(p.start);
  const valid = p.valid && engineOk;
  const failed = [...p.checks].filter((c: any) => !c.ok).sort((a: any, b: any) => REASON_ORDER.indexOf(a.key) - REASON_ORDER.indexOf(b.key));
  const alts = (v.alternatives ?? []).map((a: any) => ({ ...a, engine: engineSlots ? (engineSlots.get(a.technicianId) ?? []).includes(a.start) : null }))
    .filter((a: any) => a.engine !== false);   // an alternative the engine does not offer is never suggested
  return (
    <div className={'tm2-pf ' + (valid ? 'ok' : 'bad')} data-testid="tf-preferred-verdict" data-valid={valid ? '1' : '0'}>
      {valid ? <div className="tm2-pf-head"><b>{tx('tm2.pf.first', { n: p.name })}</b> <span>{hm12(p.start)} – {hm12(p.end)}</span>
          <span className="fk-li-s">{tx('tm2.pf.allChecks', { d: nf(v.durationMinutes) })}</span>
          <button type="button" className="fk-btn sm primary" onClick={() => onBook(technicianId, p.start)} data-testid="tf-preferred-book">{tx('tmm.fd.openBooking')}</button></div>
        : <>
          <div className="tm2-pf-head"><b>{tx('tm2.pf.notAvailable', { n: p.name, t: time ? hm12(time) : tx('tm2.pf.thatDay') })}</b>
            <button type="button" className="fk-link" onClick={() => onOpenMember(technicianId)}>{tx('pos.open_profile')}</button></div>
          <ul className="tm-reasons" data-testid="tf-preferred-why">{failed.map((c: any) => <li key={c.key}>{reasonText(c)}</li>)}
            {p.valid && !engineOk ? <li>{tx('tm2.pf.r.engine')}</li> : null}</ul>
          <h4 className="fk-h3">{time ? tx('tm2.pf.altsAt', { t: hm12(time) }) : tx('tm2.pf.alts')}</h4>
          {alts.length === 0 ? <p className="fk-hint" data-testid="tf-alt-none">{tx('tm2.pf.noAlts')}</p>
            : <ul className="fk-list dense" data-testid="tf-alternatives">{alts.map((a: any) => <li key={a.technicianId} className="fk-li" data-testid="tf-alt">
              <span className="fk-li-t">{a.name}<span className="fk-li-s">{hm12(a.start)} – {hm12(a.end)}{a.start === p.start || a.start === time ? ` · ${tx('tm2.pf.sameTime')}` : ''}{a.engine ? ` · ${tx('tm2.pf.engineOk')}` : ''}</span></span>
              <button type="button" className="fk-btn sm" onClick={() => onBook(a.technicianId, a.start)} data-testid="tf-alt-book">{tx('tmm.fd.openBooking')}</button></li>)}</ul>}
        </>}
      <p className="fk-hint">{tx('tm2.pf.rule')}</p>
    </div>
  );
}
