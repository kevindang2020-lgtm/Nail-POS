import { useCallback, useEffect, useState } from 'react';
import { techApi, type TechClockView } from '../api/techApi';
import { useTechStream } from '../lib/useTechStream';
import { clock } from '../lib/tech';

const isClockedIn = (v: TechClockView) => v.state === 'clocked_in';
const hours = (h: number) => {
  const m = Math.round((h || 0) * 60);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};

interface TimeClockCardProps {
  ready?: boolean;
}

export function TimeClockCard({ ready = true }: TimeClockCardProps) {
  const [v, setV] = useState<TechClockView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await techApi.timeClock();
      setV(res);
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useTechStream(load);

  // Show skeleton if dashboard is still loading
  if (!ready || (loading && !v && !unavailable)) {
    return (
      <div className="tech-card" style={{ marginBottom: 14, padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="tech-skel" style={{ width: 70, height: 12, marginBottom: 6 }} />
            <div className="tech-skel" style={{ width: 115, height: 20 }} />
          </div>
          <div className="tech-skel" style={{ width: 105, height: 38, borderRadius: 10, flexShrink: 0 }} />
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 10,
            paddingTop: 8,
            borderTop: '1px solid rgba(0,0,0,0.06)'
          }}
        >
          <div className="tech-skel" style={{ width: 90, height: 12 }} />
          <div className="tech-skel" style={{ width: 80, height: 12 }} />
        </div>
      </div>
    );
  }

  const inNow = v ? isClockedIn(v) : false;

  const act = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const next = inNow ? await techApi.clockOut() : await techApi.clockIn();
      setV(next);
      setMsg({
        ok: true,
        text: isClockedIn(next)
          ? `Clocked in at ${clock(next.clockedInAt)}.`
          : `Clocked out at ${clock(next.lastClockOutAt)}.`
      });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Could not update the time clock.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tech-card" style={{ marginBottom: 14, padding: '14px 16px' }} data-testid="time-clock-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="tech-label" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Time Clock
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                backgroundColor: inNow ? '#34C759' : '#8E8E93',
                display: 'inline-block',
                flexShrink: 0,
                boxShadow: inNow ? '0 0 6px rgba(52, 199, 89, 0.6)' : 'none'
              }}
            />
            <span style={{ fontWeight: 800, fontSize: 16, color: 'var(--tech-text, #1C1C1E)' }}>
              {inNow ? 'Clocked In' : 'Clocked Out'}
            </span>
          </div>
        </div>

        <button
          onClick={act}
          disabled={busy}
          style={{
            flexShrink: 0,
            minWidth: 105,
            height: 38,
            padding: '0 16px',
            borderRadius: 10,
            border: inNow ? '1px solid rgba(0,0,0,0.12)' : 'none',
            background: inNow ? '#F2F2F7' : 'linear-gradient(180deg, #D9A94D, #C78A2F)',
            color: inNow ? '#1C1C1E' : '#FFFFFF',
            fontWeight: 700,
            fontSize: 13.5,
            cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.6 : 1,
            transition: 'all 0.15s ease-in-out',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: inNow ? 'none' : '0 2px 6px rgba(217, 169, 77, 0.35)'
          }}
        >
          {busy ? (inNow ? 'Clocking out…' : 'Clocking in…') : inNow ? 'Clock Out' : 'Clock In'}
        </button>
      </div>

      {v ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 10,
            paddingTop: 8,
            borderTop: '1px solid rgba(0,0,0,0.06)',
            fontSize: 12,
            color: 'var(--tech-muted, #636366)'
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {inNow && v.clockedInAt ? (
              <>Since {clock(v.clockedInAt)}</>
            ) : v.lastClockOutAt ? (
              <>Last out {clock(v.lastClockOutAt)}</>
            ) : (
              'Ready for shift'
            )}
          </span>
          <span style={{ flexShrink: 0, marginLeft: 8 }}>
            Today: <strong style={{ color: 'var(--tech-text, #1C1C1E)' }}>{hours(v.hoursToday)}</strong>
          </span>
        </div>
      ) : null}

      {msg ? (
        <div
          role={msg.ok ? 'status' : 'alert'}
          style={{
            marginTop: 8,
            fontSize: 12,
            fontWeight: 600,
            color: msg.ok ? 'var(--tech-success, #2E7D32)' : 'var(--tech-danger, #D32F2F)'
          }}
        >
          {msg.text}
        </div>
      ) : null}
    </div>
  );
}
