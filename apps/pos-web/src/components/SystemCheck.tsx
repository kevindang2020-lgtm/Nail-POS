// SystemCheck.tsx — the shared read-only "Check … System" button + dialog (extras arc, Nov 9 2026: the SUNMI guides' optional
// "One-click … Health / Integrity / Accuracy Checker" on pages that had none). It shows PASS / WARNING / FAILED / NOT TESTED
// per check with the count and the fix; a check that could not run is never shown as a pass. Nothing is changed.
import { useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { FitDialog } from './FitKit';
import { useCan } from './usePermissions';
import { errorTextOf } from '../i18n/error-text';
import { fmtInZone, fmtNumber } from '../i18n/format';
import { posSystemChecksApi, type SystemCheckDomain, type SystemCheckResult } from '../api/posSystemChecksApi';

const ct = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
/** the page's own read permission (the server checks the same one on GET pos/system-checks/<page>) */
const PERM: Record<SystemCheckDomain, string> = { expenses: 'owner.expenses.view', invoices: 'pos.checkout.view', settlements: 'reconciliation.view', payments: 'pos.reports.view',
  discounts: 'pos.marketing.view', catalog: 'pos.services.view', inventory: 'inventory.view', technicians: 'pos.technicians.view', memberships: 'pos.memberships.view',
  'service-flow': 'pos.serving.view', terminals: 'settings.view', approvals: 'approvals.view', reports: 'pos.reports.view' };
const TONE: Record<string, string> = { READY: '#1F7A3F', WARNING: '#A96F22', FAILED: '#B3261E', NOT_TESTED: '#6B6257' };

export function SystemCheckButton({ domain, testId = `syschk-${domain}` }: { domain: SystemCheckDomain; testId?: string }) {
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState<SystemCheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setErr(null);
    try { setRes(await posSystemChecksApi.run(domain)); } catch (e) { setErr(errorTextOf(e, ct('syschk.failed'))); } finally { setBusy(false); }
  };
  if (!can(PERM[domain])) return null;
  return (
    <>
      <button type="button" className="btn btn-sm" style={{ minHeight: 44 }} data-testid={testId} onClick={() => { setOpen(true); void run(); }}>{ct('syschk.button')}</button>
      {open ? (
        <FitDialog title={ct(`syschk.${domain}.title`)} subtitle={ct('syschk.sub')} onClose={() => setOpen(false)} testId={`${testId}-dialog`}
          footer={<button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => void run()} disabled={busy} data-testid={`${testId}-rerun`}>{busy ? ct('syschk.running') : ct('syschk.run')}</button>}>
          {err ? <div role="alert" className="fk-error" data-testid={`${testId}-error`}>{err}</div> : null}
          {!res ? (busy ? <div className="muted">{ct('syschk.running')}</div> : null) : (
            <>
              <div data-testid={`${testId}-overall`} style={{ fontWeight: 700, color: TONE[res.overall], marginBottom: 6 }}>
                {ct(`syschk.overall.${res.overall}`)}
                <span className="muted" style={{ fontWeight: 400, marginLeft: 8 }}>
                  {ct('syschk.checkedAt', { when: fmtInZone(res.checkedAt, { hour: 'numeric', minute: '2-digit' }) })} · {res.branchId ? ct('syschk.scopeBranch') : ct('syschk.scopeAll')}
                </span>
              </div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {res.checks.map((c) => (
                  <li key={c.key} data-testid={`${testId}-row`} data-state={c.state} style={{ display: 'grid', gridTemplateColumns: '96px 1fr auto', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--line, #e5e5e5)', alignItems: 'start' }}>
                    <span style={{ color: TONE[c.state], fontWeight: 700 }}>{ct(`syschk.state.${c.state}`)}</span>
                    <span>
                      {ct(`syschk.${domain}.${c.key}`)}
                      {c.state === 'WARNING' || c.state === 'FAILED' ? <div className="muted">{ct(`syschk.${domain}.${c.key}.fix`)}</div> : null}
                      {c.state === 'NOT_TESTED' ? <div className="muted">{ct('syschk.notTested')}</div> : null}
                    </span>
                    <span className="muted">{c.count ? ct('syschk.count', { n: fmtNumber(c.count) }) : c.count === 0 ? '0' : '—'}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </FitDialog>
      ) : null}
    </>
  );
}
