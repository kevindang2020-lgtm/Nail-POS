// POSPaymentTerminalsScreen.tsx — Devices → Payment Terminals (/tenant/devices/payment-terminals). Payment Terminals mandate
// (Oct 29 2026): ONE full-screen page at 100 % zoom —
//   header (Refresh · + Pair Terminal) · four PHYSICAL-terminal KPIs (Physical Terminals · Online · Needs Attention ·
//   Disabled — server counts from the same rows as the list; Tap to Pay phones are counted apart) · four tabs (Physical
//   Terminals · Tap to Pay iPhones · Payment Activity · Routing Settings) with one search + the tab's filters · the tab body:
//   a server-paged table (newest first) whose numbered pager sits in the panel, or the routing settings.
// What was wrong: the counts were computed in the browser and "Needs Attention" left out never-tested / unpaired terminals
// (the photo's "1 needs attention" had no row that said why); terminals with no location were charged but never listed;
// no search, no paging, no payment trace; the routing setting was a hidden settings key. Statuses are the server's normalized
// status (never "Online" for a terminal that was never heard from). Every action keeps its audited step-up route; nothing
// here charges a card (Test Connection is the provider's non-charge ping).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posTerminalsScreenApi as api } from '../api/posTerminalsScreenApi';
import { posDevicesApi } from '../api/posDevicesApi';
import { posMobilePaymentsApi, type TapToPayPairing } from '../api/posMobilePaymentsApi';
import { posSettingsApi } from '../api/posSettingsApi';
import { useCan } from '../components/usePermissions';
import { fmtMoney, fmtNumber, fmtInZone } from '../i18n/format';
import { codeLabel } from '../components/peopleLabels';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, useFitRows, useDebounced, requestId } from '../components/FitKit';
import { PeriodBar, periodQuery, useLoad, StateBlock, isForbidden, type PeriodState } from '../components/FinanceKit';
import { PairingQr, DeviceActivityView } from '../components/TapToPayDevicesPanel';
import { useStepUp, isStepUpCancelled } from './access/accessUi';
import { humanizeCode } from '../i18n/status-label';   // the code stays the truth; only its label is translated

type Tab = 'physical' | 'phones' | 'activity' | 'audit' | 'routing';
type Status = 'ONLINE' | 'OFFLINE' | 'BUSY' | 'PROCESSING' | 'DEGRADED' | 'DISABLED' | 'UNKNOWN';
type Terminal = { id: string; label: string; model: string | null; provider: string | null; hsn: string | null; serialNumber: string | null; connectionType: string | null; branchId: string | null; branchName: string | null;
  stationId: string | null; registerName: string | null; paired: boolean; pairedAt: string | null; status: Status; group: 'online' | 'attention' | 'disabled' | 'in_use'; attention: string[];
  lastSeenAt: string | null; lastPingAt: string | null; lastPingOk: boolean | null; lastTransactionAt: string | null; disabledAt: string | null; disabledReason: string | null; matchedBy?: string | null };
type Phone = { deviceId: string; deviceRef: string; label: string | null; platform: string; osVersion: string | null; appVersion: string | null; status: string; staffName: string | null; staffPhone: string | null;
  branchName: string | null; allowedBranchIds: string[]; shared: boolean; tapToPayCapable: boolean; attestationStatus: string | null; online: boolean; createdAt: string | null; lastSeenAt: string | null;
  lastPaymentAt: string | null; lastErrorCode: string | null; revokedAt: string | null; revokeReason: string | null; payments: number; matchedBy?: string | null };
type Activity = { paymentId: string; ticketId: string; ticketNumber: string | null; processorRef: string | null; amountCents: number; tipCents: number; status: string; rawStatus: string; at: string | null; card: string | null;
  device: { kind: 'terminal' | 'iphone' | 'unlinked'; id: string | null; label: string | null; staff: string | null }; register: string | null; branch: string | null; customer: { id: string; name: string | null; phone: string | null } | null };
type Note = { tone: 'ok' | 'bad'; text: string; actions?: { label: string; run: () => void }[] } | null;
type RoutedTerminal = { id: string; label: string; status: Status; via?: 'assigned' | 'only_terminal' };
type RoutingRegister = { id: string; name: string; terminals: RoutedTerminal[]; routedTerminal: RoutedTerminal | null; problem: string | null };
type Routing = { mode: 'front_desk' | 'terminal'; registers: RoutingRegister[]; unassignedTerminals: RoutedTerminal[]; lastChange: { at: string | null; actor: string | null } | null; canEdit: boolean };
type Dlg = null | { kind: 'terminal'; id: string } | { kind: 'phone'; id: string } | { kind: 'payment'; row: Activity } | { kind: 'pair' } | { kind: 'addPhone' } | { kind: 'revoke'; phone: Phone };

