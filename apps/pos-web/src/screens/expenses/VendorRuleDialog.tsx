// Vendor rule with preview (Extras backlog · Receipt Expense OCR Accounting 05): "always categorize this vendor as X".
// The preview (read-only) shows how this vendor's last 180 days were categorized against X and states plainly that a
// rule only classifies FUTURE drafts — approved history and open drafts are never silently changed. Saving uses the
// existing expense-rules route (owner.expenses.categories.manage).
import { useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posExpensesApi, type FinCategory } from '../../api/posExpensesApi';
import { FitDialog } from '../../components/FitKit';
import { useLoad, StateBlock, fmtYmdSafe } from '../../components/FinanceKit';
import { fmtNumber } from '../../i18n/format';
import { errorTextOf } from '../../i18n/error-text';

export function VendorRuleDialog({ vendor, initialKey, categories, catLabel, canSave, onClose, onSaved }: { vendor: string; initialKey: string; categories: FinCategory[]; catLabel: (k: string) => string; canSave: boolean; onClose: () => void; onSaved: (msg: string) => void }) {
  const [key, setKey] = useState(initialKey); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const p = useLoad(() => posExpensesApi.rulePreview(vendor, key), [vendor, key]);
  const d = p.data; const n = (v: number) => fmtNumber(v);
  const save = async () => { setBusy(true); setErr(null); try { await posExpensesApi.createRule(vendor, key); onSaved(tx('finance.rule.saved', { v: vendor, c: catLabel(key) })); } catch (e) { setErr(errorTextOf(e, tx('pos.could_not_save'))); } finally { setBusy(false); } };
  return (
    <FitDialog title={tx('finance.rule.title')} subtitle={vendor} onClose={onClose} busy={busy} testId="dlg-vendor-rule"
      footer={<><button type="button" className="fk-btn ghost" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button>
        {canSave ? <button type="button" className="fk-btn primary" disabled={!d || busy} onClick={() => void save()} data-testid="rule-save">{busy ? tx('pos.saving_2') : tx('finance.rule.save')}</button> : null}</>}>
      <label className="fk-field"><span>{tx('finance.rule.always')}</span>
        <select value={key} onChange={(e) => setKey(e.target.value)} data-testid="rule-category">{categories.filter((c) => c.active !== false).map((c) => <option key={c.key} value={c.key}>{catLabel(c.key)}</option>)}</select></label>
      {p.error ? <StateBlock error={p.error} onRetry={p.reload} /> : !d ? <div className="fk-loading">{tx('pos.loading')}</div> : (
        <div data-testid="rule-preview">
          <ul className="fk-checks">
            <li data-testid="rule-future">{tx('finance.rule.future', { c: d.categoryLabel })}</li>
            <li data-testid="rule-history">{d.matched ? tx('finance.rule.history', { n: n(d.matched), since: fmtYmdSafe(d.since), same: n(d.sameCategory) }) : tx('finance.rule.noHistory', { since: fmtYmdSafe(d.since) })}</li>
            {d.approvedDifferent ? <li className="warn" data-testid="rule-approved">{tx('finance.rule.approved', { n: n(d.approvedDifferent) })}</li> : null}
            {d.openDifferent ? <li className="warn" data-testid="rule-open">{tx('finance.rule.openDrafts', { n: n(d.openDifferent) })}</li> : null}
            {d.replaces ? <li className="warn" data-testid="rule-replaces">{tx('finance.rule.replaces', { c: d.replaces.label })}</li> : null}
          </ul>
          {d.byCategory.length ? <div className="fk-hint">{d.byCategory.map((b) => `${b.label}: ${n(b.count)}`).join(' · ')}</div> : null}
          {!canSave ? <div className="fk-hint">{tx('finance.rule.noPerm')}</div> : null}
        </div>)}
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
    </FitDialog>
  );
}
