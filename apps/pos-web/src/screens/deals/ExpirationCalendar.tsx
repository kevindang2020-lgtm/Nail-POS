// Expiration Calendar (Extras backlog · Promotions Management 04): upcoming promotion end dates, grouped by day and
// labelled by branch, each opening the SAME canonical promotion (its id) in the shared detail dialog. Reads the
// existing coupon list (dateField = ends, live statuses) — no second store. Capped at 100 rows; when there are more,
// the count says so instead of pretending the list is complete.
import { useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posDiscountsApi } from '../../api/posDiscountsApi';
import { fmtInZone, fmtNumber } from '../../i18n/format';
import { FitDialog, Empty } from '../../components/FitKit';
import { useLoad, StateBlock } from '../../components/FinanceKit';

export const addDays = (ymd: string, n: number) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayKey = (iso: string) => fmtInZone(iso, { year: 'numeric', month: '2-digit', day: '2-digit' }) || iso.slice(0, 10);
const dayLabel = (iso: string) => fmtInZone(iso, { weekday: 'short', month: 'short', day: 'numeric' }) || iso.slice(0, 10);

export type ExpRow = { id: string; name: string; code?: string | null; endsAt: string | null; branchName?: string | null; lifecycle?: string };
export function groupByEndDay(rows: ExpRow[]) {
  const g = new Map<string, { label: string; at: string; rows: ExpRow[] }>();
  [...rows].filter((r) => r.endsAt).sort((a, b) => Date.parse(a.endsAt!) - Date.parse(b.endsAt!)).forEach((r) => {
    const k = dayKey(r.endsAt!); const cur = g.get(k) ?? { label: dayLabel(r.endsAt!), at: r.endsAt!, rows: [] }; cur.rows.push(r); g.set(k, cur);
  });
  return [...g.values()];
}

export function ExpirationCalendar({ today, onOpen, onClose }: { today: string; onOpen: (id: string) => void; onClose: () => void }) {
  const [days, setDays] = useState(30);
  const d = useLoad(() => posDiscountsApi.list({ status: 'live', dateField: 'ends', preset: 'custom', from: today, to: addDays(today, days), page: 1, pageSize: 100 }), [today, days]);
  const items: ExpRow[] = d.data?.items ?? []; const total = Number(d.data?.totalItems ?? items.length);
  const groups = groupByEndDay(items);
  return (
    <FitDialog wide title={tx('promo.exp.title')} subtitle={tx('promo.exp.sub', { from: today, to: addDays(today, days) })} onClose={onClose} testId="dlg-expiration-calendar"
      footer={<button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.close')}</button>}>
      <div className="fk-seg" role="tablist" aria-label={tx('promo.exp.window')}>
        {[7, 30, 90].map((n) => <button key={n} type="button" role="tab" aria-selected={days === n} className={days === n ? 'on' : ''} onClick={() => setDays(n)} data-testid={`exp-days-${n}`}>{tx('promo.exp.days', { n })}</button>)}
      </div>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !d.data ? <div className="fk-loading">{tx('pos.loading')}</div> : groups.length === 0 ? <Empty title={tx('promo.exp.none')} /> : <>
        {total > items.length ? <div className="fk-hint" data-testid="exp-capped">{tx('promo.exp.capped', { n: fmtNumber(items.length), total: fmtNumber(total) })}</div> : null}
        <ol className="fk-list dense" data-testid="exp-days">{groups.map((g) => (
          <li key={g.at} className="fk-li" data-testid="exp-day"><b className="fk-li-t">{g.label}</b>
            <ul className="fk-list dense">{g.rows.map((r) => (
              <li key={r.id}><button type="button" className="fk-li-t link" onClick={() => onOpen(r.id)} data-testid="exp-open">{r.code ? `${r.code} · ` : ''}{r.name}</button>
                <span className="fk-li-s">{r.branchName || tx('dsc.salonWide')}</span></li>))}</ul>
          </li>))}</ol>
      </>}
    </FitDialog>
  );
}
