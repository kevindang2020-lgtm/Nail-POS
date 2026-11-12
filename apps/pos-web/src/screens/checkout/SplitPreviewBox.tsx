import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { fmtMoney } from '../../i18n/format';
import { splitPreview, type SplitSeg } from './splitPreview';

/** Split Tender Preview: allocation by tender and what is still due — a preview, not a payment */
export function SplitPreviewBox({ segments, dueCents, labels }: { segments: SplitSeg[]; dueCents: number; labels: Record<string, string> }) {
  const p = splitPreview(segments, dueCents);
  if (!segments.length) return null;
  return (
    <div className="text-xs" data-testid="split-preview" style={{ background: 'var(--aps-surface-2,#f6f4f1)', borderRadius: 8, padding: '6px 8px' }}>
      {p.byMethod.map((m) => <div key={m.method} className="flex justify-between" data-testid={'split-prev-' + m.method}><span>{labels[m.method] ?? m.method}{m.count > 1 ? ` ×${m.count}` : ''}</span><span>{fmtMoney(m.cents)}</span></div>)}
      <div className="flex justify-between font-semibold" data-testid="split-prev-remaining">
        <span>{p.remainingCents > 0 ? tx('payment.splitPrev.stillDue') : p.remainingCents < 0 ? tx('payment.splitPrev.over') : tx('payment.splitPrev.exact')}</span>
        <span style={{ color: p.remainingCents === 0 ? '#2E9E54' : '#C0392B' }}>{p.remainingCents === 0 ? '✓' : fmtMoney(Math.abs(p.remainingCents))}</span>
      </div>
      {p.invalid ? <div style={{ color: '#C0392B' }} data-testid="split-prev-invalid">{tx('payment.splitPrev.invalid', { n: p.invalid })}</div> : null}
      <div style={{ color: 'var(--muted)' }}>{tx('payment.splitPrev.previewOnly')}</div>
    </div>
  );
}
