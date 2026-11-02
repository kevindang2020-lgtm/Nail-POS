// aiCustomerProfileCommon.tsx — shared bits for the AI Customer Profile Assistant screens: evidence/confidence
// display, freshness indicator, and the required state helpers (§63). Cream/gold system; no browser alerts; no
// fabricated values (unmodeled → em-dash). Keeps every screen consistent and honest.
import type { ReactNode } from 'react';
import { t } from '@aipowersalon/mobile-sdk/i18n';

export const DASH = '\u2014';

export function profileError(e: any, noun = 'this'): string {
  return e?.status === 403
    ? t('pos.you_do_not_have_permission_to_euol', { noun: String(noun) })
    : (e?.message || t('pos.could_not_load_noun', { noun: String(noun) }));
}

// ---- confidence / risk chips ----

const CONF_LABEL: Record<string, string> = { get confirmed() { return t('growth.aiProfile.confidence.confirmed'); }, get high() { return t('growth.aiProfile.confidence.high'); }, get medium() { return t('growth.aiProfile.confidence.medium'); }, get low() { return t('growth.aiProfile.confidence.low'); }, get insufficient() { return t('growth.aiProfile.confidence.insufficient'); } };
const CONF_TONE: Record<string, string> = { confirmed: 'var(--aps-orange)', high: 'var(--aps-orange)', medium: '#8a6d3b', low: 'var(--muted)', insufficient: 'var(--muted)' };
export function ConfidenceChip({ level }: { level: string }) {
  return <span className="chip" style={{ borderColor: 'var(--line)', color: CONF_TONE[level] ?? 'var(--muted)' }}>{CONF_LABEL[level] ?? level}</span>;
}

const RISK_LABEL: Record<string, string> = { get low() { return t('growth.aiProfile.risk.low'); }, get possible() { return t('growth.aiProfile.risk.possible'); }, get elevated() { return t('growth.aiProfile.risk.elevated'); }, get high() { return t('growth.aiProfile.risk.high'); }, get insufficient() { return t('growth.aiProfile.risk.insufficient'); } };
const RISK_TONE: Record<string, string> = { low: 'var(--muted)', possible: '#8a6d3b', elevated: '#b5651d', high: '#a12d2d', insufficient: 'var(--muted)' };
export function RiskChip({ level }: { level: string }) {
  return <span className="chip" style={{ borderColor: 'var(--line)', color: RISK_TONE[level] ?? 'var(--muted)', fontWeight: 700 }}>{RISK_LABEL[level] ?? level}</span>;
}

const INACT_LABEL: Record<string, string> = { get active() { return t('growth.aiProfile.inactivity.active'); }, get rebooking_soon() { return t('growth.aiProfile.inactivity.rebooking_soon'); }, get due_for_return() { return t('growth.aiProfile.inactivity.due_for_return'); }, get inactive() { return t('growth.aiProfile.inactivity.inactive'); }, get long_term_inactive() { return t('growth.aiProfile.inactivity.long_term_inactive'); }, get insufficient_history() { return t('growth.aiProfile.inactivity.insufficient_history'); } };
export function inactivityLabel(status: string): string { return INACT_LABEL[status] ?? status; }

// ---- evidence list (concise; never hidden reasoning) ----

export function EvidenceList({ items }: { items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <ul className="evidence" style={{ margin: '6px 0 0', paddingLeft: 16, color: 'var(--muted)', fontSize: 13 }}>
      {items.map((e, i) => <li key={i}>{e}</li>)}
    </ul>
  );
}

// ---- data freshness (§9) ----

export function Freshness({ f }: { f?: { generatedAt?: string; source?: string } }) {
  if (!f?.generatedAt) return null;
  const when = new Date(f.generatedAt);
  const label = f.source === 'cache' ? t('growth.aiProfile.cached') : t('growth.aiProfile.live');
  return <span className="sub" style={{ fontSize: 12, color: 'var(--muted)' }}>{label} {t('pos.updated_3')}{' '}{fmtTime(when)}</span>;
}

// ---- state helpers (§63) ----

export function Loading({ label }: { label?: string }) { return <div className="state">{label ?? t('pos.loading')}</div>; }
export function Empty({ label }: { label: string }) { return <div className="state">{label}</div>; }
export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="err" role="alert" style={{ marginTop: 12 }}>
      {message}
      {onRetry ? <button className="seg-btn" style={{ marginLeft: 10 }} onClick={onRetry}>{t('pos.try_again')}</button> : null}
    </div>
  );
}
export function InsufficientData({ children }: { children: ReactNode }) {
  return <div className="state" style={{ color: 'var(--muted)' }}>{children}</div>;
}

// ---- reusable customer lookup (server-side search; used by the per-customer workspace pages) ----
import { useCallback, useState } from 'react';
import { posCustomersApi } from '../api/posCustomersApi';
import { ImeSafeInput } from '../components/ImeSafeInput';   // WP-E §40: Telex / VNI typing never searches mid-composition
import { fmtTime } from '../i18n/format';

export function CustomerLookup({ onPick, placeholder }: { onPick: (c: any) => void; placeholder?: string }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const search = useCallback(async (e?: any) => {
    e?.preventDefault?.();
    const term = q.trim();
    if (term.length < 2) { setResults([]); return; }
    setSearching(true); setErr(null);
    try { const r: any = await posCustomersApi.quickSearch(term); setResults(r?.customers || r?.items || r || []); }
    catch (e2: any) { setErr(profileError(e2, 'customers')); }
    finally { setSearching(false); }
  }, [q]);

  return (
    <div>
      <form onSubmit={search} className="seg" style={{ display: 'flex', gap: 8, maxWidth: 520 }}>
        <ImeSafeInput aria-label={t('pos.search_customers')} value={q} onValue={setQ} placeholder={placeholder ?? t('pos.search_by_name_phone_or_email')}
          style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, font: 'inherit' }} />
        <button className="seg-btn on" type="submit" disabled={searching}>{searching ? t('pos.searching_2') : t('pos.search')}</button>
      </form>
      {err && <ErrorBox message={err} />}
      {results.length > 0 && (
        <section className="panel" style={{ marginTop: 12, padding: 0, overflow: 'hidden' }}>
          <table className="tbl">
            <thead><tr><th>{t('pos.customer')}</th><th>{t('pos.phone')}</th><th style={{ width: 120 }}></th></tr></thead>
            <tbody>{results.map((c: any) => (
              <tr key={c.customerId || c.id}>
                <td>{c.displayName || c.fullName || [c.firstName, c.lastName].filter(Boolean).join(' ')}</td>
                <td style={{ color: 'var(--muted)' }}>{c.phone || DASH}</td>
                <td><button className="seg-btn" onClick={() => onPick(c)}>{t('pos.select_2')}</button></td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}