const money = (c: number | null | undefined) => fmtMoney(c ?? 0);
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) || '—' : '—');
const lbl = (k: string, fb: string) => codeLabel(k, fb);
const TONE: Record<Status, string> = { ONLINE: 'ok', PROCESSING: 'info', BUSY: 'info', DEGRADED: 'warn', OFFLINE: 'bad', DISABLED: 'mut', UNKNOWN: 'warn' };
const ICON: Record<Status, string> = { ONLINE: '●', PROCESSING: '◐', BUSY: '◐', DEGRADED: '◔', OFFLINE: '✕', DISABLED: '⊘', UNKNOWN: '?' };
const PHONE_TONE: Record<string, string> = { active: 'ok', pending: 'warn', disabled: 'mut', revoked: 'bad', compromised: 'bad' };
const PAY_TONE: Record<string, string> = { approved: 'ok', declined: 'bad', failed: 'bad', pending: 'warn', refunded: 'mut', voided: 'mut' };
const MODELS = ['clover_compact', 'clover_flex', 'clover_mini', 'other'];
/** a ticket number without the '#' some writers prefix (the label adds its own) */
const tno = (n: unknown) => String(n ?? '').replace(/^#/, '');
const errMsg = (e: unknown) => (e as Error)?.message || tx('finance.state.loadFailed');

export function POSPaymentTerminalsScreen() {
  const can = useCan();
  const nav = useNavigate();
  const canEdit = can('settings.edit');
  const canDevices = can('pos.devices.manage') || can('settings.edit');   // the server resolves pos.devices.manage to settings.edit (a session carries the coarse key)
  const [tab, setTab] = useState<Tab>('physical');
  const [search, setSearch] = useState(''); const q = useDebounced(search.trim(), 300);
  const [tick, setTick] = useState(0);
  const [note, setNote] = useState<Note>(null);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [activityDevice, setActivityDevice] = useState<{ id: string; label: string } | null>(null);
  const [auditDevice, setAuditDevice] = useState<{ id: string; label: string } | null>(null);
  const refresh = () => setTick((t) => t + 1);
  const summary = useLoad(() => api.summary(), [tick]);
  const routing = useLoad<Routing>(() => api.routing(), [tick]);
  const s = summary.data?.physical, ph = summary.data?.tapToPay;
  const registers: { id: string; name: string }[] = routing.data?.registers ?? [];
  const reasonText = s ? Object.entries(s.reasons as Record<string, number>).filter(([, n]) => n > 0).map(([k, n]) => `${fmtNumber(n)} ${tx('pt.reason.' + k)}`).join(' · ') : '';
  const openActivityFor = (id: string, label: string) => { setDlg(null); setActivityDevice({ id, label }); setTab('activity'); };
  const openAuditFor = (id: string, label: string) => { setDlg(null); setAuditDevice({ id, label }); setTab('audit'); };
  if (isForbidden(summary.error)) return <div className="work fit pt" data-testid="terminals-screen"><h1>{tx('pos.payment_terminals')}</h1><StateBlock error={summary.error} onRetry={summary.reload} /></div>;

  return (
    <div className="work fit pt" data-testid="terminals-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.payment_terminals')}</h1><div className="sub">{tx('pt.subtitle')}</div></div>
        <div className="fk-head-actions">
          <button type="button" className="fk-btn" onClick={refresh} data-testid="refresh">{tx('finance.refresh')}</button>
          {canDevices ? <button type="button" className="fk-btn" onClick={() => setDlg({ kind: 'addPhone' })} data-testid="add-phone">+ {tx('pt.addPhone')}</button> : null}
          {canEdit ? <button type="button" className="fk-btn primary" onClick={() => setDlg({ kind: 'pair' })} data-testid="pair-terminal">+ {tx('pt.pairTerminal')}</button> : null}
        </div>
      </header>
      {note ? <div className={'fk-note ' + note.tone} role="status" data-testid="note"><span>{note.text}</span><span className="fn-note-acts">{note.actions?.map((a) => <button key={a.label} type="button" className="fk-link" onClick={() => { a.run(); setNote(null); }}>{a.label}</button>)}<button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></span></div> : null}

      <div className="fk-kpis" data-testid="kpis">
        {summary.error ? <StateBlock error={summary.error} onRetry={summary.reload} /> : <>
          <KpiCard testId="kpi-physical" label={tx('pt.kpi.physical')} loading={!s} value={s ? fmtNumber(s.total) : ''} sub={tx('pt.kpi.physicalSub')} onClick={() => { setTab('physical'); }} />
          <KpiCard testId="kpi-online" label={tx('pt.kpi.online')} tone={s && s.online > 0 ? 'ok' : undefined} loading={!s} value={s ? fmtNumber(s.online) : ''} sub={s ? tx('pt.kpi.onlineSub', { m: String(s.freshnessMinutes) }) : ''} onClick={() => setTab('physical')} />
          <KpiCard testId="kpi-attention" label={tx('pt.kpi.attention')} tone={s && s.needsAttention > 0 ? 'bad' : undefined} loading={!s} value={s ? fmtNumber(s.needsAttention) : ''} sub={reasonText || tx('pt.kpi.attentionNone')} onClick={() => setTab('physical')} />
          <KpiCard testId="kpi-disabled" label={tx('pt.kpi.disabled')} loading={!s} value={s ? fmtNumber(s.disabled) : ''} sub={tx('pt.kpi.disabledSub')} onClick={() => setTab('physical')} />
        </>}
      </div>

      <div className="fn-tabsrow">
        <div className="fk-seg fn-tabs" role="tablist" aria-label={tx('pt.tabs')}>
          {(['physical', 'phones', 'activity', 'audit', 'routing'] as Tab[]).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} data-testid={'tab-' + t}>
              {tx('pt.tab.' + t)}{t === 'phones' && ph ? <span className="fn-tabcount"> · {fmtNumber(ph.active)}/{fmtNumber(ph.total)}</span> : null}
            </button>
          ))}
        </div>
        {tab !== 'routing' ? (
          <div className="fn-search pt-search">
            <input className="fk-search wide" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx('pt.searchPh.' + tab)} aria-label={tx('pt.searchPh.' + tab)} data-testid="search" />
            {search ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setSearch('')}>✕</button> : null}
          </div>
        ) : null}
      </div>

      {tab === 'physical' ? <PhysicalTab q={q} tick={tick} registers={registers} highlight={highlight} onOpen={(id) => setDlg({ kind: 'terminal', id })} canEdit={canEdit} onPair={() => setDlg({ kind: 'pair' })} clearSearch={() => setSearch('')} /> : null}
      {tab === 'phones' ? <PhonesTab q={q} tick={tick} onOpen={(id) => setDlg({ kind: 'phone', id })} canDevices={canDevices} onAdd={() => setDlg({ kind: 'addPhone' })} clearSearch={() => setSearch('')} /> : null}
      {tab === 'activity' ? <ActivityTab q={q} tick={tick} device={activityDevice} clearDevice={() => setActivityDevice(null)} onOpen={(row) => setDlg({ kind: 'payment', row })} clearSearch={() => setSearch('')} /> : null}
      {tab === 'audit' ? <AuditTab q={q} tick={tick} device={auditDevice} clearDevice={() => setAuditDevice(null)} clearSearch={() => setSearch('')} onOpen={(r) => setDlg(r.kind === 'iphone' ? { kind: 'phone', id: r.deviceId } : { kind: 'terminal', id: r.deviceId })} /> : null}
      {tab === 'routing' ? <RoutingTab data={routing} canEdit={canEdit} onSaved={(t) => { setNote({ tone: 'ok', text: t }); refresh(); }} onOpenTerminal={(id) => setDlg({ kind: 'terminal', id })} /> : null}

      {dlg?.kind === 'terminal' ? <TerminalDialog id={dlg.id} canEdit={canEdit} registers={registers} onClose={() => setDlg(null)} onChanged={(t) => { setNote({ tone: 'ok', text: t }); refresh(); }} onActivity={openActivityFor} onHistory={openAuditFor} /> : null}
      {dlg?.kind === 'phone' ? <PhoneDialog id={dlg.id} canDevices={canDevices} onClose={() => setDlg(null)} onChanged={(t) => { setNote({ tone: 'ok', text: t }); refresh(); }} onRevoke={(p) => setDlg({ kind: 'revoke', phone: p })} onActivity={openActivityFor} /> : null}
      {dlg?.kind === 'revoke' ? <RevokeDialog phone={dlg.phone} physicalOnline={s?.online ?? 0} activePhones={ph?.active ?? 0} onClose={() => setDlg({ kind: 'phone', id: dlg.phone.deviceId })} onDone={(t) => { setDlg({ kind: 'phone', id: dlg.phone.deviceId }); setNote({ tone: 'ok', text: t }); refresh(); }} /> : null}
      {dlg?.kind === 'payment' ? <PaymentDialog row={dlg.row} onClose={() => setDlg(null)} onDevice={(r) => setDlg(r.device.kind === 'iphone' ? { kind: 'phone', id: r.device.id! } : { kind: 'terminal', id: r.device.id! })}
        onTicket={(r) => nav(`/tenant/payments/transactions?search=${encodeURIComponent(r.ticketNumber ?? r.paymentId)}`)} onCustomer={(cid) => nav(`/tenant/customers/profiles?customerId=${encodeURIComponent(cid)}`)} /> : null}
      {dlg?.kind === 'pair' ? <PairDialog registers={registers} onClose={() => setDlg(null)} onDone={(t, verified) => {
        setDlg(null); refresh(); setTab('physical'); setSearch(''); setHighlight(t.id); setTimeout(() => setHighlight(null), 4000);
        setNote({ tone: verified ? 'ok' : 'bad', text: tx(verified ? 'pt.paired' : 'pt.pairedUnverified', { label: t.label }), actions: [{ label: tx('pt.viewDevice'), run: () => setDlg({ kind: 'terminal', id: t.id }) }] });
      }} /> : null}
      {dlg?.kind === 'addPhone' ? <AddPhoneDialog onClose={() => { setDlg(null); refresh(); }} /> : null}
    </div>
  );
}

/** the reasons a row needs attention, minus the one its status chip already says ("Offline" twice reads as noise) */
const whyNot = (t: Pick<Terminal, 'status' | 'attention'>) => t.attention.filter((a) => !(a === 'offline' && t.status === 'OFFLINE'));

function StatusChip({ t }: { t: Pick<Terminal, 'status' | 'group'> }) {
  const tone = t.group === 'attention' && t.status !== 'OFFLINE' ? 'warn' : TONE[t.status];
  return <span className={'fk-chip ' + tone}><span aria-hidden>{ICON[t.status]} </span>{tx('pt.status.' + t.status)}</span>;
}

