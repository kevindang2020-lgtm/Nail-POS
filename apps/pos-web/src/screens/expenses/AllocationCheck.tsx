import { useEffect, useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { authApi } from '../../api/authApi';
import { money } from '../reportsCommon';
import { allocationCheck } from './allocationCheck';

/** Branch allocation checker: each branch's share, whether the shares add up to the exact cents, and the report impact */
export function AllocationCheck({ allocations, amountCents, branchId, counted }: { allocations: unknown[]; amountCents: number; branchId: string | null; counted: boolean }) {
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const c = allocationCheck(allocations, amountCents);
  useEffect(() => { if (!c.rows.length && !branchId) return; let alive = true;
    authApi.branches().then((r) => { if (alive) setNames(new Map((r?.branches ?? []).filter((b) => b.name).map((b) => [String(b.id), String(b.name)]))); }).catch(() => undefined);
    return () => { alive = false; }; }, [c.rows.length, branchId]);
  const nm = (id: string) => names.get(id) ?? `${tx('finance.alloc.branch')} ${id.slice(0, 6)}`;
  const impact = !counted ? tx('finance.alloc.notCounted') : branchId ? tx('finance.alloc.oneBranch', { b: nm(branchId) }) : c.rows.length ? tx('finance.alloc.split') : tx('finance.alloc.salonWide');
  return (
    <section data-testid="alloc-check"><h3 className="fk-h3">{tx('finance.alloc.title')}</h3>
      {c.rows.length ? <>
        <table className="fk-table"><tbody>{c.rows.map((a) => <tr key={a.branchId} data-testid="alloc-row"><td>{nm(a.branchId)}</td><td className="num">{money(a.amountCents)}</td><td className="num">{a.pct}%</td></tr>)}</tbody></table>
        <div className={'fk-note ' + (c.exact ? 'ok' : 'bad')} data-testid="alloc-verdict">{c.exact ? tx('finance.alloc.exact', { v: money(c.sumCents) }) : tx('finance.alloc.off', { v: money(Math.abs(c.diffCents)), s: money(c.sumCents), t: money(amountCents) })}</div>
      </> : null}
      <div className="fk-hint" data-testid="alloc-impact">{impact}</div>
    </section>
  );
}
