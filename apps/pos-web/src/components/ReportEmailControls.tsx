// ReportEmailControls.tsx — Daily Summary "Email Report" and "Schedule Report" (batch 9 decision 1, Nov 10 2026). Both act on
// the signed-in staff member only: the report goes to THEIR account address, and only they can put themselves on a schedule.
// Every outcome is said as it is: sent / recorded in a test environment / e-mail not set up / failed — never "sent" when not.
import { useCallback, useEffect, useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posReportsApi } from '../api/posReportsApi';
import { fmtInZone } from '../i18n/format';
import type { ReportEmailState, ReportEmailSendResult } from '@aipowersalon/api-contracts/tenant';

type MailSetup = ReportEmailState;
const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);
const hourLabel = (hh: string) => hh;   // the salon's clock, 24-hour (no AM/PM words to translate)
const errText = (e: unknown) => String((e as { message?: string })?.message || tx('rpt.mail.failed'));

export function ReportEmailControls({ range, onNote }: { range: { from: string; to: string } | null; onNote: (t: string) => void }) {
  const [st, setSt] = useState<MailSetup | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [freq, setFreq] = useState<'daily' | 'weekly'>('daily');
  const [hour, setHour] = useState('07:00');
  const load = useCallback(async () => {
    try {
      const s = (await posReportsApi.deliveryState()) as MailSetup;
      setSt(s);
      if (s.subscription) { setFreq(s.subscription.frequency); setHour(s.subscription.sendAt); }
    } catch (e) { setSt(null); onNote(errText(e)); }
  }, [onNote]);
  useEffect(() => { void load(); }, [load]);

  const outcome = (status: string) => tx('rpt.mail.status.' + status);
  const emailNow = async () => {
    if (!range) return;
    setBusy(true);
    try { const r = (await posReportsApi.emailNow(range.from, range.to)) as ReportEmailSendResult; onNote(tx('rpt.mail.nowResult', { to: st?.email ?? '', result: outcome(r.status) })); await load(); }
    catch (e) { onNote(errText(e)); }
    finally { setBusy(false); }
  };
  const save = async (on: boolean) => {
    setBusy(true);
    try { setSt((on ? await posReportsApi.schedule(freq, hour) : await posReportsApi.unschedule()) as MailSetup); onNote(on ? tx('rpt.mail.scheduledOn') : tx('rpt.mail.scheduledOff')); }
    catch (e) { onNote(errText(e)); }
    finally { setBusy(false); }
  };

  const canSend = !!st?.canSend && !!st?.hasEmail;
  const why = !st ? null : !st.canSend ? tx('rpt.mail.noPermission') : !st.hasEmail ? tx('rpt.mail.noEmail') : null;
  const sub = st?.subscription;
  return (
    <>
      <button className="btn ghost w-fit whitespace-nowrap" data-testid="rpt-email-now" disabled={busy || !canSend || !range} title={why ?? undefined} onClick={emailNow}>{tx('pos.email_report')}</button>
      <button className="btn ghost w-fit whitespace-nowrap" data-testid="rpt-schedule" aria-expanded={open} disabled={!st} onClick={() => setOpen((o) => !o)}>
        {tx('pos.schedule_report')}{sub?.active ? ' ✓' : ''}
      </button>
      {open && st ? (
        <div style={{ gridColumn: '1 / -1', border: '1px solid var(--aps-line)', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="rpt-schedule-panel">
          <div className="s">{st.email ? tx('rpt.mail.to', { to: st.email }) : tx('rpt.mail.noEmail')}</div>
          {st.sender !== 'delivers' ? <div className="s" style={{ color: 'var(--aps-orange)' }} data-testid="rpt-mail-sender">{tx('rpt.mail.sender.' + st.sender)}</div> : null}
          {!st.scheduleRunning ? <div className="s" style={{ color: 'var(--aps-orange)' }} data-testid="rpt-mail-not-running">{tx('rpt.mail.notRunning')}</div> : null}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <select className="input" style={{ minHeight: 44 }} aria-label={tx('rpt.mail.frequency')} data-testid="rpt-mail-frequency" value={freq} onChange={(e) => setFreq(e.target.value as 'daily' | 'weekly')}>
              <option value="daily">{tx('rpt.mail.daily')}</option><option value="weekly">{tx('rpt.mail.weekly')}</option>
            </select>
            <select className="input" style={{ minHeight: 44 }} aria-label={tx('rpt.mail.hour')} data-testid="rpt-mail-hour" value={hour} onChange={(e) => setHour(e.target.value)}>
              {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
            <button className="btn" style={{ minHeight: 44 }} data-testid="rpt-mail-on" disabled={busy || !canSend} title={why ?? undefined} onClick={() => save(true)}>{sub?.active ? tx('rpt.mail.update') : tx('rpt.mail.turnOn')}</button>
            {sub?.active ? <button className="btn ghost" style={{ minHeight: 44 }} data-testid="rpt-mail-off" disabled={busy} onClick={() => save(false)}>{tx('rpt.mail.turnOff')}</button> : null}
          </div>
          <div className="s">{sub?.active ? tx('rpt.mail.activeLine', { when: tx('rpt.mail.' + sub.frequency), hour: hourLabel(sub.sendAt) }) : tx('rpt.mail.consent')}</div>
          {st.deliveries.length ? (
            <ul style={{ margin: 0, paddingLeft: 16 }} data-testid="rpt-mail-log">
              {st.deliveries.slice(0, 5).map((d) => (
                <li key={d.id} className="s">{fmtInZone(d.createdAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {d.periodFrom === d.periodTo ? d.periodFrom : `${d.periodFrom} – ${d.periodTo}`} · {tx('rpt.mail.kind.' + d.kind)} · {outcome(d.status)}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