function PhysicalTab({ q, tick, registers, highlight, onOpen, canEdit, onPair, clearSearch }: { q: string; tick: number; registers: { id: string; name: string }[]; highlight: string | null; onOpen: (id: string) => void; canEdit: boolean; onPair: () => void; clearSearch: () => void }) {
  const [status, setStatus] = useState(''); const [register, setRegister] = useState(''); const [provider, setProvider] = useState(''); const [sort, setSort] = useState('created_desc'); const [page, setPage] = useState(1);
  const key = JSON.stringify([q, status, register, provider, sort]); useEffect(() => setPage(1), [key]);
  const fit = useFitRows<HTMLDivElement>(42, { min: 3, max: 18, reserve: 34 });
  const d = useLoad(() => api.physical({ search: q || undefined, status: status || undefined, register: register || undefined, provider: provider || undefined, sort, page, pageSize: fit.rows }), [key, page, fit.rows, tick]);
  useEffect(() => { if (d.data && d.data.page !== page) setPage(d.data.page); }, [d.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  const rows: Terminal[] = d.data?.items ?? [];
  const filtered = !!(q || status || register || provider);
  return (
    <FitPanel testId="physical" bodyRef={fit.ref} className="fn-records"
      title={<span className="fn-chips">{tx('pt.tab.physical')}{d.data ? <span className="fk-muted"> · {fmtNumber(d.data.total)}</span> : null}</span>}
      actions={<>
        <select className="fk-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={tx('finance.status')} data-testid="status">
          <option value="">{tx('finance.allStatuses')}</option>{['online', 'in_use', 'attention', 'disabled'].map((g) => <option key={g} value={g}>{tx('pt.group.' + g)}</option>)}</select>
        <select className="fk-select" value={register} onChange={(e) => setRegister(e.target.value)} aria-label={tx('pt.register')} data-testid="register-filter">
          <option value="">{tx('pt.allRegisters')}</option><option value="none">{tx('pt.noRegister')}</option>{registers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
        <select className="fk-select" value={provider} onChange={(e) => setProvider(e.target.value)} aria-label={tx('pt.processor')} data-testid="provider-filter">
          <option value="">{tx('pt.allProcessors')}</option>{PROCESSORS.map((p) => <option key={p} value={p}>{lbl('finance.processorName.' + p, p)}</option>)}<option value="none">{tx('pt.processorNotRecorded')}</option></select>
        <select className="fk-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={tx('finance.sort')} data-testid="sort">
          {['created_desc', 'created_asc', 'name_asc', 'status', 'last_seen_desc'].map((o) => <option key={o} value={o}>{tx('pt.sort.' + o)}</option>)}</select>
      </>}
      footer={<Pager info={d.data ? { page: d.data.page, pageSize: d.data.pageSize, totalItems: d.data.total, totalPages: d.data.pageCount } : null} onPage={setPage} label={tx('pt.tab.physical')} />}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !d.data ? <div className="fk-loading">{tx('pos.loading')}</div>
        : rows.length === 0 ? (filtered ? <Empty title={tx('finance.noMatches')}><button type="button" className="fk-btn" onClick={() => { clearSearch(); setStatus(''); setRegister(''); setProvider(''); }}>{tx('finance.clearFilters')}</button></Empty>
          : <Empty title={tx('pt.noTerminals')}><span className="fk-hint">{tx('pt.noTerminalsHint')}</span>{canEdit ? <button type="button" className="fk-btn primary" onClick={onPair}>+ {tx('pt.pairTerminal')}</button> : null}</Empty>)
        : <table className="fk-table fn-table" data-testid="physical-table">
          <thead><tr><th>{tx('pt.col.terminal')}</th><th className="t-opt">{tx('pt.col.type')}</th><th>{tx('pt.col.register')}</th><th>{tx('finance.status')}</th><th>{tx('pt.col.lastSeen')}</th><th className="t-opt">{tx('pt.col.lastTxn')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
          <tbody>{rows.map((t) => (
            <tr key={t.id} className={highlight === t.id ? 'fn-new' : ''} data-testid="terminal-row">
              <td className="fn-id"><button type="button" className="fk-li-t link" onClick={() => onOpen(t.id)}>{t.label || t.id}</button>
                <span className="fk-li-s">{t.hsn ? tx('pt.hsn', { v: t.hsn }) : tx('pt.noSerial')}{t.branchId ? '' : ` · ${tx('pt.allLocations')}`}{t.matchedBy && q ? ` · ${tx('pt.matched.' + t.matchedBy)}` : ''}</span></td>
              <td className="t-opt">{t.model ? lbl('pt.model.' + t.model, t.model) : tx('finance.notSet')}<span className="fk-li-s">{t.provider ? lbl('finance.processorName.' + t.provider, t.provider) : tx('pt.processorNotRecorded')}</span></td>
              <td>{t.registerName ?? (t.stationId ? <span className="fk-chip warn">{tx('pt.registerRetired')}</span> : <span className="fk-muted">{tx('pt.noRegister')}</span>)}</td>
              <td><StatusChip t={t} />{whyNot(t).length ? <span className="fk-li-s pt-why">{whyNot(t).map((a) => tx('pt.why.' + a)).join(' · ')}</span> : null}</td>
              <td>{when(t.lastSeenAt)}</td>
              <td className="t-opt">{when(t.lastTransactionAt)}</td>
              <td className="fn-acts"><button type="button" className="fk-btn ghost sm" onClick={() => onOpen(t.id)}>{tx('pt.viewDetails')}</button></td>
            </tr>))}</tbody>
        </table>}
    </FitPanel>
  );
}

function PhonesTab({ q, tick, onOpen, canDevices, onAdd, clearSearch }: { q: string; tick: number; onOpen: (id: string) => void; canDevices: boolean; onAdd: () => void; clearSearch: () => void }) {
  const [status, setStatus] = useState(''); const [sort, setSort] = useState('created_desc'); const [page, setPage] = useState(1);
  const key = JSON.stringify([q, status, sort]); useEffect(() => setPage(1), [key]);
  const fit = useFitRows<HTMLDivElement>(42, { min: 3, max: 18, reserve: 34 });
  const d = useLoad(() => api.phones({ search: q || undefined, status: status || undefined, sort, page, pageSize: fit.rows }), [key, page, fit.rows, tick]);
  useEffect(() => { if (d.data && d.data.page !== page) setPage(d.data.page); }, [d.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  const rows: Phone[] = d.data?.items ?? [];
  return (
    <FitPanel testId="phones" bodyRef={fit.ref} className="fn-records"
      title={<span className="fn-chips">{tx('pt.tab.phones')}{d.data ? <span className="fk-muted"> · {fmtNumber(d.data.total)}</span> : null}</span>}
      actions={<>
        <select className="fk-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={tx('finance.status')} data-testid="phone-status">
          <option value="">{tx('finance.allStatuses')}</option>{['active', 'pending', 'disabled', 'revoked', 'compromised'].map((g) => <option key={g} value={g}>{tx('pt.phone.' + g)}</option>)}</select>
        <select className="fk-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={tx('finance.sort')}>
          {['created_desc', 'created_asc', 'name_asc', 'status', 'last_seen_desc', 'last_payment_desc'].map((o) => <option key={o} value={o}>{tx('pt.sort.' + o)}</option>)}</select>
      </>}
      footer={<Pager info={d.data ? { page: d.data.page, pageSize: d.data.pageSize, totalItems: d.data.total, totalPages: d.data.pageCount } : null} onPage={setPage} label={tx('pt.tab.phones')} />}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !d.data ? <div className="fk-loading">{tx('pos.loading')}</div>
        : rows.length === 0 ? (q || status ? <Empty title={tx('finance.noMatches')}><button type="button" className="fk-btn" onClick={() => { clearSearch(); setStatus(''); }}>{tx('finance.clearFilters')}</button></Empty>
          : <Empty title={tx('pt.noPhones')}><span className="fk-hint">{tx('pt.noPhonesHint')}</span>{canDevices ? <button type="button" className="fk-btn primary" onClick={onAdd}>+ {tx('pt.addPhone')}</button> : null}</Empty>)
        : <table className="fk-table fn-table" data-testid="phones-table">
          <thead><tr><th>{tx('pt.col.phone')}</th><th>{tx('pt.col.staff')}</th><th className="t-opt">{tx('pt.col.platform')}</th><th>{tx('pt.col.registration')}</th><th className="t-opt">{tx('pt.col.capability')}</th><th>{tx('pt.col.lastSeen')}</th><th>{tx('pt.col.lastPayment')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.deviceId} className={p.status === 'revoked' || p.status === 'compromised' ? 'pt-revoked' : ''} data-testid="phone-row">
              <td className="fn-id"><button type="button" className="fk-li-t link" onClick={() => onOpen(p.deviceId)}>{p.label || tx('pt.unnamedPhone')}</button><span className="fk-li-s">{p.deviceRef}{p.shared ? ` · ${tx('pt.shared')}` : ''}</span></td>
              <td>{p.staffName ?? <span className="fk-muted">{p.shared ? tx('pt.shared') : tx('pt.noStaff')}</span>}{p.staffPhone ? <span className="fk-li-s">{p.staffPhone}</span> : null}</td>
              <td className="t-opt">{lbl('pt.platform.' + p.platform, p.platform)}{p.osVersion ? ` ${p.osVersion}` : ''}<span className="fk-li-s">{p.appVersion ? tx('pt.appVersion', { v: p.appVersion }) : '—'}</span></td>
              <td><span className={'fk-chip ' + (PHONE_TONE[p.status] ?? 'mut')}>{lbl('pt.phone.' + p.status, p.status)}</span>{p.status === 'revoked' && p.revokedAt ? <span className="fk-li-s">{when(p.revokedAt)}</span> : null}</td>
              <td className="t-opt">{p.tapToPayCapable ? <span className="fk-chip ok">{tx('pt.capable')}</span> : <span className="fk-chip mut">{tx('pt.notCapable')}</span>}<span className="fk-li-s">{tx('pt.reportedByPhone')}</span></td>
              <td>{p.online ? <span className="fk-chip ok">● {tx('pt.seenNow')}</span> : when(p.lastSeenAt)}</td>
              <td>{when(p.lastPaymentAt)}</td>
              <td className="fn-acts"><button type="button" className="fk-btn ghost sm" onClick={() => onOpen(p.deviceId)}>{tx('pt.viewDetails')}</button></td>
            </tr>))}</tbody>
        </table>}
    </FitPanel>
  );
}

const PROCESSORS = ['cardpointe', 'fiserv', 'clover'];
type AuditRow = { id: string; kind: 'terminal' | 'iphone'; deviceId: string; deviceLabel: string; action: string; at: string | null; actor: string | null; role: string | null; detail: Record<string, unknown> };
// Payment Terminals guide (Nov 4 2026) §16 / §17: Device Audit History — its own date range and page, newest first; revoked and
// unpaired devices stay listed
function AuditTab({ q, tick, device, clearDevice, clearSearch, onOpen }: { q: string; tick: number; device: { id: string; label: string } | null; clearDevice: () => void; clearSearch: () => void; onOpen: (r: AuditRow) => void }) {
  const [period, setPeriod] = useState<PeriodState>({ preset: 'month' });
  const [kind, setKind] = useState(''); const [page, setPage] = useState(1);
  const scope = { ...periodQuery(period), search: q || undefined, kind: kind || undefined, deviceId: device?.id };
  const key = JSON.stringify(scope); useEffect(() => setPage(1), [key]);
  const fit = useFitRows<HTMLDivElement>(42, { min: 3, max: 18, reserve: 34 });
  const d = useLoad(() => api.audit({ ...scope, page, pageSize: fit.rows }), [key, page, fit.rows, tick]);
  useEffect(() => { if (d.data && d.data.page !== page) setPage(d.data.page); }, [d.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  const rows: AuditRow[] = d.data?.items ?? [];
  const filtered = !!(q || kind || device);
  const detailText = (r: AuditRow) => Object.entries(r.detail).map(([k, v]) => k === 'reachable' ? tx(v ? 'pt.audit.reachable' : 'pt.audit.unreachable') : k === 'atPairing' ? tx('pt.audit.atPairing') : `${lbl('pt.audit.f.' + k, k)}: ${String(v)}`).join(' · ');
  return (
    <FitPanel testId="audit" bodyRef={fit.ref} className="fn-records"
      title={<span className="fn-chips">{tx('pt.tab.audit')}{d.data ? <span className="fk-muted"> · {fmtNumber(d.data.total)}</span> : null}
        {device ? <span className="fk-chip mut">{device.label}<button type="button" className="fk-chip-x" aria-label={tx('finance.removeFilter', { f: device.label })} onClick={clearDevice}>✕</button></span> : null}</span>}
      actions={<>
        <PeriodBar value={period} onChange={setPeriod} server={d.data?.period} compact />
        <select className="fk-select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label={tx('pt.col.device')} data-testid="audit-kind">
          <option value="">{tx('pt.allDevices')}</option>{['terminal', 'iphone'].map((g) => <option key={g} value={g}>{tx('pt.kind.' + g)}</option>)}</select>
      </>}
      footer={<Pager info={d.data ? { page: d.data.page, pageSize: d.data.pageSize, totalItems: d.data.total, totalPages: d.data.pageCount } : null} onPage={setPage} label={tx('pt.tab.audit')} />}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !d.data ? <div className="fk-loading">{tx('pos.loading')}</div>
        : rows.length === 0 ? <Empty title={tx('pt.noAudit')}>{filtered ? <button type="button" className="fk-btn" onClick={() => { clearSearch(); setKind(''); clearDevice(); }}>{tx('finance.clearFilters')}</button> : null}
            <button type="button" className="fk-btn" onClick={() => setPeriod({ preset: 'year' })}>{tx('finance.tryThisYear')}</button></Empty>
        : <table className="fk-table fn-table" data-testid="audit-table">
          <thead><tr><th>{tx('pt.col.time')}</th><th>{tx('pt.col.device')}</th><th>{tx('pt.audit.event')}</th><th>{tx('pt.audit.by')}</th><th className="t-opt">{tx('pt.audit.details')}</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} data-testid="audit-row">
              <td>{when(r.at)}</td>
              <td><button type="button" className="fk-li-t link" onClick={() => onOpen(r)}>{r.deviceLabel}</button><span className="fk-li-s">{tx('pt.kind.' + r.kind)}</span></td>
              <td>{lbl('pt.audit.action.' + r.action, humanizeCode(r.action.replace(/^pos_settings_terminal_|^mobile_pay_device_/, '')))}</td>
              <td>{r.actor ?? '—'}{r.role ? <span className="fk-li-s">{lbl('pos.role.' + r.role, r.role)}</span> : null}</td>
              <td className="t-opt fn-wrap">{detailText(r) || '—'}</td>
            </tr>))}</tbody>
        </table>}
    </FitPanel>
  );
}

