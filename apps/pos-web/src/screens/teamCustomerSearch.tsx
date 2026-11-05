// teamCustomerSearch.tsx — Team Management round 2A (TM-01, Four-Module Completion Guide §8.1, 30 Oct 2026): the
// "Customer" search mode of the directory. A customer's name or phone (any format) → the staff linked to that customer
// through real records (assigned appointments, completed service lines, primary / helper technician on a completed ticket),
// every technician of a shared ticket, each with WHY and the record references. Server: /pos/team-members-screen/customer-links
// (customers.view; the customer phone comes back masked; this salon only). The search text never goes into the URL.
import { useEffect, useState } from 'react';
import { ProfileAvatarWithPreview } from '@aipowersalon/ui';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posTeamMembersScreenApi } from '../api/posTeamScreensApi';
import { FitPanel, Pager, Empty } from '../components/FitKit';
import { useLoad, StateBlock, fmtYmdSafe } from '../components/FinanceKit';
import { pageOf } from './technicianScreenParts';
import { nf, hm12 } from './teamShared';
import { roleName, liveName, LIVE_TONE } from './teamMembersParts';

/** a query the server will accept: ≥ 7 phone digits, or ≥ 2 letters */
export function customerQueryOk(q: string) { const d = q.replace(/\D/g, ''); const letters = q.replace(/[^\p{L}]/gu, '').length; return /[a-z\p{L}@]/iu.test(q) ? letters >= 2 : d.length >= 7; }

export function CustomerLinkedStaff({ q, tick, onOpenMember }: { q: string; tick: number; onOpenMember: (memberId: string) => void }) {
  const [page, setPage] = useState(1);
  // TM-01 gap (Nov 5 2026): staff archived since are listed only when asked for (marked Archived)
  const [withArchived, setWithArchived] = useState(false);
  useEffect(() => setPage(1), [q, withArchived]);
  const ok = customerQueryOk(q);
  const res = useLoad(() => (ok ? posTeamMembersScreenApi.customerLinks({ q, page, pageSize: 10, ...(withArchived ? { archived: 'include' } : {}) }) : Promise.resolve(null)), [q, page, tick, ok, withArchived]);
  const d: any = res.data;
  return (
    <FitPanel testId="customer-links" className="tm2-cl" title={<>{tx('tm2.cl.title')}{d ? <span className="fk-muted"> · {tx('tm2.cl.count', { n: nf(d.totalItems), c: nf(d.matchedCustomers) })}</span> : null}</>}
      footer={d ? <Pager info={pageOf(d)} onPage={setPage} label={tx('tm2.cl.title')} /> : undefined}>
      {q && ok ? <label className="fk-check" style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}><input type="checkbox" checked={withArchived} onChange={(e) => setWithArchived(e.target.checked)} data-testid="cl-archived" />{tx('tm2.cl.withArchived')}</label> : null}
      {!q ? <div className="fk-hint" data-testid="cl-prompt">{tx('tm2.cl.prompt')}</div>
        : !ok ? <div className="fk-hint" data-testid="cl-short">{tx('tm2.cl.short')}</div>
        : res.error ? <StateBlock error={res.error} onRetry={res.reload} />
        : !d ? <div className="fk-loading">{tx('pos.loading')}</div>
        : <>
          {d.customers.length ? <p className="fk-hint" data-testid="cl-customers">{tx('tm2.cl.customers')} {d.customers.map((c: any) => `${c.name}${c.phone ? ` (${c.phone})` : ''}`).join(' · ')}{d.matchedCustomers > d.customers.length ? ` · +${nf(d.matchedCustomers - d.customers.length)}` : ''}</p> : null}
          {d.matchedCustomers === 0 ? <Empty title={tx('tm2.cl.noCustomer')} /> : d.items.length === 0 ? <Empty title={tx('tm2.cl.none')}><span className="fk-hint">{tx('tm2.cl.noneWhy')}</span></Empty>
            : <ul className="tm2-cl-list" data-testid="cl-list">{d.items.map((m: any) => <li key={m.memberId} className="tm2-cl-row" data-testid="cl-row">
              <div className="tc-who"><ProfileAvatarWithPreview name={m.name} url={m.avatarUrl} size={34} type="technician" />
                <span><button type="button" className="fk-link tmm-name" onClick={() => onOpenMember(m.memberId)} data-testid="cl-name">{m.name}</button>
                  <span className="fk-li-s"><span className="mos-mono">{m.code}</span> · {m.roles.map(roleName).join(' + ')}</span></span>
                {m.archived ? <span className="fk-chip mut" data-testid="cl-archived-chip">{tx('tm2.cl.archived')}</span> : <span className={'fk-chip ' + (LIVE_TONE[m.live] ?? 'mut')}>{liveName(m.live)}</span>}</div>
              <ul className="tm2-cl-why" data-testid="cl-why">{m.reasons.map((r: any) => <li key={r.kind + r.refId}>
                <b>{r.kinds.map((k: string) => tx('tm2.cl.kind.' + k)).join(' + ')}</b>{' · '}
                {r.kind === 'ticket' ? tx('tm2.cl.ticket', { n: r.ticketNumber ?? r.refId.slice(0, 8) }) : tx('tm2.cl.appt', { id: r.refId.slice(0, 8) })}
                {r.date ? ` · ${fmtYmdSafe(r.date)}` : ''}{r.time ? ` ${hm12(r.time)}` : ''}{r.services.length ? ` · ${r.services.join(', ')}` : ''}
                {r.upcoming ? <span className="fk-chip info">{tx('tm2.cl.upcoming')}</span> : null}
                <span className="fk-li-s">{tx('tm2.cl.for', { name: r.customerName })}{r.customerPhone ? ` (${r.customerPhone})` : ''}</span></li>)}
                {m.moreReasons ? <li className="fk-li-s">{tx('tm2.cl.more', { n: nf(m.moreReasons) })}</li> : null}</ul>
            </li>)}</ul>}
          <p className="fk-hint">{tx('tm2.cl.rule')}</p>
        </>}
    </FitPanel>
  );
}
