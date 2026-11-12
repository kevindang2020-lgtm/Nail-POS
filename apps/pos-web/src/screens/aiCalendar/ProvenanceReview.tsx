// AI booking provenance & exception review (Extras backlog · AI Calendar 10): the server's list of AI-origin problems over the
// last 30 days — failed AI booking calls, AI holds that lapsed without an appointment (with the last code status), "AI"
// appointments with no recorded call link, and AI-created appointments not labelled "AI" — each with the stored record ids it
// comes from. Redacted by the server (no codes, phones, names or full call ids). Read-only: an appointment opens the existing
// overlay; nothing is retried, relabelled or released here.
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { posAiCalendarApi } from '../../api/posAiCalendarApi';
import { FitDialog, Empty } from '../../components/FitKit';
import { useLoad, StateBlock } from '../../components/FinanceKit';
import { fmtInZone } from '../../i18n/format';
import { codeLabel } from '../../components/codeLabel';

const KINDS = ['tool_failed', 'verification_incomplete', 'source_unlinked', 'source_mismatch'] as const;
const COUNT_KEY = { tool_failed: 'toolFailed', verification_incomplete: 'verificationIncomplete', source_unlinked: 'sourceUnlinked', source_mismatch: 'sourceMismatch' } as const;
const short = (id: string) => id.replace(/-/g, '').slice(0, 8);

export function ProvenanceReview({ onClose, onOpen }: { onClose: () => void; onOpen: (appointmentId: string) => void }) {
  const d = useLoad(() => posAiCalendarApi.provenance(), []);
  const r = d.data;
  return (
    <FitDialog wide title={t('aical.pv.title')} subtitle={r ? t('aical.pv.sub', { n: r.windowDays, at: fmtInZone(r.asOf, { hour: 'numeric', minute: '2-digit' }) }) : undefined} onClose={onClose} testId="aic-provenance"
      footer={<><button className="btn ghost" onClick={d.reload} data-testid="aic-pv-refresh">{t('aical.refresh')}</button><button className="btn" onClick={onClose}>{t('aical.close')}</button></>}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !r ? <div className="aic-muted">{t('aical.loading')}</div> : <>
        <div className="aic-row" data-testid="aic-pv-counts">{KINDS.map((k) => <span key={k} className="chip" data-testid={'aic-pv-count-' + k}>{t('aical.pv.k.' + k)} · {r.counts[COUNT_KEY[k]]}</span>)}</div>
        {!r.items.length ? <Empty title={t('aical.pv.none')} /> : (
          <table className="aic-table" data-testid="aic-pv-table">
            <thead><tr><th>{t('aical.pv.when')}</th><th>{t('aical.pv.kind')}</th><th>{t('aical.pv.detail')}</th><th>{t('aical.pv.refs')}</th><th /></tr></thead>
            <tbody>{r.items.map((i, n) => (
              <tr key={n} data-testid="aic-pv-row">
                <td>{i.at ? fmtInZone(i.at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}</td>
                <td>{t('aical.pv.k.' + i.kind)}<div className="aic-muted">{t('aical.pv.why.' + i.kind)}</div></td>
                <td data-testid="aic-pv-detail">{[
                  i.detail.tool ? t('aical.pv.d.tool', { v: codeLabel('aical.pv.tool', i.detail.tool) }) : null,
                  i.detail.result ? t('aical.pv.d.result', { v: codeLabel('aical.pv.result', i.detail.result) }) : null,
                  i.detail.call ? t('aical.pv.d.call', { v: i.detail.call }) : null,
                  i.detail.holdStatus ? t('aical.pv.d.hold', { v: codeLabel('aical.pv.hold', i.detail.holdStatus) }) : null,
                  i.detail.releaseReason ? t('aical.pv.d.release', { v: codeLabel('aical.pv.release', i.detail.releaseReason) }) : null,
                  i.kind === 'verification_incomplete' ? t('aical.pv.d.code', { v: i.detail.verification ? codeLabel('aical.pv.code', i.detail.verification) : t('aical.pv.noCode') }) : null,
                  i.detail.source ? t('aical.pv.d.source', { v: codeLabel('aical.source', i.detail.source) }) : null,
                  i.detail.appointmentStatus ? t('aical.pv.d.status', { v: codeLabel('aical.status', i.detail.appointmentStatus, 'appointment') }) : null,
                ].filter(Boolean).join(' · ')}</td>
                <td className="aic-muted" data-testid="aic-pv-refs">{i.refs.map((x) => `${t('aical.pv.t.' + x.table)} ${short(x.id)}`).join(' · ')}</td>
                <td>{i.appointmentId ? <button className="aic-link" onClick={() => onOpen(i.appointmentId!)} data-testid="aic-pv-open">{t('aical.pv.open')}</button> : null}</td>
              </tr>))}</tbody>
          </table>)}
        <div className="aic-muted">{t('aical.pv.note')}</div>
      </>}
    </FitDialog>
  );
}