function ActivityTab({ q, tick, device, clearDevice, onOpen, clearSearch }: { q: string; tick: number; device: { id: string; label: string } | null; clearDevice: () => void; onOpen: (r: Activity) => void; clearSearch: () => void }) {
  const [period, setPeriod] = useState<PeriodState>({ preset: 'month' });
  const [status, setStatus] = useState(''); const [kind, setKind] = useState(''); const [sort, setSort] = useState('time_desc'); const [page, setPage] = useState(1);
  const scope = { ...periodQuery(period), dateField: 'transaction', search: q || undefined, status: status || undefined, device: kind || undefined, deviceId: device?.id, sort };
  const key = JSON.stringify(scope); useEffect(() => setPage(1), [key]);
  const fit = useFitRows<HTMLDivElement>(42, { min: 3, max: 18, reserve: 34 });
  const d = useLoad(() => api.activity({ ...scope, page, pageSize: fit.rows }), [key, page, fit.rows, tick]);
  useEffect(() => { if (d.data && d.data.page !== page) setPage(d.data.page); }, [d.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  const rows: Activity[] = d.data?.items ?? [];
  const filtered = !!(q || status || kind || device);
  return (
    <FitPanel testId="activity" bodyRef={fit.ref} className="fn-records"
      title={<span className="fn-chips">{tx('pt.tab.activity')}{d.data ? <span className="fk-muted"> · {fmtNumber(d.data.total)}</span> : null}
        {device ? <span className="fk-chip mut">{device.label}<button type="button" className="fk-chip-x" aria-label={tx('finance.removeFilter', { f: device.label })} onClick={clearDevice}>✕</button></span> : null}</span>}
      actions={<>
        <PeriodBar value={period} onChange={setPeriod} server={d.data?.period} compact />
        <select className="fk-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={tx('finance.status')} data-testid="activity-status">
          <option value="">{tx('finance.allStatuses')}</option>{['approved', 'declined', 'failed', 'pending', 'refunded', 'voided'].map((g) => <option key={g} value={g}>{tx('pt.pay.' + g)}</option>)}</select>
        <select className="fk-select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label={tx('pt.col.device')} data-testid="activity-device">
          <option value="">{tx('pt.allDevices')}</option>{['terminal', 'iphone', 'unlinked'].map((g) => <option key={g} value={g}>{tx('pt.kind.' + g)}</option>)}</select>
        <select className="fk-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={tx('finance.sort')}>
          {['time_desc', 'time_asc', 'amount_desc', 'amount_asc'].map((o) => <option key={o} value={o}>{tx('pt.sort.' + o)}</option>)}</select>
      </>}
      footer={<Pager info={d.data ? { page: d.data.page, pageSize: d.data.pageSize, totalItems: d.data.total, totalPages: d.data.pageCount } : null} onPage={setPage} label={tx('pt.tab.activity')} />}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !d.data ? <div className="fk-loading">{tx('pos.loading')}</div>
        : rows.length === 0 ? <Empty title={tx('pt.noActivity')}>{filtered ? <button type="button" className="fk-btn" onClick={() => { clearSearch(); setStatus(''); setKind(''); clearDevice(); }}>{tx('finance.clearFilters')}</button> : null}
            <button type="button" className="fk-btn" onClick={() => setPeriod({ preset: 'year' })}>{tx('finance.tryThisYear')}</button></Empty>
        : <table className="fk-table fn-table" data-testid="activity-table">
          <thead><tr><th>{tx('pt.col.time')}</th><th>{tx('pt.col.transaction')}</th><th>{tx('pt.col.customer')}</th><th className="num">{tx('pt.col.amount')}</th><th>{tx('finance.status')}</th><th>{tx('pt.col.device')}</th><th className="t-opt">{tx('pt.col.register')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.paymentId} data-testid="activity-row">
              <td>{when(r.at)}</td>
              <td className="fn-id"><button type="button" className="fk-li-t link" onClick={() => onOpen(r)}>{r.processorRef ?? tx('pt.noProcessorRef')}</button><span className="fk-li-s">{r.ticketNumber ? `#${tno(r.ticketNumber)}` : '—'}{r.card ? ` · ${r.card}` : ''}</span></td>
              <td>{r.customer ? <>{r.customer.name ?? '—'}{r.customer.phone ? <span className="fk-li-s">{r.customer.phone}</span> : null}</> : <span className="fk-muted">{tx('pt.unlinkedCustomer')}</span>}</td>
              <td className="num"><b>{money(r.amountCents)}</b></td>
              <td><span className={'fk-chip ' + (PAY_TONE[r.status] ?? 'mut')}>{tx('pt.pay.' + r.status)}</span></td>
              <td>{r.device.kind === 'unlinked' ? <span className="fk-muted">{tx('pt.deviceNotLinked')}</span> : <>{r.device.label}<span className="fk-li-s">{tx('pt.kind.' + r.device.kind)}{r.device.staff ? ` · ${r.device.staff}` : ''}</span></>}</td>
              <td className="t-opt">{r.register ?? '—'}</td>
              <td className="fn-acts"><button type="button" className="fk-btn ghost sm" onClick={() => onOpen(r)}>{tx('finance.view')}</button></td>
            </tr>))}</tbody>
        </table>}
    </FitPanel>
  );
}

