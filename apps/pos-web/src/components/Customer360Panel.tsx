// Customer360Panel.tsx — Customer Intelligence 30 (extras, Nov 13 2026): the Customer 360-Degree Intelligence view inside the
// Customer Intelligence overlay. One read (GET /pos/customer-intelligence/customers/:id/360): identity (masked unless the user may
// export contacts), newest-first service history, preferences, loyalty / membership and REVIEW suggestions, each with the evidence
// it rests on. Advisory only — no button here books, messages, merges or changes points.
import { useEffect, useState } from 'react';
import type { Customer360 } from '@aipowersalon/api-contracts/tenant';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posCustomerIntelligenceApi } from '../api/posCustomerIntelligenceApi';
import { errorTextOf } from '../i18n/error-text';
import { fmtInZone, fmtMoney, fmtNumber } from '../i18n/format';
import { codeLabel } from './codeLabel';

const t = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const day = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
/** an evidence token "key:value" → "Usual interval: 30 days" (the key labelled, the value kept) */
function evidenceText(e: string): string {
  const i = e.indexOf(':'); const key = i < 0 ? e : e.slice(0, i); const val = i < 0 ? '' : e.slice(i + 1);
  if (key === 'group') return t('cix.360.ev.group');
  return val ? t('cix.360.ev.kv', { k: codeLabel('cix.360.ev', key), v: key === 'last_visit' ? day(val) : codeLabel('cix.360.evv', val) }) : codeLabel('cix.360.ev', key);
}

export function Customer360Panel({ customerId }: { customerId: string }) {
  const [v, setV] = useState<Customer360 | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setV(null); setErr(null); posCustomerIntelligenceApi.customer360(customerId).then(setV).catch((e) => setErr(errorTextOf(e, t('cix.360.failed')))); }, [customerId]);
  if (err) return <div className="err" data-testid="cix-360-error">{err}</div>;
  if (!v) return <div className="state">{t('cix.loading')}</div>;
  const idn = v.identity;
  return (
    <div data-testid="cix-360">
      <dl className="rvw-dl" data-testid="cix-360-identity">
        <dt>{t('cix.360.identity')}</dt><dd>{idn.name ?? '—'} · <span className="chip">{codeLabel('cix.360.state', idn.state)}</span></dd>
        <dt>{t('cix.ov.contact')}</dt><dd>{idn.phone ?? t('cix.notProvided')} · {idn.email ?? t('cix.notProvided')}{idn.contact === 'masked' ? <span className="sub"> · {t('cix.360.masked')}</span> : null}</dd>
        <dt>{t('cix.360.spend')}</dt><dd data-testid="cix-360-spend">{t('cix.360.spendLine', { amount: fmtMoney(v.lifetimeSpendCents), n: fmtNumber(v.visitsTotal) })}</dd>
        <dt>{t('cix.ov.loyalty')}</dt><dd>{v.loyalty.points == null ? t('cix.ov.notEnrolled') : t('cix.points', { n: fmtNumber(v.loyalty.points) })}{v.loyalty.tier ? ` · ${v.loyalty.tier}` : ''}</dd>
        <dt>{t('cix.ov.membership')}</dt><dd>{v.loyalty.membership ? `${v.loyalty.membership.plan ?? '—'} · ${codeLabel('cix.360.mem', v.loyalty.membership.status)}` : t('cix.none')}</dd>
        <dt>{t('cix.ov.prefTech')}</dt><dd>{v.preferences.preferredTechnician ?? t('cix.ov.noneRecorded')}</dd>
        <dt>{t('cix.360.prefs')}</dt><dd data-testid="cix-360-prefs">{[v.preferences.style, ...v.preferences.products, ...v.preferences.colors].filter(Boolean).join(' · ') || t('cix.ov.noneRecorded')}</dd>
      </dl>
      <div className="p-h">{t('cix.360.history')}</div>
      {v.visits.length === 0 ? <div className="sub">{t('cix.360.noVisits')}</div> : <table className="tbl rvw-table"><thead><tr><th>{t('cix.360.col.date')}</th><th>{t('cix.360.col.services')}</th><th>{t('cix.360.col.tech')}</th><th className="num">{t('cix.360.col.total')}</th></tr></thead>
        <tbody>{v.visits.map((x) => <tr key={x.ticketId} data-testid="cix-360-visit"><td className="nowrap">{day(x.date)}</td><td>{x.services.join(', ') || '—'}</td><td>{x.technician ?? '—'}</td><td className="num">{fmtMoney(x.totalCents)}</td></tr>)}</tbody></table>}
      <div className="p-h">{t('cix.360.suggestions')}</div>
      {v.suggestions.length === 0 ? <div className="sub" data-testid="cix-360-nosug">{t('cix.360.noSuggestions')}</div> : <ul data-testid="cix-360-suggestions">{v.suggestions.map((s, i) => (
        <li key={i} data-testid={`cix-360-sug-${s.code}`}><b>{codeLabel('cix.360.sug', s.code)}</b><div className="sub">{s.evidence.map(evidenceText).join(' · ')}</div></li>))}</ul>}
      <p className="sub">{t('cix.360.advisory')}</p>
    </div>
  );
}
