// ExportPreview — "export scope & privacy preview" (backlog: Transactions · 10, Discounts · 08, Membership · 12, Expenses · 09 …).
// Before an existing export runs, show exactly what it will contain: the record count the server reported for the SAME
// filters, the period, every active filter, and the privacy facts the export really applies. Nothing is generated until
// the user confirms; Cancel changes nothing. A count the screen does not know is shown as "—", never guessed.
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { FitDialog } from './FitKit';
import { fmtNumber } from '../i18n/format';

export interface ExportPreviewProps {
  title: string;
  count: number | null | undefined;
  period?: string | null;
  filters: string[];
  masked?: boolean;          // contact details are masked in this export (true for the finance CSVs)
  audited?: boolean;         // only when the export endpoint really writes an audit record
  cap?: number;             // the server's row cap for this export, when it has one
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}
export function ExportPreview({ title, count, period, filters, masked = true, audited = false, cap, busy, onConfirm, onCancel }: ExportPreviewProps) {
  return (
    <FitDialog title={title} onClose={onCancel} busy={busy} testId="export-preview"
      footer={<><button type="button" className="fk-btn" onClick={onCancel} disabled={busy} data-testid="export-preview-cancel">{tx('exp.cancel')}</button>
        <button type="button" className="fk-btn primary" onClick={onConfirm} disabled={busy || count === 0} data-testid="export-preview-go">{busy ? tx('pos.loading') : tx('exp.download')}</button></>}>
      <dl className="fk-dl" data-testid="export-preview-scope">
        <dt>{tx('exp.records')}</dt><dd data-testid="export-preview-count">{count == null ? '—' : fmtNumber(count)}</dd>
        {period ? <><dt>{tx('exp.period')}</dt><dd>{period}</dd></> : null}
        <dt>{tx('exp.filters')}</dt><dd data-testid="export-preview-filters">{filters.length ? filters.join(' · ') : tx('exp.noFilters')}</dd>
      </dl>
      <ul className="sub" data-testid="export-preview-privacy">
        {masked ? <li>{tx('exp.masked')}</li> : null}
        <li>{tx('exp.formula')}</li>
        {audited ? <li>{tx('exp.audited')}</li> : null}
      </ul>
      {cap && count != null && count > cap ? <p className="fk-note warn" role="status" data-testid="export-preview-cap">{tx('exp.cap', { n: fmtNumber(cap) })}</p> : null}
      {count === 0 ? <p className="fk-note warn" role="status">{tx('exp.nothing')}</p> : null}
    </FitDialog>
  );
}