function RoutingTab({ data, canEdit, onSaved, onOpenTerminal }: { data: { data: Routing | null; error: unknown; reload: () => void }; canEdit: boolean; onSaved: (t: string) => void; onOpenTerminal: (id: string) => void }) {
  const stepUp = useStepUp();
  const r = data.data;
  const [mode, setMode] = useState<'front_desk' | 'terminal' | null>(null);
  const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (r) setMode(r.mode); }, [r?.mode]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (data.error) return <FitPanel testId="routing" title={tx('pt.tab.routing')}><StateBlock error={data.error} onRetry={data.reload} /></FitPanel>;
  if (!r || !mode) return <FitPanel testId="routing" title={tx('pt.tab.routing')}><div className="fk-loading">{tx('pos.loading')}</div></FitPanel>;
  const save = async () => {
    setBusy(true); setErr(null);
    try { await stepUp.run(() => posSettingsApi.updateCategory('payments-checkout', { customerDisplayCaptureMode: mode })); setConfirm(false); onSaved(tx('pt.routingSaved', { mode: tx('pt.mode.' + mode) })); }
    catch (e) { if (!isStepUpCancelled(e)) setErr(errMsg(e)); }
    finally { setBusy(false); }
  };
  const problems = r.registers.filter((x) => x.problem).length;
  return (
    <div className="pt-routing" data-testid="routing">
      <FitPanel testId="routing-mode" title={tx('pt.routingTitle')} actions={<span className="fk-hint">{r.lastChange ? tx('pt.lastChange', { who: r.lastChange.actor ?? '—', when: when(r.lastChange.at) }) : tx('pt.neverChanged')}</span>}>
        <div className="pt-modes" role="radiogroup" aria-label={tx('pt.routingTitle')}>
          {(['terminal', 'front_desk'] as const).map((m) => (
            <label key={m} className={'pt-mode' + (mode === m ? ' on' : '')} data-testid={'mode-' + m}>
              <input type="radio" name="capture-mode" checked={mode === m} disabled={!canEdit || busy} onChange={() => setMode(m)} />
              <span className="pt-mode-t">{tx('pt.mode.' + m)}{r.mode === m ? <span className="fk-chip ok">{tx('pt.current')}</span> : null}</span>
              <span className="pt-mode-d">{tx('pt.modeDesc.' + m)}</span>
            </label>
          ))}
        </div>
        <div className="fk-hint">{tx('pt.fallbackNote')}</div>
        {canEdit ? (confirm ? <div className="fk-void"><span>{tx('pt.confirmRouting', { mode: tx('pt.mode.' + mode) })}</span>
            <button type="button" className="fk-btn" onClick={() => setConfirm(false)} disabled={busy}>{tx('pos.cancel')}</button>
            <button type="button" className="fk-btn primary" onClick={save} disabled={busy} data-testid="confirm-routing">{busy ? tx('pos.saving') : tx('pt.saveRouting')}</button></div>
          : <button type="button" className="fk-btn primary" disabled={mode === r.mode} onClick={() => setConfirm(true)} data-testid="save-routing">{tx('pt.saveRouting')}</button>)
          : <div className="fk-hint">{tx('pt.routingReadOnly')}</div>}
        {err ? <div className="fk-err" role="alert">{err}</div> : null}
        {stepUp.prompt}
      </FitPanel>
      <FitPanel testId="routing-registers" title={<>{tx('pt.registersTitle')}{problems ? <span className="fk-chip warn"> {tx('pt.registerProblems', { n: fmtNumber(problems) })}</span> : null}</>}>
        {r.registers.length === 0 ? <Empty title={tx('pt.noRegisters')}><span className="fk-hint">{tx('pt.noRegistersHint')}</span></Empty> :
          <table className="fk-table fn-table" data-testid="routing-table"><thead><tr><th>{tx('pt.col.register')}</th><th>{tx('pt.col.routedTo')}</th><th>{tx('finance.status')}</th><th>{tx('pt.col.note')}</th></tr></thead>
            <tbody>{r.registers.map((x) => <tr key={x.id}><td><b>{x.name}</b></td>
              <td>{x.routedTerminal ? <button type="button" className="fk-link" onClick={() => onOpenTerminal(x.routedTerminal!.id)}>{x.routedTerminal.label}</button> : <span className="fk-muted">{tx('pt.noTerminal')}</span>}{x.routedTerminal?.via === 'only_terminal' ? <span className="fk-li-s">{tx('pt.viaOnly')}</span> : null}</td>
              <td>{x.routedTerminal ? <StatusChip t={{ status: x.routedTerminal.status, group: x.problem === 'terminal_needs_attention' ? 'attention' : 'online' }} /> : '—'}</td>
              <td className="fn-wrap">{x.problem ? tx('pt.problem.' + x.problem) : tx('pt.problem.none')}</td></tr>)}</tbody></table>}
        {r.unassignedTerminals.length ? <div className="fk-hint">{tx('pt.unassigned', { list: r.unassignedTerminals.map((t) => t.label).join(', ') })}</div> : null}
      </FitPanel>
    </div>
  );
}

