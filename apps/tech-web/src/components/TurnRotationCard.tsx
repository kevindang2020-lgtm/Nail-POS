// TurnRotationCard — Fair Turn Engine §94–96: the technician's place in the salon's walk-in TURN ROTATION.
// Reads GET /tech/turn-queue. The server decides what is visible (the salon's visibility setting: full team / position
// only / next few / private) — this card only renders what it is given, never infers other technicians' places, and never
// shows anyone else's money. "My summary" reads GET /tech/turn-queue/summary (own time / turns / earnings estimate).
import { useState } from 'react';
import { useScopedQuery, useStreamInvalidation } from '@aipowersalon/mobile-sdk';
import { techApi } from '../api/techApi';
import { useTechStream } from '../lib/useTechStream';
import { QUEUE_FILTER } from '../lib/techRelevance';
import { money2, clock } from '../lib/tech';

const STATUS_TEXT: Record<string, string> = {
  READY: 'Ready for the next walk-in', NEXT_UP: 'You are next up', ASSIGNED: 'Assigned to a guest', SERVING: 'With a guest', BREAK: 'On break',
  HOLD: 'On hold', UNAVAILABLE: 'Unavailable', CLOCKED_OUT: 'Clocked out', CLOCKED_IN: 'Clocked in', APPOINTMENT_SOON: 'Appointment soon',
  ASSIGNMENT_OFFERED: 'A guest is being offered to you', OFF_SHIFT: 'Off shift',
};
const turns = (units: number | null | undefined) => ((units ?? 0) / 100).toFixed(2).replace(/\.00$/, '');
const mins = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;

export function TurnRotationCard() {
  const tq = useScopedQuery({ key: ['tech', 'turn-queue'], fn: () => techApi.turnQueue(), persist: true });
  useTechStream(useStreamInvalidation([['tech', 'turn-queue']]), undefined, QUEUE_FILTER);
  const [period, setPeriod] = useState<null | 'day' | 'week' | 'month'>(null);
  const sq = useScopedQuery({ key: ['tech', 'turn-summary', period ?? 'none'], fn: () => techApi.turnSummary(period ?? 'day'), enabled: period != null });
  const v = tq.data;
  if (!v) return tq.isError ? <div className="tech-card tech-muted" style={{ marginBottom: 12, fontSize: 12.5 }} role="status">Your turn rotation could not be loaded.</div> : null;
  const me = v.me;
  const s: any = period ? sq.data : null;
  return (
    <section className="tech-card" aria-label="Turn rotation" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="tech-avatar" style={{ background: 'var(--tech-primary-light)', color: 'var(--tech-primary-dark)', fontWeight: 800 }}>{v.myRank != null ? `#${v.myRank}` : '—'}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="tech-label" style={{ color: 'var(--tech-primary-dark)' }}>Walk-in rotation</div>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>
            {v.myStatus == null ? 'You are not in today’s rotation.' : v.myRank != null ? `#${v.myRank}${v.queueLength != null ? ` of ${v.queueLength}` : ''} · ${STATUS_TEXT[v.myStatus] ?? v.myStatus}` : (STATUS_TEXT[v.myStatus] ?? v.myStatus)}
          </div>
          {me ? <div className="tech-muted" style={{ fontSize: 12 }}>Turns today {turns(me.turnsToday)}{me.inProgressTurns ? ` (+${turns(me.inProgressTurns)} in progress)` : ''} · {me.walkInsToday} walk-ins · {me.appointmentsToday} appointments{me.nextAppointmentAt ? ` · next appt ${clock(me.nextAppointmentAt)}` : ''}</div> : null}
          {me?.holdReason ? <div className="tech-muted" style={{ fontSize: 12 }}>Hold: {me.holdReason}</div> : null}
        </div>
      </div>
      {v.team.length ? (
        <ol aria-label="Team rotation" style={{ margin: '10px 0 0', paddingLeft: 20, fontSize: 12.5 }}>
          {v.team.map((t) => <li key={t.rank + (t.name ?? '')} style={{ fontWeight: t.isMe ? 800 : 500 }}>{t.isMe ? 'You' : (t.name ?? 'Technician')} · {STATUS_TEXT[t.status] ?? t.status}</li>)}
        </ol>
      ) : null}
      {v.myEarningsToday ? <div className="tech-muted" style={{ fontSize: 12, marginTop: 8 }}>Estimated earnings today {money2(v.myEarningsToday.estimatedEarningsCents)} · estimate, not a paycheck</div> : null}
      <div className="tech-seg" style={{ marginTop: 10 }}>
        {(['day', 'week', 'month'] as const).map((p) => <button key={p} className={period === p ? 'sel' : ''} aria-pressed={period === p} onClick={() => setPeriod(period === p ? null : p)}>My {p === 'day' ? 'day' : p === 'week' ? 'week' : 'month'}</button>)}
      </div>
      {period && sq.isError ? <div className="tech-muted" role="status" style={{ fontSize: 12, marginTop: 8 }}>Your summary could not be loaded.</div> : null}
      {period && !s && !sq.isError ? <div className="tech-muted" style={{ fontSize: 12, marginTop: 8 }}>Loading your summary…</div> : null}
      {s ? (
        <dl aria-label="My summary" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 12px', fontSize: 12.5, margin: '10px 0 0' }}>
          <dt className="tech-muted">Clocked</dt><dd style={{ margin: 0 }}>{mins(s.time.clockedMinutes)} (breaks paid {s.time.paidBreakMinutes}m / unpaid {s.time.unpaidBreakMinutes}m)</dd>
          <dt className="tech-muted">Service time</dt><dd style={{ margin: 0 }}>{mins(s.time.serviceMinutes)}</dd>
          <dt className="tech-muted">Turns</dt><dd style={{ margin: 0 }}>{turns(s.turns.turnUnits)} ({s.turns.fullTurns} full, {s.turns.partialTurns} partial)</dd>
          <dt className="tech-muted">Walk-ins</dt><dd style={{ margin: 0 }}>{s.walkIns.completed} completed · {s.walkIns.requested} requested you</dd>
          <dt className="tech-muted">Appointments</dt><dd style={{ margin: 0 }}>{s.appointments.completed} completed of {s.appointments.scheduled}</dd>
          {s.money ? (<><dt className="tech-muted">Estimated earnings</dt><dd style={{ margin: 0 }}>{money2(s.money.estimatedEarningsCents)} (tips {money2(s.money.tipsCents)}) · {s.money.status}</dd></>) : null}
        </dl>
      ) : null}
    </section>
  );
}
