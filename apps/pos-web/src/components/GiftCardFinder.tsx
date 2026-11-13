// GiftCardFinder.tsx — extras GIFT CARDS 04 (round 10): a quick, scoped customer-card finder that opens OVER the active sale
// (Checkout) or a profile, so staff never leave what they are doing. It reads the Gift Cards list (server search over masked
// card refs / last 4, purchaser or recipient name, phone, email — the same read the Gift Cards screen uses, pos.checkout.view)
// and shows each card MASKED with its purchaser / recipient labels, status and balance. It never reveals a redeemable code:
// paying still needs the guest's card or code (and PIN). Read only.
import { useEffect, useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posGiftCardsApi } from '../api/posGiftCardsApi';
import { FitDialog, Empty } from './FitKit';
import { fmtMoney } from '../i18n/format';
import { codeLabel } from './peopleLabels';
import { errorTextOf } from '../i18n/error-text';

type FoundCard = { id: string; card: string; status: string; balanceCents: number; spendable: boolean; purchaser: { name: string | null } | null; recipient: { name: string | null } | null };

export function GiftCardFinder({ initialQuery = '', onClose }: { initialQuery?: string; onClose: () => void }) {
  const [q, setQ] = useState(initialQuery.trim());
  const [draft, setDraft] = useState(initialQuery.trim());
  const [rows, setRows] = useState<FoundCard[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (q.length < 2) { setRows(null); return; }
    let live = true; setErr(null); setRows(null);
    posGiftCardsApi.list({ search: q, preset: 'all', page: 1, pageSize: 10 })
      .then((r: { items?: FoundCard[] }) => { if (live) setRows(r.items ?? []); })
      .catch((e: unknown) => { if (live) setErr(errorTextOf(e, tx('gcf.failed'))); });
    return () => { live = false; };
  }, [q]);
  return (
    <FitDialog title={tx('gcf.title')} subtitle={tx('gcf.sub')} onClose={onClose} testId="gc-finder"
      footer={<button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.close')}</button>}>
      <form onSubmit={(e) => { e.preventDefault(); setQ(draft.trim()); }} style={{ display: 'flex', gap: 6 }}>
        <input type="search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={tx('gcf.ph')} aria-label={tx('gcf.ph')} data-testid="gc-finder-q" autoComplete="off" style={{ flex: 1 }} />
        <button type="submit" className="fk-btn" data-testid="gc-finder-go">{tx('gcf.search')}</button>
      </form>
      {err ? <div className="fk-note bad" role="alert"><span>{err}</span></div>
        : q.length < 2 ? <p className="fk-hint">{tx('gcf.min')}</p>
        : !rows ? <div className="fk-loading">{tx('pos.loading')}</div>
        : !rows.length ? <Empty title={tx('gcf.none')} />
        : <ul className="fk-list dense" data-testid="gc-finder-list">{rows.map((c) => <li key={c.id} className="fk-li" data-testid="gc-finder-row">
            <span className="fk-li-t"><b>{c.card}</b> · {fmtMoney(c.balanceCents)} · {codeLabel('gc.status.' + c.status, c.status)}
              <span className="fk-li-s">{c.purchaser?.name ? tx('gcf.purchaser', { n: c.purchaser.name }) : tx('gcf.noPurchaser')}{c.recipient?.name ? ` · ${tx('gcf.recipient', { n: c.recipient.name })}` : ''}{!c.spendable ? ` · ${tx('gcf.notSpendable')}` : ''}</span></span></li>)}</ul>}
      <p className="fk-hint">{tx('gcf.rule')}</p>
    </FitDialog>
  );
}