function TerminalDialog({ id, canEdit, registers, onClose, onChanged, onActivity, onHistory }: { id: string; canEdit: boolean; registers: { id: string; name: string }[]; onClose: () => void; onChanged: (t: string) => void; onActivity: (id: string, label: string) => void; onHistory?: (id: string, label: string) => void }) {
  const d = useLoad(() => api.physicalDetail(id), [id]);
  const stepUp = useStepUp(tx('pos.stepup_terminals_needs_password'));
  const [busy, setBusy] = useState<string | null>(null); const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [ask, setAsk] = useState<null | { kind: 'rename' | 'disable' | 'unpair'; value: string }>(null);
  const t: Terminal | undefined = d.data?.terminal;
  const run = async (k: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(k); setMsg(null);
    try { await stepUp.run(fn); setAsk(null); d.reload(); onChanged(ok); }
    catch (e) { if (!isStepUpCancelled(e)) setMsg({ tone: 'bad', text: errMsg(e) }); }
    finally { setBusy(null); }
  };
  const test = async () => {
    if (!t) return; setBusy('test'); setMsg(null);
    try { const r = await posDevicesApi.testTerminal(t.id); setMsg({ tone: r.reachable ? 'ok' : 'bad', text: r.probed === false ? tx('pt.testNotProbed', { d: r.detail }) : r.detail }); d.reload(); }
    catch (e) { setMsg({ tone: 'bad', text: errMsg(e) }); }
    finally { setBusy(null); }
  };
  return (
    <FitDialog wide title={t ? t.label || t.id : tx('pt.terminal')} subtitle={t ? `${t.model ? lbl('pt.model.' + t.model, t.model) : tx('finance.notSet')} · ${t.branchName ?? tx('payment.terminal.noLocation')}` : undefined} onClose={onClose} busy={!!busy} testId="terminal-dialog"
      footer={t ? <>
        <button type="button" className="fk-btn" onClick={() => d.reload()} disabled={!!busy} data-testid="refresh-status">{tx('pt.refreshStatus')}</button>
        {canEdit && t.paired && t.status !== 'DISABLED' ? <button type="button" className="fk-btn" onClick={test} disabled={!!busy} data-testid="test-connection">{busy === 'test' ? tx('pt.testing') : tx('pos.test_connection')}</button> : null}
        <button type="button" className="fk-btn" onClick={() => onActivity(t.id, t.label)}>{tx('pt.viewActivity')}</button>
        {onHistory ? <button type="button" className="fk-btn" onClick={() => onHistory(t.id, t.label)} data-testid="terminal-history">{tx('pt.viewHistory')}</button> : null}
        {canEdit ? <button type="button" className="fk-btn" onClick={() => setAsk({ kind: 'rename', value: t.label })} disabled={!!busy}>{tx('pos.rename')}</button> : null}
        {canEdit ? (t.status === 'DISABLED' ? <button type="button" className="fk-btn" disabled={!!busy} onClick={() => run('enable', () => posDevicesApi.enableTerminal(t.id), tx('pt.enabled', { label: t.label }))} data-testid="enable">{tx('pos.enable')}</button>
          : <button type="button" className="fk-btn danger" disabled={!!busy} onClick={() => setAsk({ kind: 'disable', value: '' })} data-testid="disable">{tx('pos.disable')}</button>) : null}
        {/* Fiserv §5.2 (merged Nov 7 2026): a terminal paired with no location takes NO card payments anywhere until assigned */}
        {canEdit && t.paired && !t.branchId ? <button type="button" className="fk-btn primary" disabled={!!busy} onClick={() => run('assign', () => posDevicesApi.assignTerminalLocation(t.id), tx('payment.terminal.assigned', { label: t.label }))} data-testid="assign-location">{tx('payment.terminal.assignHere')}</button> : null}
        {canEdit && t.paired ? <button type="button" className="fk-btn danger" disabled={!!busy} onClick={() => setAsk({ kind: 'unpair', value: '' })} data-testid="unpair">{tx('pos.unpair')}</button> : null}
        <button type="button" className="fk-btn primary" onClick={onClose}>{tx('pos.close')}</button></> : undefined}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !t ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        {!t.branchId ? <div className="fk-preview bad" data-testid="unassigned-warning">{tx('payment.terminal.unassignedWarning')}</div> : null}
        <div className="fn-statusline"><StatusChip t={t} /><span className="fk-hint">{tx('pt.statusSource', { m: String(d.data.freshnessMinutes) })}</span></div>
        {t.attention.length ? <div className="fk-preview bad" data-testid="troubleshoot">{t.attention.map((a) => <div key={a}><b>{tx('pt.why.' + a)}</b> — {tx('pt.fix.' + a)}</div>)}</div> : null}
        <div className="fn-cols2">
          <dl className="fk-dl">
            <dt>{tx('pt.f.name')}</dt><dd><b>{t.label || '—'}</b></dd>
            <dt>{tx('pt.f.id')}</dt><dd className="fn-mono">{t.id}</dd>
            <dt>{tx('pt.f.serial')}</dt><dd className="fn-mono">{t.hsn ?? tx('pt.noSerial')}{t.serialNumber ? ` · S/N ${t.serialNumber}` : ''}</dd>
            <dt>{tx('pt.f.model')}</dt><dd>{t.model ? lbl('pt.model.' + t.model, t.model) : tx('finance.notSet')}{t.connectionType ? ` · ${t.connectionType}` : ''}</dd>
            <dt>{tx('pt.f.processor')}</dt><dd>{t.provider ? lbl('finance.processorName.' + t.provider, t.provider) : tx('pt.processorNotRecorded')}</dd>
            <dt>{tx('pt.f.location')}</dt><dd>{t.branchName ?? tx('pt.allLocations')}</dd>
            <dt>{tx('pt.f.register')}</dt><dd>{canEdit && registers.length ? (
              <select className="fk-select" value={registers.some((r) => r.id === t.stationId) ? t.stationId! : ''} disabled={!!busy} aria-label={tx('pt.assignRegister')} data-testid="assign-register"
                onChange={(e) => run('reg', () => posDevicesApi.setTerminalRegister(t.id, e.target.value || null), tx('pt.registerSaved', { label: t.label }))}>
                <option value="">{tx('pt.noRegister')}</option>{registers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>) : (t.registerName ?? tx('pt.noRegister'))}</dd>
            <dt>{tx('pt.f.pairing')}</dt><dd>{t.paired ? tx('pt.pairedOn', { when: when(t.pairedAt) }) : tx('pt.why.pairing_incomplete')}</dd>
          </dl>
          <dl className="fk-dl">
            <dt>{tx('pt.col.lastSeen')}</dt><dd>{when(t.lastSeenAt)}</dd>
            <dt>{tx('pt.f.lastPing')}</dt><dd>{t.lastPingAt ? `${when(t.lastPingAt)} · ${t.lastPingOk ? tx('pt.pingOk') : tx('pt.pingFailed')}` : tx('pt.neverTested')}</dd>
            <dt>{tx('pt.col.lastTxn')}</dt><dd>{when(t.lastTransactionAt)}</dd>
            <dt>{tx('pt.f.firmware')}</dt><dd className="fk-muted">{tx('pt.notAvailable')}</dd>
            {t.disabledAt ? <><dt>{tx('pt.f.disabled')}</dt><dd>{when(t.disabledAt)}{t.disabledReason ? ` · ${t.disabledReason}` : ''}</dd></> : null}
          </dl>
        </div>
        {ask ? <div className="fk-void" data-testid="terminal-ask">
          {ask.kind === 'unpair' ? <span>{tx('pt.unpairConfirm', { label: t.label })}</span>
            : <label className="fk-field"><span>{tx(ask.kind === 'rename' ? 'pt.newName' : 'pt.disableReason')}</span><input value={ask.value} maxLength={80} onChange={(e) => setAsk({ ...ask, value: e.target.value })} data-autofocus data-testid="ask-input" /></label>}
          <button type="button" className="fk-btn" onClick={() => setAsk(null)} disabled={!!busy}>{tx('pos.cancel')}</button>
          <button type="button" className={'fk-btn ' + (ask.kind === 'rename' ? 'primary' : 'danger')} disabled={!!busy || (ask.kind !== 'unpair' && ask.value.trim().length < (ask.kind === 'disable' ? 3 : 1))} data-testid="ask-confirm"
            onClick={() => ask.kind === 'rename' ? run('rename', () => posDevicesApi.renameTerminal(t.id, { label: ask.value.trim() }), tx('pt.renamed', { label: ask.value.trim() }))
              : ask.kind === 'disable' ? run('disable', () => posDevicesApi.disableTerminal(t.id, ask.value.trim()), tx('pt.disabled', { label: t.label }))
              : run('unpair', () => posDevicesApi.unpairTerminal(t.id), tx('pt.unpaired', { label: t.label }))}>{tx(ask.kind === 'rename' ? 'pos.rename' : ask.kind === 'disable' ? 'pos.disable' : 'pos.unpair')}</button>
        </div> : null}
        {msg ? <div className={msg.tone === 'ok' ? 'fk-preview' : 'fk-err'} role="status" data-testid="terminal-msg">{msg.text}</div> : null}
        <h3 className="fk-h3">{tx('pt.recentPayments')}</h3>
        {d.data.recentPayments.length === 0 ? <div className="fk-hint">{tx('pt.noRecentPayments')}</div> :
          <table className="fk-table"><tbody>{d.data.recentPayments.map((p: any) => <tr key={p.paymentId}><td>{when(p.at)}</td><td>{p.ticketNumber ? '#' + tno(p.ticketNumber) : '—'}</td><td>{lbl('pt.pay.' + p.status, p.status)}</td><td className="num">{money(p.amountCents)}</td></tr>)}</tbody></table>}
        <h3 className="fk-h3">{tx('pt.history')}</h3>
        {d.data.history.length === 0 ? <div className="fk-hint">{tx('pt.noHistory')}</div> :
          <ul className="fn-notes">{d.data.history.slice(0, 8).map((h: any, i: number) => <li key={i}><span className="fk-li-s">{when(h.at)} · {h.actor ?? h.role ?? '—'}</span><div>{lbl('pt.audit.' + String(h.action).replace(/^pos_settings_terminal_/, ''), String(h.action))}</div></li>)}</ul>}
      </>}
      {stepUp.prompt}
    </FitDialog>
  );
}

