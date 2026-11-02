// POSAIMoneyProtectionInvestigationsScreen.tsx — AI Center → AI Money Protection → Investigations. Wired to the
// investigation workflow (list/get/notes/status/resolve). The UI never moves money or accuses: it records human
// review. Notes are append-only; sensitive resolutions are offered but gated server-side (elevated permission +
// segregation of duties), so an unauthorized action returns a clear error rather than doing anything.
import { useEffect, useState } from 'react';
import { displayLocale } from '../i18n/format';
import { posAIMoneyProtectionApi } from '../api/posAIMoneyProtectionApi';
import { reportError, money } from './reportsCommon';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

import { growthCode } from './growthLabels';
type Investigation = {
  id: string; title: string; category: string; severity: string; status: string; assignedUserId: string | null;
  valueUnderReviewCents: number; recoveryAmountCents: number; resolution: string | null;
  related: { userIds?: string[]; alertIds?: string[] }; createdAt: string; updatedAt: string; closedAt: string | null;
};
type Note = { id: string; authorUserId: string; body: string; createdAt: string };

const RESOLUTIONS = [
  'EXPECTED_ACTIVITY', 'CUSTOMER_REQUEST', 'APPROVED_MANAGER_ACTION', 'PROCESSOR_ERROR', 'DEVICE_ERROR',
  'SOFTWARE_BUG', 'DUPLICATE_WEBHOOK', 'DUPLICATE_CHARGE_CONFIRMED', 'POLICY_VIOLATION',
  'EMPLOYEE_MISUSE_CONFIRMED', 'ACCOUNT_COMPROMISE', 'INVENTORY_ERROR', 'CASH_RECONCILIATION_ERROR',
  'FALSE_POSITIVE', 'INSUFFICIENT_EVIDENCE', 'OTHER',
];
const SENSITIVE = new Set(['EMPLOYEE_MISUSE_CONFIRMED', 'ACCOUNT_COMPROMISE']);
const label = (t: string) => growthCode(t, 'aiMoneyProtection');
const fmtDate = (iso?: string) => { if (!iso) return '—'; try { return new Date(iso).toLocaleString(displayLocale(), { month: 'short', day: '2-digit', hour: 'numeric', minute: '2-digit' }); } catch { return iso; } };

