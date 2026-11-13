// TranslationCoveragePanel.tsx — round 10 (English Vietnamese POS Localization 04): the Translation coverage dashboard. The
// numbers come from the catalogues the POS is running (i18n/coverage.ts); keys are shown as keys (they are what a translator
// fixes). The two build-time checks are named, never given made-up numbers. Read-only.
import { useMemo, useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { translationCoverage } from '../i18n/coverage';
import { fmtNumber } from '../i18n/format';

const SHOW = 25;
export function TranslationCoveragePanel() {
  const [open, setOpen] = useState(false);
  const r = useMemo(() => (open ? translationCoverage() : null), [open]);
  const list = (keys: string[], testId: string) => <ul className="fk-li-s" data-testid={testId} style={{ margin: '2px 0 6px', paddingLeft: 18, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
    {keys.slice(0, SHOW).map((k) => <li key={k}>{k}</li>)}{keys.length > SHOW ? <li>{tx('tcov.more', { n: fmtNumber(keys.length - SHOW) })}</li> : null}</ul>;
  return <details data-testid="tcov" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
    <summary>{tx('tcov.title')}</summary>
    {r ? <div data-testid="tcov-body">
      <p data-testid="tcov-summary">{tx('tcov.summary', { p: String(r.percent), d: fmtNumber(r.translated), t: fmtNumber(r.total) })}</p>
      <div><b>{tx('tcov.missing', { n: fmtNumber(r.missingVi.length) })}</b>{r.missingVi.length ? list(r.missingVi, 'tcov-missing') : null}</div>
      <div><b>{tx('tcov.same', { n: fmtNumber(r.sameAsEnglish.length) })}</b>{r.sameAsEnglish.length ? list(r.sameAsEnglish, 'tcov-same') : null}</div>
      <div><b>{tx('tcov.errors', { n: fmtNumber(r.errorsMissing.length), t: fmtNumber(r.errorsTotal) })}</b>{r.errorsMissing.length ? list(r.errorsMissing, 'tcov-errors') : null}</div>
      <p className="fk-hint" data-testid="tcov-gates">{tx('tcov.gates')}</p>
    </div> : null}
  </details>;
}