function PhoneDialog({ id, canDevices, onClose, onChanged, onRevoke, onActivity }: { id: string; canDevices: boolean; onClose: () => void; onChanged: (t: string) => void; onRevoke: (p: Phone) => void; onActivity: (id: string, label: string) => void }) {
  const d = useLoad(() => api.phoneDetail(id), [id]);
  const stepUp = useStepUp(tx('pt.stepupDevice'));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [history, setHistory] = useState(false);
  const [suspending, setSuspending] = useState<string | null>(null);
  const p: (Phone & { deviceIdFull: string }) | undefined = d.data?.device;
  const run = async (fn: () => Promise<unknown>, ok: string) => { setBusy(true); setErr(null); try { await stepUp.run(fn); setSuspending(null); d.reload(); onChanged(ok); } catch (e) { if (!isStepUpCancelled(e)) setErr(errMsg(e)); } finally { setBusy(false); } };
  const ended = p && (p.status === 'revoked' || p.status === 'compromised');
  return (
    <FitDialog wide title={p ? p.label || tx('pt.unnamedPhone') : tx('pt.phoneTitle')} subtitle={p ? `${lbl('pt.platform.' + p.platform, p.platform)}${p.osVersion ? ' ' + p.osVersion : ''} · ${p.branchName ?? '—'}` : undefined} onClose={onClose} busy={busy} testId="phone-dialog"
      footer={p ? <>
        <button type="button" className="fk-btn" onClick={() => d.reload()} disabled={busy}>{tx('pt.refreshStatus')}</button>
        <button type="button" className="fk-btn" onClick={() => onActivity(p.deviceId, p.label ?? p.deviceRef)}>{tx('pt.viewActivity')}</button>
        {canDevices ? <button type="button" className="fk-btn" onClick={() => setHistory((h) => !h)}>{tx('pt.signinsHistory')}</button> : null}
        {canDevices && p.status === 'pending' ? <button type="button" className="fk-btn" disabled={busy} onClick={() => run(() => posMobilePaymentsApi.approve(p.deviceId), tx('pt.approved', { label: p.label ?? p.deviceRef }))} data-testid="approve">{tx('pt.approve')}</button> : null}
        {canDevices && p.status === 'active' ? <button type="button" className="fk-btn" disabled={busy} onClick={() => setSuspending('')} data-testid="suspend">{tx('pt.suspend')}</button> : null}
        {canDevices && p.status === 'disabled' ? <button type="button" className="fk-btn" disabled={busy} onClick={() => run(() => posMobilePaymentsApi.approve(p.deviceId), tx('pt.reenabled', { label: p.label ?? p.deviceRef }))} data-testid="reenable">{tx('pt.reenable')}</button> : null}
        {canDevices && !ended ? <button type="button" className="fk-btn danger" disabled={busy} onClick={() => onRevoke(p)} data-testid="revoke">{tx('pt.revoke')}</button> : null}
        <button type="button" className="fk-btn primary" onClick={onClose}>{tx('pos.close')}</button></> : undefined}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !p ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="fn-statusline"><span className={'fk-chip ' + (PHONE_TONE[p.status] ?? 'mut')}>{lbl('pt.phone.' + p.status, p.status)}</span>
          <span className="fk-hint">{ended ? tx('pt.revokedNote') : tx('pt.activeIsNotOnline')}</span></div>
        <div className="fn-cols2">
          <dl className="fk-dl">
            <dt>{tx('pt.f.registration')}</dt><dd className="fn-mono">{p.deviceIdFull}</dd>
            <dt>{tx('pt.col.staff')}</dt><dd>{p.staffName ?? (p.shared ? tx('pt.shared') : tx('pt.noStaff'))}{p.staffPhone ? ` · ${p.staffPhone}` : ''}</dd>
            <dt>{tx('pt.col.platform')}</dt><dd>{lbl('pt.platform.' + p.platform, p.platform)} {p.osVersion ?? ''}{p.appVersion ? ` · ${tx('pt.appVersion', { v: p.appVersion })}` : ''}</dd>
            <dt>{tx('pt.col.capability')}</dt><dd>{p.tapToPayCapable ? tx('pt.capable') : tx('pt.notCapable')} · {lbl('pt.attestation.' + (p.attestationStatus ?? 'none'), p.attestationStatus ?? '—')}</dd>
            <dt>{tx('pt.f.registered')}</dt><dd>{when(p.createdAt)}</dd>
          </dl>
          <dl className="fk-dl">
            <dt>{tx('pt.col.lastSeen')}</dt><dd>{p.online ? tx('pt.seenNow') : when(p.lastSeenAt)}</dd>
            <dt>{tx('pt.col.lastPayment')}</dt><dd>{when(p.lastPaymentAt)} · {tx('pt.paymentsN', { n: fmtNumber(p.payments) })}</dd>
            {p.lastErrorCode ? <><dt>{tx('pt.f.lastError')}</dt><dd>{p.lastErrorCode}</dd></> : null}
            {p.revokedAt ? <><dt>{tx('pt.f.revoked')}</dt><dd>{when(p.revokedAt)}{p.revokeReason ? ` · ${p.revokeReason}` : ''}</dd></> : null}
          </dl>
        </div>
        {suspending != null ? <div className="fk-void"><label className="fk-field"><span>{tx('pt.suspendReason')}</span><input value={suspending} onChange={(e) => setSuspending(e.target.value)} maxLength={200} data-autofocus /></label>
          <button type="button" className="fk-btn" onClick={() => setSuspending(null)}>{tx('pos.cancel')}</button>
          <button type="button" className="fk-btn danger" disabled={busy || suspending.trim().length < 3} onClick={() => run(() => posMobilePaymentsApi.suspend(p.deviceId, suspending.trim()), tx('pt.suspended', { label: p.label ?? p.deviceRef }))}>{tx('pt.suspend')}</button></div> : null}
        {err ? <div className="fk-err" role="alert">{err}</div> : null}
        <h3 className="fk-h3">{tx('pt.recentPayments')}</h3>
        {d.data.recentPayments.length === 0 ? <div className="fk-hint">{tx('pt.noRecentPayments')}</div> :
          <table className="fk-table"><tbody>{d.data.recentPayments.map((x: any) => <tr key={x.paymentId}><td>{when(x.at)}</td><td>{x.ticketNumber ? '#' + tno(x.ticketNumber) : '—'}</td><td>{lbl('pt.pay.' + x.status, x.status)}</td><td className="num">{money(x.amountCents)}</td></tr>)}</tbody></table>}
        {history ? <DeviceActivityView deviceId={p.deviceId} branchName={() => p.branchName ?? '—'} /> : null}
      </>}
      {stepUp.prompt}
    </FitDialog>
  );
}

/** Revocation is a security action: it names the phone, the staff member and the impact; it warns when the phone is the
 *  location's last working way to take a card; it shows success only after the server confirms. */
function RevokeDialog({ phone, physicalOnline, activePhones, onClose, onDone }: { phone: Phone; physicalOnline: number; activePhones: number; onClose: () => void; onDone: (t: string) => void }) {
  const stepUp = useStepUp(tx('pt.stepupDevice'));
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const last = phone.status === 'active' && activePhones <= 1 && physicalOnline === 0;
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r: any = await stepUp.run(() => posMobilePaymentsApi.revoke(phone.deviceId, reason.trim()));
      if (r?.status && r.status !== 'revoked') { setErr(tx('pt.revokePending', { s: String(r.status) })); setBusy(false); return; }
      onDone(tx('pt.revoked', { label: phone.label ?? phone.deviceRef }));
    } catch (e) { if (!isStepUpCancelled(e)) setErr(errMsg(e)); setBusy(false); }
  };
  return (
    <FitDialog title={tx('pt.revokeTitle', { label: phone.label ?? phone.deviceRef })} subtitle={phone.staffName ?? (phone.shared ? tx('pt.shared') : tx('pt.noStaff'))} onClose={onClose} busy={busy} testId="revoke-dialog"
      footer={<><button type="button" className="fk-btn" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button>
        <button type="button" className="fk-btn danger" disabled={busy || reason.trim().length < 3} onClick={submit} data-testid="confirm-revoke">{busy ? tx('pos.saving') : tx('pt.revoke')}</button></>}>
      <div className="fk-preview bad">{tx('pt.revokeImpact')}</div>
      {last ? <div className="fk-err" role="alert" data-testid="last-capture-warning">{tx('pt.lastCaptureWarning')}</div> : null}
      <label className="fk-field"><span>{tx('pt.revokeReason')} *</span><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} data-autofocus data-testid="revoke-reason" /></label>
      <div className="fk-hint">{tx('pt.reRegisterNote')}</div>
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
      {stepUp.prompt}
    </FitDialog>
  );
}

function PaymentDialog({ row, onClose, onDevice, onTicket, onCustomer }: { row: Activity; onClose: () => void; onDevice: (r: Activity) => void; onTicket: (r: Activity) => void; onCustomer: (id: string) => void }) {
  return (
    <FitDialog title={tx('pt.paymentTitle', { a: money(row.amountCents) })} subtitle={when(row.at)} onClose={onClose} testId="payment-dialog"
      footer={<>{row.device.id ? <button type="button" className="fk-btn" onClick={() => onDevice(row)}>{tx('pt.viewDevice')}</button> : null}
        <button type="button" className="fk-btn" onClick={() => onTicket(row)}>{tx('pt.openTicket')}</button>
        {row.customer ? <button type="button" className="fk-btn" onClick={() => onCustomer(row.customer!.id)}>{tx('finance.openCustomer')}</button> : null}
        <button type="button" className="fk-btn primary" onClick={onClose}>{tx('pos.close')}</button></>}>
      <dl className="fk-dl">
        <dt>{tx('finance.status')}</dt><dd><span className={'fk-chip ' + (PAY_TONE[row.status] ?? 'mut')}>{tx('pt.pay.' + row.status)}</span> <span className="fk-hint">{row.rawStatus}</span></dd>
        <dt>{tx('pt.col.amount')}</dt><dd><b>{money(row.amountCents)}</b>{row.tipCents ? ` · ${tx('pt.tip', { a: money(row.tipCents) })}` : ''}</dd>
        <dt>{tx('pt.f.processorRef')}</dt><dd className="fn-mono">{row.processorRef ?? tx('pt.noProcessorRef')}</dd>
        <dt>{tx('pt.f.ticket')}</dt><dd>{row.ticketNumber ? '#' + tno(row.ticketNumber) : '—'}{row.card ? ` · ${row.card}` : ''}</dd>
        <dt>{tx('pt.col.device')}</dt><dd>{row.device.kind === 'unlinked' ? tx('pt.deviceNotLinkedLong') : `${row.device.label} · ${tx('pt.kind.' + row.device.kind)}${row.device.staff ? ' · ' + row.device.staff : ''}`}</dd>
        <dt>{tx('pt.col.register')}</dt><dd>{row.register ?? '—'}{row.branch ? ` · ${row.branch}` : ''}</dd>
        <dt>{tx('pt.col.customer')}</dt><dd>{row.customer ? `${row.customer.name ?? '—'}${row.customer.phone ? ' · ' + row.customer.phone : ''}` : tx('pt.unlinkedCustomer')}</dd>
      </dl>
      <div className="fk-hint">{tx('pt.traceNote')}</div>
    </FitDialog>
  );
}

/** Pair Terminal: 1 model + name · 2 identify (pairing code + serial) · 3 register (a register already served is flagged) ·
 *  4 verify (the provider's non-charge ping) · 5 done. An unverified terminal is saved but never shown as Online. */