export function POSAIMoneyProtectionInvestigationsScreen() {
  const [rows, setRows] = useState<Investigation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<{ investigation: Investigation; notes: Note[] } | null>(null);
  const [note, setNote] = useState('');
  const [resolution, setResolution] = useState('FALSE_POSITIVE');
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try { const d = await posAIMoneyProtectionApi.listInvestigations() as Investigation[]; setRows(d || []); }
    catch (e: any) { setError(reportError(e, tx('growth.noun.investigations'))); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const open = async (id: string) => {
    setActionErr(null);
    try { setSel(await posAIMoneyProtectionApi.getInvestigation(id) as { investigation: Investigation; notes: Note[] }); }
    catch (e: any) { setActionErr(reportError(e, tx('growth.noun.investigation'))); }
  };
  const refresh = () => sel && open(sel.investigation.id);

  const doAddNote = async () => {
    if (!sel || !note.trim()) return;
    setBusy(true); setActionErr(null);
    try { await posAIMoneyProtectionApi.addNote(sel.investigation.id, note.trim()); setNote(''); await refresh(); }
    catch (e: any) { setActionErr(reportError(e, tx('growth.noun.addNote'))); } finally { setBusy(false); }
  };
  const doStatus = async (status: string) => {
    if (!sel) return; setBusy(true); setActionErr(null);
    try { await posAIMoneyProtectionApi.setInvestigationStatus(sel.investigation.id, status); await refresh(); await load(); }
    catch (e: any) { setActionErr(reportError(e, tx('growth.noun.status'))); } finally { setBusy(false); }
  };
  const doResolve = async () => {
    if (!sel) return; setBusy(true); setActionErr(null);
    try { await posAIMoneyProtectionApi.resolveInvestigation(sel.investigation.id, resolution); await refresh(); await load(); }
    catch (e: any) { setActionErr(reportError(e, tx('growth.noun.resolve'))); } finally { setBusy(false); }
  };

  return (
    <div className="work">
      <div className="vh">
        <h1>{tx('pos.money_protection_investigations')}</h1>
        <div className="sub mb-3">{tx('pos.human_review_of_possible_anomalies_notes_xycx')}</div>
      </div>

      {loading ? <div className="state">{tx('pos.loading_investigations')}</div>
        : error ? <div className="err">{error}</div>
        : !rows || rows.length === 0 ? <div className="state">{tx('pos.no_investigations_yet_open_one_from_kk6p')}</div>
        : (
          <div className="overflow-x-auto w-full"><table className="tbl w-full min-w-max">
            <thead><tr><th>{tx('pos.title')}</th><th>{tx('pos.severity_2')}</th><th>{tx('pos.status')}</th><th style={{ textAlign: 'right' }}>{tx('pos.under_review')}</th><th>{tx('pos.updated')}</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.title}</td><td>{growthCode(r.severity, 'level')}</td><td>{label(r.status)}</td>
                  <td style={{ textAlign: 'right' }}>{r.valueUnderReviewCents > 0 ? money(r.valueUnderReviewCents) : '—'}</td>
                  <td>{fmtDate(r.updatedAt)}</td>
                  <td><button type="button" onClick={() => open(r.id)}>{tx('pos.open')}</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}

      {sel && (
        <div className="panel" style={{ marginTop: 16 }} role="dialog" aria-label={tx('pos.investigation_detail')}>
          <div className="vh flex flex-col sm:flex-row gap-3 justify-between">
            <h2 style={{ fontSize: 16 }}>{sel.investigation.title}</h2>
            <button type="button" onClick={() => setSel(null)}>{tx('pos.close')}</button>
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            {growthCode(sel.investigation.severity, 'level')} · {label(sel.investigation.status)} {tx('pos.under_review_2')}{' '}{sel.investigation.valueUnderReviewCents > 0 ? money(sel.investigation.valueUnderReviewCents) : '—'} {tx('pos.not_confirmed_loss')}
            {sel.investigation.resolution ? tx('pos.resolution_resolution', { resolution: String(label(sel.investigation.resolution)) }) : ''}
          </div>

          <h3 style={{ fontSize: 14, marginTop: 12 }}>{tx('pos.notes_append_only')}</h3>
          {sel.notes.length === 0 ? <div className="state" style={{ padding: 8 }}>{tx('pos.no_notes_yet')}</div> : (
            <ul>{sel.notes.map((nte) => <li key={nte.id}><span style={{ color: 'var(--muted)', fontSize: 12 }}>{fmtDate(nte.createdAt)} · {nte.authorUserId}</span> — {nte.body}</li>)}</ul>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={tx('pos.add_a_note')} aria-label={tx('pos.add_a_note_2')} style={{ flex: 1 }} />
            <button type="button" onClick={doAddNote} disabled={busy || !note.trim()}>{tx('pos.add_note')}</button>
          </div>

          <h3 style={{ fontSize: 14, marginTop: 12 }}>{tx('pos.actions')}</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => doStatus('INVESTIGATING')} disabled={busy}>{tx('pos.start_investigating')}</button>
            <button type="button" onClick={() => doStatus('ESCALATED')} disabled={busy}>{tx('pos.escalate')}</button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={resolution} onChange={(e) => setResolution(e.target.value)} aria-label={tx('pos.resolution')}>
              {RESOLUTIONS.map((r) => <option key={r} value={r}>{label(r)}{SENSITIVE.has(r) ? ' (elevated)' : ''}</option>)}
            </select>
            <button type="button" onClick={doResolve} disabled={busy}>{tx('pos.record_resolution')}</button>
          </div>
          {SENSITIVE.has(resolution) && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{tx('pos.this_resolution_requires_elevated_permission_and_1wma')}</div>}
          {actionErr && <div className="err" style={{ marginTop: 8 }}>{actionErr}</div>}
        </div>
      )}
    </div>
  );
}
