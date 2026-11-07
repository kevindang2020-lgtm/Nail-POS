// ScreenCheckDialog.tsx — the one-click, READ-ONLY "Check this screen" overlay (SUNMI FLEX 3 mandates, Nov 6 2026).
// Opened from the profile menu by people who can view settings (owner / manager). It measures the screen that is open
// behind it (shell/screenCheck.ts), shows PASS / WARN / FAIL / NOT_TESTED per check with the remedy, previews the certified
// display profiles, and can ask every open screen to reload its data from the server ("Refresh data now" = the realtime
// reconcile, the same path a reconnect takes — no page reload, nothing is written). "Copy report" copies module ids,
// rectangles and counts only — no customer, payroll, receipt, card or phone data.
import { useCallback, useEffect, useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { FitDialog } from '../components/FitKit';
import { DISPLAY_PROFILES, displayProfile, measureDisplay, densityFor, onDisplayProfile } from './displayProfile';
import { analyzeScreen, collectScreen, overallVerdict, type ScreenFinding, type Collected } from './screenCheck';
import { REALTIME_RECONCILE, realtimeStatus } from '../realtime/realtime-client';
import { syncStatus } from '../realtime/useRealtime';

const TONE: Record<string, string> = { PASS: '#1F7A3F', WARN: '#A96F22', FAIL: '#B3261E', NOT_TESTED: '#6B6257' };

function run(): { collected: Collected; findings: ScreenFinding[] } {
  const prof = displayProfile() ?? measureDisplay();
  const snap = syncStatus.snapshot();
  const collected = collectScreen(document, window.location.pathname, prof, { status: realtimeStatus(), lastSyncedAt: snap.lastSyncedAt, lastErrorAt: snap.lastErrorAt });
  return { collected, findings: analyzeScreen(collected, (k, v) => tx(k, v)) };
}

export function ScreenCheckDialog({ onClose }: { onClose: () => void }) {
  const [res, setRes] = useState(run);
  const [note, setNote] = useState<string | null>(null);
  const rerun = useCallback(() => { setNote(null); requestAnimationFrame(() => setRes(run())); }, []);
  useEffect(() => { const id = setTimeout(rerun, 400); return () => clearTimeout(id); }, [rerun]);   // after the screen settles
  // the window was resized / rotated / the keyboard opened while the overlay is open: measure again (the shell's own listener)
  useEffect(() => onDisplayProfile(() => rerun()), [rerun]);
  const verdict = overallVerdict(res.findings);
  const p = res.collected.profile;
  const refreshNow = () => { window.dispatchEvent(new CustomEvent(REALTIME_RECONCILE, { detail: { reason: 'manual' } })); setNote(tx('sunmi.refreshAsked')); setTimeout(rerun, 1500); };
  const copy = async () => {
    const report = { at: new Date().toISOString(), route: res.collected.route, page: res.collected.page?.key ?? null, verdict, profile: p, scroll: res.collected.scroll,
      modules: res.collected.modules.map((m) => ({ id: m.id, present: m.present, visible: m.visible, inView: m.inView, rect: m.rect, children: m.children })),
      findings: res.findings.map((f) => ({ id: f.id, verdict: f.verdict, detail: f.detail })) };
    try { await navigator.clipboard.writeText(JSON.stringify(report, null, 1)); setNote(tx('sunmi.copied')); } catch { setNote(tx('sunmi.copyFailed')); }
  };
  return (
    <FitDialog title={tx('sunmi.title')} subtitle={res.collected.page ? `${res.collected.page.title} · ${res.collected.route}` : res.collected.route} onClose={onClose} wide testId="screen-check"
      footer={<>
        {note ? <span role="status" style={{ marginRight: 'auto', fontSize: 12.5, color: 'var(--muted)' }}>{note}</span> : <span style={{ marginRight: 'auto' }} />}
        <button type="button" className="fk-btn" onClick={refreshNow} data-testid="screen-check-refresh">{tx('sunmi.refreshNow')}</button>
        <button type="button" className="fk-btn" onClick={copy} data-testid="screen-check-copy">{tx('sunmi.copy')}</button>
        <button type="button" className="fk-btn primary" onClick={rerun} data-testid="screen-check-run">{tx('sunmi.runAgain')}</button>
      </>}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span data-testid="screen-check-verdict" style={{ fontWeight: 800, color: '#fff', background: TONE[verdict], borderRadius: 8, padding: '4px 12px' }}>{tx('sunmi.verdict.' + verdict)}</span>
        <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{tx('sunmi.readOnly')}</span>
      </div>
      <table className="fk-table" style={{ width: '100%' }} data-testid="screen-check-findings">
        <thead><tr><th style={{ width: 110 }}>{tx('sunmi.col.result')}</th><th style={{ width: 210 }}>{tx('sunmi.col.check')}</th><th>{tx('sunmi.col.detail')}</th><th style={{ width: 300 }}>{tx('sunmi.col.remedy')}</th></tr></thead>
        <tbody>
          {res.findings.map((f) => (
            <tr key={f.id} data-check={f.id} data-verdict={f.verdict}>
              <td><b style={{ color: TONE[f.verdict] }}>{tx('sunmi.verdict.' + f.verdict)}</b></td>
              <td>{f.title}</td>
              <td>{f.detail}{f.modules && f.modules.length ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>{f.modules.join(' · ')}</div> : null}</td>
              <td style={{ fontSize: 12.5 }}>{f.remedy ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 style={{ margin: '14px 0 6px', fontSize: 14 }}>{tx('sunmi.profiles')}</h3>
      <table className="fk-table" style={{ width: '100%' }} data-testid="screen-check-profiles">
        <thead><tr><th>{tx('sunmi.col.profile')}</th><th style={{ width: 120 }}>{tx('sunmi.col.size')}</th><th style={{ width: 130 }}>{tx('sunmi.col.density')}</th></tr></thead>
        <tbody>
          {DISPLAY_PROFILES.map((d) => {
            const here = d.w === p.innerW && d.h === p.innerH;
            return <tr key={d.id} style={here ? { fontWeight: 700 } : undefined}><td>{tx('sunmi.profile.' + d.id)}{here ? ` — ${tx('sunmi.thisScreen')}` : ''}</td><td>{d.w} × {d.h}</td><td>{tx('sunmi.density.' + densityFor(d.w, d.h))}</td></tr>;
          })}
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>{tx('sunmi.deviceNote')}</p>
    </FitDialog>
  );
}