function PairDialog({ registers, onClose, onDone }: { registers: { id: string; name: string }[]; onClose: () => void; onDone: (t: { id: string; label: string }, verified: boolean) => void }) {
  const stepUp = useStepUp(tx('pos.stepup_terminals_needs_password'));
  const [step, setStep] = useState(1);
  const [model, setModel] = useState('clover_compact'); const [label, setLabel] = useState(tx('pos.front_counter_clover'));
  const [code, setCode] = useState(''); const [hsn, setHsn] = useState(''); const [station, setStation] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<{ id: string; label: string } | null>(null); const [verify, setVerify] = useState<{ ok: boolean; detail: string } | null>(null);
  const routing = useLoad<Routing>(() => api.routing(), []);
  // Payment Terminals guide (Nov 4 2026) §07 step 1: the processor account of this location; one request key per dialog
  const procs = useLoad(() => posDevicesApi.terminalProcessors(), []);
  const [merchant, setMerchant] = useState('');
  useEffect(() => { const first = procs.data?.items?.find((p) => p.usable); if (first && !merchant) setMerchant(first.id); }, [procs.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  const pairKey = useRef(requestId());
  const taken = (routing.data?.registers ?? []).find((r: RoutingRegister) => r.id === station && r.terminals?.length);
  const submitting = useRef(false);
  const pair = async () => {
    if (submitting.current) return; submitting.current = true; setBusy(true); setErr(null);
    try {
      const r = await stepUp.run(() => posDevicesApi.pairTerminal({ code, label: label.trim(), stationId: station || undefined, hsn: hsn.trim() || undefined, merchantAccountId: merchant || undefined, idempotencyKey: pairKey.current }));
      if (r?.id && model) await posDevicesApi.renameTerminal(r.id, { terminalType: model });
      setMade({ id: r.id, label: label.trim() }); setStep(4);
      // the server verifies at pairing when it can (a non-charge probe); otherwise the readiness test answers honestly
      if (r?.verification) setVerify({ ok: !!r.verification.reachable, detail: r.verification.detail });
      else { try { const v = await posDevicesApi.testTerminal(r.id); setVerify({ ok: !!v.reachable, detail: v.detail }); } catch (e) { setVerify({ ok: false, detail: errMsg(e) }); } }
    } catch (e) { if (!isStepUpCancelled(e)) setErr(errMsg(e)); }
    finally { setBusy(false); submitting.current = false; }
  };
  const okIdentify = /^\d{6}$/.test(code) && label.trim().length > 0;
  return (
    <FitDialog wide title={tx('pt.pairTitle')} subtitle={tx('pt.pairStep', { n: String(step) })} onClose={onClose} busy={busy} testId="pair-dialog"
      footer={<>
        {step < 4 ? <button type="button" className="fk-btn" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button> : null}
        {step > 1 && step < 4 ? <button type="button" className="fk-btn" onClick={() => setStep(step - 1)} disabled={busy}>{tx('pt.back')}</button> : null}
        {step === 1 ? <button type="button" className="fk-btn primary" disabled={!label.trim()} onClick={() => setStep(2)} data-testid="pair-next">{tx('pt.next')}</button> : null}
        {step === 2 ? <button type="button" className="fk-btn primary" disabled={!okIdentify} onClick={() => setStep(3)} data-testid="pair-next">{tx('pt.next')}</button> : null}
        {step === 3 ? <button type="button" className="fk-btn primary" disabled={busy || !okIdentify} onClick={pair} data-testid="pair-submit">{busy ? tx('pos.pairing_2') : tx('pt.pairAndVerify')}</button> : null}
        {step === 4 && made ? <button type="button" className="fk-btn primary" disabled={!verify} onClick={() => onDone(made, !!verify?.ok)} data-testid="pair-done">{tx('pt.done')}</button> : null}
      </>}>
      <ol className="pt-steps" aria-label={tx('pt.pairTitle')}>{[1, 2, 3, 4].map((n) => <li key={n} className={n === step ? 'on' : n < step ? 'done' : ''}>{tx('pt.pairStepName.' + n)}</li>)}</ol>
      {step === 1 ? <div className="fk-grid2">
        <label className="fk-field"><span>{tx('pos.device_model')}</span><select value={model} onChange={(e) => setModel(e.target.value)} data-testid="pair-model">{MODELS.map((m) => <option key={m} value={m}>{lbl('pt.model.' + m, m)}</option>)}</select></label>
        <label className="fk-field"><span>{tx('pos.terminal_label')} *</span><input value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} data-autofocus data-testid="pair-label" /></label>
        <label className="fk-field span2"><span>{tx('pt.processor')}</span>
          {procs.error ? <span className="fk-hint">{tx('pt.processorLoadFailed')}</span> : !procs.data ? <span className="fk-hint">{tx('pos.loading')}</span>
            : procs.data.items.length === 0 ? <span className="fk-hint" data-testid="pair-no-processor">{tx('pt.noProcessorAccount')}</span>
            : <select value={merchant} onChange={(e) => setMerchant(e.target.value)} data-testid="pair-processor">{procs.data.items.map((p) => <option key={p.id} value={p.id} disabled={!p.usable}>
                {lbl('finance.processorName.' + p.processor, p.processor)}{p.displayName ? ` · ${p.displayName}` : ''}{p.environment === 'sandbox' ? ` · ${tx('pt.sandbox')}` : ''}{!p.usable ? ` · ${tx('pt.processorPaused')}` : !p.terminalApi ? ` · ${tx('pt.noTerminalApi')}` : ''}</option>)}</select>}</label>
        <div className="fk-hint span2">{tx('pt.processorNote')}</div>
      </div> : null}
      {step === 2 ? <div className="fk-grid2">
        <label className="fk-field"><span>{tx('pos.pairing_code_6_digits')} *</span><input value={code} inputMode="numeric" maxLength={6} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" data-autofocus data-testid="pair-code" /></label>
        <label className="fk-field"><span>{tx('pos.hardware_serial_number_hsn')}</span><input value={hsn} maxLength={64} onChange={(e) => setHsn(e.target.value)} data-testid="pair-hsn" /></label>
        <div className="fk-hint span2">{tx('pt.identifyNote')}</div>
      </div> : null}
      {step === 3 ? <>
        <label className="fk-field"><span>{tx('pos.assigned_register')}</span><select value={station} onChange={(e) => setStation(e.target.value)} data-testid="pair-register"><option value="">{tx('pos.no_register_shared')}</option>{registers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        {taken ? <div className="fk-preview bad">{tx('pt.registerTaken', { name: taken.name, label: taken.terminals[0].label })}</div> : null}
        <dl className="fk-dl"><dt>{tx('pos.device_model')}</dt><dd>{lbl('pt.model.' + model, model)}</dd><dt>{tx('pos.terminal_label')}</dt><dd>{label}</dd><dt>{tx('pos.pairing_code')}</dt><dd>{code}</dd><dt>{tx('pt.f.serial')}</dt><dd>{hsn || '—'}</dd></dl>
        <div className="fk-hint">{tx('pt.verifyNote')}</div>
      </> : null}
      {step === 4 ? <div data-testid="pair-verify">
        {!verify ? <div className="fk-loading">{tx('pt.verifying')}</div>
          : <div className={'fk-preview' + (verify.ok ? '' : ' bad')}><b>{tx(verify.ok ? 'pt.verifyOk' : 'pt.verifyFailed')}</b><div>{verify.detail}</div></div>}
        {verify && !verify.ok ? <div className="fk-hint">{tx('pt.unverifiedStaysOut')}</div> : null}
      </div> : null}
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
      {stepUp.prompt}
    </FitDialog>
  );
}

function AddPhoneDialog({ onClose }: { onClose: () => void }) {
  const stepUp = useStepUp(tx('pt.stepupDevice'));
  const [label, setLabel] = useState(''); const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [pairing, setPairing] = useState<TapToPayPairing | null>(null);
  const key = useMemo(() => requestId(), []);
  const create = async () => { setBusy(true); setErr(null); try { setPairing(await stepUp.run(() => posMobilePaymentsApi.createPairing({ label: label.trim() || undefined, shared }))); } catch (e) { if (!isStepUpCancelled(e)) setErr(errMsg(e)); } finally { setBusy(false); } };
  return (
    <FitDialog title={tx('pt.addPhone')} subtitle={tx('pt.addPhoneSub')} onClose={onClose} busy={busy} testId="add-phone-dialog"
      footer={<>{!pairing ? <><button type="button" className="fk-btn" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button>
        <button type="button" className="fk-btn primary" onClick={create} disabled={busy} data-testid="create-pairing" data-key={key}>{tx('pt.createPairing')}</button></> : null}</>}>
      {pairing ? <PairingQr pairing={pairing} onDone={onClose} /> : <>
        <label className="fk-field"><span>{tx('pt.phoneName')}</span><input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} data-autofocus /></label>
        <label className="fk-check"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />{tx('pt.sharedPhone')}</label>
        <div className="fk-hint">{tx('pt.addPhoneNote')}</div>
      </>}
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
      {stepUp.prompt}
    </FitDialog>
  );
}
