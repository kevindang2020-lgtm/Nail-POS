// POSAIOcrReceiptScreen.tsx — the tenant AI Receipt & Document Recognition workspace. Tabs: Overview, Review Required,
// Duplicate Review, Approved, Posted, Rejected, Upload. Cream/gold design, desktop-POS fixed shell (internal table scroll).
// Reads are honest — empty backend reads show empty states, never fabricated data. The Post action is disabled unless the
// document is approved (the server enforces this too); nothing is finalized from unreviewed AI output.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { posAiOcrReceiptApi as apiO } from '../api/posAiOcrReceiptApi';
import { posReceiptCenterApi as rc } from '../api/posReceiptCenterApi';
import { useSearchParams } from 'react-router-dom';
import { errorTextOf } from '../i18n/error-text';
import { fmtInZone } from '../i18n/format';
import { FitDialog, Pager } from '../components/FitKit';
import { RangeCalendar } from '../components/FinanceKit';
import { posExpensesApi } from '../api/posExpensesApi';
import { isOfflineFailure } from '../api/offline-drafts';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { createReceiptCaptureQueue, isOffline, CaptureUnavailableError, type ReceiptCaptureQueue, type CaptureSummary } from '@aipowersalon/mobile-sdk';
import { deviceToday } from '../lib/deviceToday';

const GOLD = 'var(--aps-orange,#A96F22)';
const LINE = 'var(--line,#E7DBC6)';
const MUTED = 'var(--muted,#7A6C57)';

type Tab = 'overview' | 'quarantined' | 'extracting' | 'manual' | 'failed_reading' | 'review' | 'duplicates' | 'approved' | 'posted' | 'rejected' | 'upload';
// each tab is one exact server queue (/pos/receipt-center/documents?group=…); `states` sizes its count chip
const TABS: { key: Tab; label: string; group?: string; states?: string[] }[] = [
  { key: 'overview', get label() { return tx('pos.overview'); } },
  // Quarantine is NOT a dead end, but it was invisible: malwareScanRequired defaults to true and S3-side
  // scanners tag out of band, so a freshly uploaded receipt lands here until the verdict arrives. Without this
  // tab (and the Re-check action below) a tenant would upload a receipt and simply never see it again.
  { key: 'quarantined', get label() { return tx('pos.quarantined'); }, group: 'quarantined', states: ['quarantined'] },
  // Two more states that had no tab and therefore no way out. 'extracting' is where a clean-scanned receipt
  // waits for OCR; 'manual_entry_required' is where it lands when no provider could read it (which is the
  // honest outcome, not a failure) and a person keys the values in.
  { key: 'extracting', get label() { return tx('pos.extracting'); }, group: 'extracting', states: ['uploaded', 'scanning', 'extracting', 'validating'] },
  { key: 'manual', get label() { return tx('pos.manual_entry'); }, group: 'manual_entry', states: ['manual_entry_required'] },
  // §115 (Oct 27 2026): a reading that used its automatic retries waits here for a person (Retry reading / Enter by hand)
  { key: 'failed_reading', get label() { return tx('people.receiptAi.tab.readingFailed'); }, group: 'reading_failed', states: ['extraction_failed'] },
  { key: 'review', get label() { return tx('pos.review_required'); }, group: 'review', states: ['review_required', 'in_review'] },
  { key: 'duplicates', get label() { return tx('pos.duplicate_review'); }, group: 'duplicate_hold', states: ['duplicate_hold'] },
  { key: 'approved', get label() { return tx('pos.approved'); }, group: 'approved', states: ['approved', 'posting', 'failed'] },
  { key: 'posted', get label() { return tx('pos.posted'); }, group: 'posted', states: ['posted'] },
  { key: 'rejected', get label() { return tx('pos.rejected_2'); }, group: 'rejected', states: ['rejected'] },
  { key: 'upload', get label() { return tx('pos.upload'); } },
];

const card: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 14 };
const h2: React.CSSProperties = { font: '600 15px/1.2 "Playfair Display",serif', color: 'var(--text,#2B2118)', margin: 0 };
const money = (c: number | null | undefined) => (c == null ? '—' : `$${(Math.abs(c) / 100).toFixed(2)}`);

function Empty({ msg }: { msg: string }) { return <div style={{ ...card, color: MUTED, textAlign: 'center', padding: 28, fontSize: 13 }}>{msg}</div>; }
function Kpi({ label, value, tone, onClick }: { label: string; value: string | number; tone?: 'danger' | 'default'; onClick?: () => void }) {
  return <div style={{ ...card, cursor: onClick ? 'pointer' : 'default' }} onClick={onClick}><div style={{ fontSize: 11, color: MUTED, marginBottom: 6 }}>{label}</div><div style={{ font: '700 22px/1 "Playfair Display",serif', color: tone === 'danger' ? '#B0413E' : 'var(--text,#2B2118)' }}>{value}</div></div>;
}
function Badge({ text, tone }: { text: string; tone: 'gold' | 'danger' | 'muted' | 'ok' }) {
  const c = tone === 'danger' ? '#B0413E' : tone === 'ok' ? '#3E7A52' : tone === 'gold' ? GOLD : MUTED;
  return <span style={{ fontSize: 11, color: c, border: `1px solid ${c}33`, borderRadius: 20, padding: '2px 8px', whiteSpace: 'nowrap' }}>{text}</span>;
}

export function POSAIOcrReceiptScreen() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>('overview');
  const [sum, setSum] = useState<any>(null);
  const [sumErr, setSumErr] = useState<string | null>(null);
  const [list, setList] = useState<any>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<any | 'loading' | null>(null);
  const [draft, setDraft] = useState('');
  const [f, setF] = useState<{ q?: string; dateField: string; sort: string; preset?: string; from?: string; to?: string; page: number; pageSize: number }>({ dateField: 'uploaded', sort: 'newest', page: 1, pageSize: 25 });
  const [cal, setCal] = useState(false);
  const [tick, setTick] = useState(0);

  // the six cards and every queue's size — one tenant-scoped read; a failure is shown, never "0"
  const loadSum = useCallback(() => { setSumErr(null); rc.summary({}).then(setSum).catch((e) => setSumErr(errorTextOf(e, tx('rrx.loadFailed')))); }, []);
  useEffect(() => { loadSum(); }, [loadSum, tick]);
  // the open tab's queue: its exact states, search, which date, presets / range, sort, numbered pages (newest first)
  const group = TABS.find((x) => x.key === tab)?.group ?? (tab === 'overview' ? 'all' : null);
  const loadList = useCallback(() => {
    if (!group) return;
    setListErr(null);
    rc.documents({ ...f, group, pageSize: tab === 'overview' ? 10 : f.pageSize }).then(setList).catch((e) => setListErr(errorTextOf(e, tx('rrx.loadFailed'))));
  }, [group, f, tab]);
  useEffect(() => { setList(null); loadList(); }, [loadList, tick]);
  const set = (p: Partial<typeof f>, keepPage = false) => setF((x) => ({ ...x, ...p, page: keepPage ? (p.page ?? x.page) : 1 }));

  const openReview = useCallback(async (id: string) => {
    setBusy(true);
    try { const d = await apiO.detail(id); setSelected(d); } catch (e: any) { setErr(errorTextOf(e, tx('pos.failed_to_open'))); } finally { setBusy(false); }
  }, []);
  // a receipt opened from the scanner page (?doc=…) opens here directly
  const deep = params.get('doc');
  useEffect(() => { if (deep) void openReview(deep); }, [deep, openReview]);

  const act = useCallback(async (fn: () => Promise<any>) => {
    setBusy(true); setErr(null);
    try { await fn(); setTick((n) => n + 1); if (selected) { const d = await apiO.detail(selected.id); setSelected(d); } }
    catch (e: any) { setErr(errorTextOf(e, tx('pos.action_failed_2'))); } finally { setBusy(false); }
  }, [selected]);

  const st = (k: string) => Number(sum?.states?.[k] ?? 0);
  const kpi = (v: number) => (sum ? v : '—');
  const rows: any[] = list?.items ?? [];
  const any = !!(f.q || f.preset);

  return (
    <div style={{ height: 'min(100%, calc(100dvh - var(--pos-header-height)))', minHeight: 0, overflow: 'hidden', display: 'grid', gridTemplateRows: 'auto auto minmax(0,1fr)', background: 'var(--page,#F7EFE3)' }} data-testid="receipt-review-screen">
      <div style={{ padding: '14px 18px 6px', display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ font: '700 20px/1.1 "Playfair Display",serif', margin: 0 }}>{tx('pos.ai_receipt_document_recognition')}</h1>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{tx('pos.scanned_documents_are_reviewed_and_approved_1al1')}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setTick((n) => n + 1)} style={btn(GOLD, false)} data-testid="rrx-refresh">{tx('rrx.refresh')}</button>
          <button onClick={() => setTab('upload')} style={btn(GOLD, false)}>{tx('pos.upload')}</button>
          {/* Receipt Recognition SUNMI guide (Nov 9 2026): the header's Manual Entry — opens the documents waiting to be keyed in */}
          <button onClick={() => { setTab('manual'); setSelected(null); setF((x) => ({ ...x, page: 1 })); }} style={btn(GOLD, false)} data-testid="rrx-manual">{tx('pos.manual_entry')}</button>
          <button onClick={() => { setHealth('loading'); rc.check().then(setHealth).catch((e) => setHealth({ error: errorTextOf(e, tx('rrx.loadFailed')) })); }} style={btn(GOLD, true)} data-testid="rrx-check">{tx('rrx.check')}</button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, padding: '4px 18px', flexWrap: 'wrap' }} role="tablist" data-module-id="rrx-tabs">
        {TABS.map((t) => {
          const n = t.states ? t.states.reduce((a, k) => a + st(k), 0) : null;
          return <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => { setTab(t.key); setSelected(null); setF((x) => ({ ...x, page: 1 })); }} style={{ border: `1px solid ${tab === t.key ? GOLD : LINE}`, background: tab === t.key ? GOLD : '#fff', color: tab === t.key ? '#fff' : 'var(--text,#2B2118)', borderRadius: 20, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}>
            {t.label}{n ? ` (${n})` : ''}</button>;
        })}
      </div>

      <div style={{ overflow: 'auto', padding: '8px 18px 18px' }}>
        {err && <div role="alert" style={{ ...card, borderColor: '#B0413E55', color: '#B0413E', marginBottom: 10 }}>{err}</div>}
        {sumErr && <div role="alert" style={{ ...card, borderColor: '#B0413E55', color: '#B0413E', marginBottom: 10 }}>{sumErr} <button onClick={loadSum} style={btn(GOLD, false)}>{tx('rrx.retry')}</button></div>}

        {tab === 'overview' && (
          <div className='grid grid-cols-2  gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6' style={{ marginBottom: 12 }} data-testid="rrx-kpis">
            <Kpi label={tx('pos.review_required_2')} value={kpi(st('review_required') + st('in_review'))} tone={st('review_required') + st('in_review') ? 'danger' : 'default'} onClick={() => setTab('review')} />
            <Kpi label={tx('pos.duplicate_holds')} value={kpi(st('duplicate_hold'))} onClick={() => setTab('duplicates')} />
            <Kpi label={tx('pos.approved')} value={kpi(st('approved') + st('posting'))} onClick={() => setTab('approved')} />
            <Kpi label={tx('pos.posted')} value={kpi(st('posted'))} onClick={() => setTab('posted')} />
            <Kpi label={tx('pos.posting_failures')} value={kpi(st('failed'))} tone={st('failed') ? 'danger' : 'default'} onClick={() => setTab('approved')} />
            <Kpi label={tx('pos.quarantined')} value={kpi(st('quarantined'))} onClick={() => setTab('quarantined')} />
          </div>
        )}

        {tab === 'upload' && <UploadPanel onUploaded={() => { setTick((n) => n + 1); setTab('review'); }} onError={setErr} />}

        {tab !== 'upload' && (
          <div className={'grid gap-[12px] ' + (selected ? tx('pos.grid_cols_1_lg_grid_cols_17ya') : 'grid-cols-1')} style={{ gap: 12 }}>
            <div style={{ ...card, padding: 0, overflow: 'hidden' }} data-module-id="rrx-documents">
              <div style={{ padding: 10, display: 'grid', gap: 8 }} data-testid="rrx-filters">
                {tab === 'overview' ? <div style={{ ...h2 }}>{tx('rrx.recent')}</div> : null}
                <form style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); set({ q: draft.trim() || undefined }); }}>
                  <input data-testid="rrx-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={tx('rcsx.searchPh')} aria-label={tx('rcsx.searchPh')} style={{ flex: '1 1 260px', border: `1px solid ${LINE}`, borderRadius: 8, padding: '6px 10px', fontSize: 13 }} />
                  <button type="submit" style={btn(GOLD, true)}>{tx('rcsx.search')}</button>
                  <select data-testid="rrx-datefield" aria-label={tx('rcsx.dateLabel')} value={f.dateField} onChange={(e) => set({ dateField: e.target.value })}>{['uploaded', 'purchase', 'posted'].map((d) => <option key={d} value={d}>{tx('rcsx.date.' + d)}</option>)}</select>
                  <select data-testid="rrx-sort" aria-label={tx('rcsx.sortLabel')} value={f.sort} onChange={(e) => set({ sort: e.target.value })}>{['newest', 'oldest', 'purchase_date', 'total_high', 'total_low', 'vendor'].map((x) => <option key={x} value={x}>{tx('rcsx.sort.' + x)}</option>)}</select>
                  {any ? <button type="button" style={btn(MUTED, false)} onClick={() => { setDraft(''); set({ q: undefined, preset: undefined, from: undefined, to: undefined }); }}>{tx('rcsx.clear')}</button> : null}
                </form>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  <button style={btn(GOLD, !f.preset)} onClick={() => set({ preset: undefined, from: undefined, to: undefined })}>{tx('rcsx.preset.all')}</button>
                  {(['today', 'yesterday', 'week', 'last_7', 'month', 'last_month', 'last_30', 'year'] as const).map((p) => <button key={p} data-testid={`preset-${p}`} style={btn(GOLD, f.preset === p)} onClick={() => set({ preset: p, from: undefined, to: undefined })}>{tx('rcsx.preset.' + p)}</button>)}
                  <button data-testid="preset-custom" style={btn(GOLD, f.preset === 'custom')} onClick={() => setCal(true)}>{f.preset === 'custom' ? `${f.from} → ${f.to}` : tx('rcsx.preset.custom')}</button>
                </div>
                {cal ? <RangeCalendar initial={{ from: f.from, to: f.to }} today={list?.period?.today ?? deviceToday()}
                  onApply={(r) => { set({ preset: 'custom', from: r.from, to: r.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { set({ preset: undefined, from: undefined, to: undefined }); setCal(false); }} /> : null}
              </div>
              {listErr ? <div role="alert" style={{ padding: 16, color: '#B0413E' }}>{listErr} <button onClick={loadList} style={btn(GOLD, false)}>{tx('rrx.retry')}</button></div>
                : !list ? <div style={{ padding: 20, color: MUTED }}>{tx('pos.loading')}</div>
                : rows.length === 0 ? <Empty msg={any ? tx('rcsx.noMatch') : tab === 'overview' ? tx('pos.no_documents_yet_upload_a_receipt_1y7x') : tx('pos.nothing_here_right_now')} />
                  : (
                    <div className="overflow-x-auto w-full"><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }} className="w-full min-w-max">
                      <thead><tr style={{ textAlign: 'left', color: MUTED, fontSize: 11 }}>
                        <th style={{ padding: 10 }}>{tx('pos.vendor')}</th><th>{tx('rcsx.col.uploaded')}</th><th>{tx('pos.total')}</th><th>{tx('rcsx.col.reading')}</th><th>{tx('rcsx.col.expense')}</th><th>{tx('pos.duplicate')}</th><th></th>
                      </tr></thead>
                      <tbody>
                        {rows.map((d) => (
                          <tr key={d.id} data-testid="rrx-row" style={{ borderTop: `1px solid ${LINE}` }}>
                            <td style={{ padding: 10 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Thumb doc={d} />
                                <div>
                                  <div>{d.vendor || <span style={{ color: MUTED }}>—</span>}{d.number ? <span style={{ color: MUTED }}> · #{d.number}</span> : null}</div>
                                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                    {Number(d.pages) > 1 ? <Badge text={tx('people.receiptAi.pages', { n: String(d.pages) })} tone="muted" /> : null}
                                    {Array.isArray(d.qualityFlags) && d.qualityFlags.length ? <Badge text={tx('people.receiptAi.quality.hardToRead')} tone="gold" /> : null}
                                    {d.suggestedMatch === 'matched' || d.suggestedMatch === 'possible_match' ? <Badge text={tx('people.receiptAi.suggest.badge')} tone="ok" /> : null}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td style={{ whiteSpace: 'nowrap' }}>{d.uploadedAt ? fmtInZone(d.uploadedAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}</td>
                            <td>{money(d.totalCents)}</td>
                            <td><Badge text={tx('rcsx.trk.reading.' + d.tracks.reading)} tone={d.tracks.reading === 'failed' || d.tracks.reading === 'quarantined' ? 'danger' : d.tracks.reading === 'read' ? 'ok' : 'muted'} /></td>
                            <td><Badge text={tx('rcsx.trk.expense.' + d.tracks.expense)} tone={d.tracks.expense === 'posting_failed' ? 'danger' : d.tracks.expense === 'expense_approved' ? 'ok' : 'muted'} /></td>
                            <td>{d.tracks.duplicate !== 'none' ? <Badge text={tx('rcsx.trk.duplicate.' + d.tracks.duplicate)} tone="danger" /> : <span style={{ color: MUTED }}>—</span>}</td>
                            <td style={{ textAlign: 'right', paddingRight: 10 }}><button onClick={() => openReview(d.id)} style={{ border: `1px solid ${GOLD}`, background: '#fff', color: GOLD, borderRadius: 8, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>{tx('pos.review')}</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table></div>
                  )}
              {tab !== 'overview' ? <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 10, gap: 8, flexWrap: 'wrap' }}>
                <Pager info={list ? { page: list.page, pageSize: list.pageSize, totalItems: list.total, totalPages: list.totalPages } : null} onPage={(p) => set({ page: p }, true)} />
                <label style={{ fontSize: 12, color: MUTED }}>{tx('rcsx.rows')} <select value={String(f.pageSize)} onChange={(e) => set({ pageSize: Number(e.target.value) })}>{['10', '25', '50', '100'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
              </div> : null}
            </div>
            {selected && <ReviewPanel doc={selected} busy={busy} onClose={() => setSelected(null)} act={act} />}
          </div>
        )}
      </div>
      {health ? <FitDialog wide testId="rrx-health" title={tx('rrx.check')} subtitle={health !== 'loading' && !health.error ? tx('rcsx.health.overall', { s: tx('rcsx.health.' + health.overall), at: fmtInZone(health.checkedAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }) : undefined}
        onClose={() => setHealth(null)} footer={<button style={btn(MUTED, false)} onClick={() => setHealth(null)}>{tx('rcsx.close')}</button>}>
        {health === 'loading' ? <div>{tx('rcsx.health.running')}</div> : health.error ? <div role="alert">{health.error}</div> : <>
          <p style={{ fontSize: 12, color: MUTED }}>{tx('rcsx.health.readOnly')}{health.reused ? ` ${tx('rcsx.health.recent')}` : ''}</p>
          {health.checks.map((x: any) => <div key={x.key} data-testid={`chk-${x.key}`} style={{ borderTop: `1px solid ${LINE}`, padding: '6px 0' }}>
            <div><Badge text={tx('rcsx.health.' + x.state)} tone={x.state === 'FAILED' || x.state === 'UNAVAILABLE' ? 'danger' : x.state === 'WARNING' ? 'gold' : x.state === 'PASSED' ? 'ok' : 'muted'} /> <b>{tx('rcsx.health.k.' + x.key)}</b>{x.count ? ` · ${x.count}` : ''}</div>
            <div style={{ fontSize: 12, color: MUTED }}>{tx('rcsx.health.d.' + x.key + '.' + x.state)}</div></div>)}
        </>}
      </FitDialog> : null}
    </div>
  );
}

// ── split-screen review panel (left: document, right: fields + actions) ───────
function ReviewPanel({ doc, busy, onClose, act }: { doc: any; busy: boolean; onClose: () => void; act: (fn: () => Promise<any>) => Promise<void> }) {
  const [preview, setPreview] = useState<string | null>(null);
  // Return / Reject ask for the reason (it is kept in the audit trail) — they used to send a fixed English word
  const [deciding, setDeciding] = useState<null | 'reject' | 'return'>(null);
  const [reason, setReason] = useState('');
  useEffect(() => { let live = true; (async () => { try { if (doc.storageKey) { const r = await apiO.previewUrl(doc.id, doc.storageKey); const u = r?.url ?? null;
    // The blob store is NotConnected: DbFileStore records file METADATA only, and signedPreview returns a
    // `notconnected:<key>` marker rather than fabricating a signed URL. Feeding that to an <img src> would paint a
    // broken-image icon, which reads as "this document is corrupt" — worse than saying nothing. So a marker is
    // treated as "no preview available", and the honest label below is shown instead.
    if (live) setPreview(u && !u.startsWith('notconnected:') ? u : null); } } catch { /* preview optional */ } })(); return () => { live = false; }; }, [doc.id, doc.storageKey]);
  const approved = doc.pipelineState === 'approved';
  const inReview = doc.pipelineState === 'in_review';
  const quarantined = doc.pipelineState === 'quarantined' || doc.pipelineState === 'scanning';
  const postingFailed = doc.pipelineState === 'failed';   // M3: the finance write refused — retry (idempotent)
  const extractable = doc.pipelineState === 'extracting';
  // 'manual_entry_required' belongs here: the state machine allows manual_entry_required --start_review--> in_review,
  // and it is exactly where a document lands when no OCR provider could read it. Omitting it left those documents
  // with no button at all — a person could see the receipt but never review or post it.
  // §115: a reading that gave up is entered by hand the same way (start review) — the receipt is saved either way
  const reviewable = doc.pipelineState === 'review_required' || doc.pipelineState === 'duplicate_hold' || doc.pipelineState === 'manual_entry_required' || doc.pipelineState === 'extraction_failed';
  return (
    <div style={{ ...card, display: 'grid', gridTemplateRows: 'auto 1fr auto', gap: 10, minHeight: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={h2}>{doc.vendor || tx('pos.document_3')} · {money(doc.totalCents)}</h2>
        <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: MUTED, cursor: 'pointer', fontSize: 18 }}>×</button>
      </div>
      <div style={{  gap: 10, minHeight: 0, overflow: 'auto' }} className="grid grid-cols-1 sm:grid-cols-2">
        <div style={{ border: `1px solid ${LINE}`, borderRadius: 8, background: '#faf6ee', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 220 }}>
          {preview ? <img src={preview} alt={tx('pos.document')} style={{ maxWidth: '100%', maxHeight: 360, objectFit: 'contain' }} /> : <span style={{ color: MUTED, fontSize: 12 }}>{tx('pos.image_preview_not_connected_review_the_140m')}</span>}
        </div>
        <div style={{ display: 'grid', gap: 6, alignContent: 'start', fontSize: 13 }}>
          <Field label={tx('pos.type')} value={doc.documentType} />
          <Field label={tx('pos.vendor')} value={doc.vendor} />
          <Field label={tx('pos.document_2')} value={doc.documentNumber} />
          <Field label={tx('pos.date')} value={doc.documentDate} />
          <Field label={tx('pos.total')} value={money(doc.totalCents)} />
          <Field label={tx('pos.category')} value={doc.category} />
          {Number(doc.pageCount) > 1 ? <Field label={tx('people.receiptAi.pagesLabel')} value={String(doc.pageCount)} /> : null}
          {Array.isArray(doc.qualityFlags) && doc.qualityFlags.length ? <div style={{ fontSize: 12, color: GOLD }}>{tx('people.receiptAi.quality.flagged', { flags: doc.qualityFlags.map((f: string) => qualityLabel(f)).join(', ') })}</div> : null}
          <div style={{ marginTop: 4 }}>
            {doc.duplicateStatus && doc.duplicateStatus !== 'none' && <Badge text={tx('pos.possible_duplicate_duplicatestatus', { duplicateStatus: String(doc.duplicateStatus) })} tone="danger" />}
          </div>
          {/* §38 (Oct 27 2026): each read field with its confidence — a weak one says Verify; a person confirms or edits it inline */}
          {Array.isArray(doc.fields) && doc.fields.length ? <FieldReview doc={doc} busy={busy} act={act} /> : null}
          {Array.isArray(doc.lineItems) && doc.lineItems.length ? <div style={{ fontSize: 12, color: MUTED }}>{tx('people.receiptAi.lines', { n: String(doc.lineItems.length) })}</div> : null}
          <ReceiptEvidence doc={doc} />
          {/* §142: the existing expense this receipt could be the evidence for — a person links it instead of posting a second expense */}
          {(doc.suggestedMatch === 'matched' || doc.suggestedMatch === 'possible_match') && doc.suggestedExpenseId ? (
            <div style={{ border: `1px solid ${GOLD}55`, background: '#fff8ea', borderRadius: 8, padding: 8, fontSize: 12 }}>
              <div>{doc.suggestedMatch === 'matched' ? tx('people.receiptAi.suggest.matched') : tx('people.receiptAi.suggest.possible')}</div>
              <button disabled={busy} onClick={() => act(() => posExpensesApi.attachReceipt(doc.suggestedExpenseId, doc.id))} style={{ ...btn(GOLD, true), marginTop: 6 }}>{tx('people.receiptAi.suggest.link')}</button>
            </div>
          ) : null}
          {doc.pipelineState === 'extraction_failed' ? <div style={{ fontSize: 12, color: '#B0413E' }}>{doc.nextExtractionAt ? tx('people.receiptAi.readingRetrying') : tx('people.receiptAi.readingGaveUp')}</div> : null}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {/* Re-asks the scanner and applies only what it says: clean releases the file into extraction, infected
            rejects it, anything else leaves it exactly where it is. The button cannot release an unscanned file. */}
        {quarantined && <button disabled={busy} title={tx('pos.ask_the_malware_scanner_again_the_v666')} onClick={() => act(() => apiO.rescan(doc.id))} style={btn(GOLD, true)}>{tx('pos.re_check_scan')}</button>}
        {/* If no OCR provider is bound, this honestly returns unavailable and the document moves to Manual Entry —
            it does not invent a vendor or a total. */}
        {extractable && <button disabled={busy} onClick={() => act(() => apiO.extract(doc.id))} style={btn(GOLD, true)}>{tx('pos.run_extraction')}</button>}
        {doc.pipelineState === 'extraction_failed' && <button disabled={busy} onClick={() => act(() => apiO.retryExtract(doc.id))} style={btn(GOLD, true)}>{tx('people.receiptAi.retryReading')}</button>}
        {reviewable && <button disabled={busy} onClick={() => act(() => apiO.startReview(doc.id))} style={btn(GOLD, true)}>{tx('pos.start_review')}</button>}
        {inReview && <button disabled={busy} onClick={() => act(() => apiO.approve(doc.id))} style={btn('#3E7A52', true)}>{tx('pos.approve')}</button>}
        {inReview && !deciding && <button disabled={busy} onClick={() => setDeciding('return')} style={btn(GOLD, false)}>{tx('pos.return')}</button>}
        {inReview && !deciding && <button disabled={busy} onClick={() => setDeciding('reject')} style={btn('#B0413E', false)}>{tx('pos.reject')}</button>}
        {inReview && deciding ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', width: '100%' }} data-testid="rrx-reason-box">
          <input data-testid="rrx-reason" aria-label={tx('rrx.reason.' + deciding)} placeholder={tx('rrx.reason.' + deciding)} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} style={{ flex: '1 1 220px', border: `1px solid ${LINE}`, borderRadius: 6, padding: '4px 8px', fontSize: 12 }} />
          <button disabled={busy} onClick={() => { setDeciding(null); setReason(''); }} style={btn(MUTED, false)}>{tx('people.receiptAi.fields.cancel')}</button>
          <button data-testid="rrx-reason-go" disabled={busy || !reason.trim()} onClick={() => { const r = reason.trim(); const k = deciding; setDeciding(null); setReason(''); void act(() => (k === 'reject' ? apiO.reject(doc.id, r) : apiO.returnForCorrection(doc.id, r))); }} style={btn(deciding === 'reject' ? '#B0413E' : GOLD, true)}>{deciding === 'reject' ? tx('pos.reject') : tx('pos.return')}</button>
        </div> : null}
        <button disabled={busy || !approved} title={approved ? '' : tx('pos.approve_the_document_before_posting')} onClick={() => act(() => apiO.post(doc.id, 'expense'))} style={btn(GOLD, approved)}>{tx('pos.post_to_expenses')}</button>
        {postingFailed && <button disabled={busy} title={tx('pos.retry_posting_hint')} onClick={() => act(() => apiO.retryPost(doc.id, 'expense'))} style={btn(GOLD, true)}>{tx('pos.retry_posting')}</button>}
      </div>
    </div>
  );
}
const QUALITY_KEYS: Record<string, string> = { low_resolution: 'people.receiptAi.quality.lowResolution', too_dark: 'people.receiptAi.quality.tooDark', washed_out: 'people.receiptAi.quality.washedOut', low_contrast: 'people.receiptAi.quality.lowContrast', likely_blurry: 'people.receiptAi.quality.blurry', tiny_file: 'people.receiptAi.quality.tinyFile', multiple_receipts: 'people.receiptAi.quality.multipleReceipts' };
const qualityLabel = (f: string) => (QUALITY_KEYS[f] ? tx(QUALITY_KEYS[f]) : f);
const FIELD_LABEL: Record<string, () => string> = { vendor: () => tx('pos.vendor'), total: () => tx('pos.total'), subtotal: () => tx('people.receiptAi.field.subtotal'), tax: () => tx('people.receiptAi.field.tax'), document_date: () => tx('pos.date'), document_number: () => tx('pos.document_2'), discount: () => tx('people.receiptAi.field.discount'), fees: () => tx('people.receiptAi.field.fees') };
const MONEY_FIELDS = new Set(['total', 'subtotal', 'tax', 'discount', 'fees']);

/**
 * extras OCR Receipt Scanner #02 / Receipt Document Recognition #05 — the review workspace's evidence beside the original:
 * every line the reader found (description, qty, unit, line total), the money parts as they stand now,
 * and the SERVER's arithmetic checks (the same reconcileDocument rule + tolerance the extraction used; nothing is
 * re-computed here). Read-only: approving stays the separate, explicit action below.
 */
type OcrLineView = { lineNumber: number; description: string | null; quantity: number | null; unitPriceCents: number | null; lineTotalCents: number | null };
type OcrCheckView = { name: string; passed: boolean; expectedCents?: number; actualCents?: number; deltaCents?: number };
type OcrAmountsView = { subtotalCents: number | null; taxCents: number | null; feesCents: number | null; discountCents: number | null; totalCents: number | null };
function ReceiptEvidence({ doc }: { doc: { lineItems?: OcrLineView[]; amounts?: OcrAmountsView | null; arithmetic?: OcrCheckView[] } }) {
  const lines = Array.isArray(doc.lineItems) ? doc.lineItems : [];
  const checks = Array.isArray(doc.arithmetic) ? doc.arithmetic : [];
  const a = doc.amounts ?? null;
  if (!lines.length && !a && !checks.length) return null;
  const cell: CSSProperties = { padding: '3px 6px', borderBottom: `1px solid ${LINE}`, textAlign: 'right', whiteSpace: 'nowrap' };
  const signed = (c: number | undefined) => (c == null ? '—' : (c < 0 ? '−' : '+') + money(c));
  return (
    <div data-testid="rrx-evidence" style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: 8, fontSize: 12, display: 'grid', gap: 6 }}>
      {lines.length ? (
        <table style={{ width: '100%', borderCollapse: 'collapse' }} data-testid="rrx-lines">
          <thead><tr style={{ color: MUTED }}><th style={{ ...cell, textAlign: 'left' }}>{tx('people.receiptAi.ev.item')}</th><th style={cell}>{tx('people.receiptAi.ev.qty')}</th><th style={cell}>{tx('people.receiptAi.ev.unit')}</th><th style={cell}>{tx('people.receiptAi.ev.lineTotal')}</th></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.lineNumber} data-testid="rrx-line">
              <td style={{ ...cell, textAlign: 'left', whiteSpace: 'normal' }}>{l.description || '—'}</td>
              <td style={cell}>{l.quantity ?? '—'}</td><td style={cell}>{money(l.unitPriceCents)}</td><td style={cell}>{money(l.lineTotalCents)}</td>
            </tr>))}</tbody>
        </table>
      ) : null}
      {a ? (
        <div data-testid="rrx-amounts" style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', color: MUTED }}>
          <span>{tx('people.receiptAi.ev.subtotal')} <b style={{ color: 'inherit' }}>{money(a.subtotalCents)}</b></span>
          <span>{tx('people.receiptAi.ev.tax')} <b>{money(a.taxCents)}</b></span>
          <span>{tx('people.receiptAi.ev.fees')} <b>{money(a.feesCents)}</b></span>
          <span>{tx('people.receiptAi.ev.discount')} <b>{money(a.discountCents)}</b></span>
          <span>{tx('people.receiptAi.ev.total')} <b>{money(a.totalCents)}</b></span>
        </div>
      ) : null}
      {checks.length ? checks.map((c) => (
        <div key={c.name} data-testid={'rrx-check-' + c.name} data-passed={c.passed ? 'yes' : 'no'} style={{ color: c.passed ? '#1F7A3F' : '#B0413E' }}>
          {c.passed ? '✓ ' : '⚠ '}{tx('people.receiptAi.ev.check.' + c.name)}
          {!c.passed ? <span> — {tx('people.receiptAi.ev.mismatch', { expected: money(c.expectedCents), actual: money(c.actualCents), delta: signed(c.deltaCents) })}</span> : null}
        </div>
      )) : a ? <div style={{ color: MUTED }} data-testid="rrx-check-none">{tx('people.receiptAi.ev.noCheck')}</div> : null}
    </div>
  );
}

/** §159: the document's thumbnail in the list — only when one was made (a bucket); never the original */
function Thumb({ doc }: { doc: any }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let live = true; if (!doc.thumbnailKey) { setUrl(null); return; } apiO.previewUrl(doc.id, doc.thumbnailKey).then((r) => { if (live) setUrl(r?.url && !String(r.url).startsWith('notconnected:') ? r.url : null); }).catch(() => undefined); return () => { live = false; }; }, [doc.id, doc.thumbnailKey]);
  if (!url) return null;
  return <img src={url} alt="" width={36} height={48} style={{ objectFit: 'cover', borderRadius: 4, border: `1px solid ${LINE}` }} />;
}

const fieldNeedsCheck = (f: any): boolean => (f?.state === 'low' || f?.state === 'medium' || f?.state === 'missing');
/** stable: needs-check fields by ascending confidence, then the rest in the order the server gave */
function orderFieldsForReview<F extends { state?: string; confidence?: number | null }>(fields: readonly F[]): F[] {
  const idx = fields.map((f, i) => ({ f, i }));
  return idx.sort((a, b) => {
    const wa = fieldNeedsCheck(a.f) ? 0 : 1, wb = fieldNeedsCheck(b.f) ? 0 : 1;
    if (wa !== wb) return wa - wb;
    if (wa === 0) { const d = (a.f.confidence ?? 0) - (b.f.confidence ?? 0); if (d !== 0) return d; }
    return a.i - b.i;
  }).map((x) => x.f);
}
/** §36–§38: the read fields, the weak ones marked Verify; confirm keeps the value (manually_confirmed), an edit stores a correction */
function FieldReview({ doc, busy, act }: { doc: any; busy: boolean; act: (fn: () => Promise<any>) => Promise<void> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const canEdit = ['review_required', 'in_review', 'duplicate_hold', 'manual_entry_required', 'extraction_failed'].includes(doc.pipelineState);
  const save = (key: string) => {
    const v = draft.trim();
    const cents = MONEY_FIELDS.has(key) ? Math.round(Number(v.replace(/[$,\s]/g, '')) * 100) : null;
    if (MONEY_FIELDS.has(key) && !Number.isFinite(cents as number)) return;
    setEditing(null);
    return act(() => apiO.correctField(doc.id, key, MONEY_FIELDS.has(key) ? { value: v, valueCents: cents } : { value: v }));
  };
  // Extras (Receipt OCR row 03) confidence-first: the fields a person still has to check come first, weakest first; confident and
  // already-confirmed values stay listed below (never hidden, never retyped). Display order only — nothing is changed or saved.
  const ordered = orderFieldsForReview(doc.fields);
  const needCheck = ordered.filter(fieldNeedsCheck).length;
  return (
    <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 6, display: 'grid', gap: 4 }}>
      <div style={{ fontSize: 11, color: MUTED }}>{tx('people.receiptAi.fields.heading')}</div>
      {needCheck > 0 ? <div style={{ fontSize: 11, color: '#A33A3A' }}>{tx('people.receiptAi.fields.needCheck', { n: String(needCheck) })}</div> : null}
      {ordered.map((f: any) => {
        const weak = f.state === 'low' || f.state === 'medium' || f.state === 'missing';
        const done = f.state === 'manually_confirmed' || f.state === 'manually_corrected';
        const shown = f.correctedValue ?? f.text ?? '—';
        return (
          <div key={f.key} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <span style={{ color: MUTED, minWidth: 70 }}>{FIELD_LABEL[f.key] ? FIELD_LABEL[f.key]() : f.key}</span>
            {editing === f.key ? (
              <>
                <input aria-label={tx('people.receiptAi.fields.editAria', { field: FIELD_LABEL[f.key] ? FIELD_LABEL[f.key]() : f.key })} value={draft} onChange={(e) => setDraft(e.target.value)} style={{ border: `1px solid ${LINE}`, borderRadius: 6, padding: '2px 6px', fontSize: 12, minWidth: 110 }} />
                <button disabled={busy} onClick={() => void save(f.key)} style={btn(GOLD, true)}>{tx('people.receiptAi.fields.save')}</button>
                <button disabled={busy} onClick={() => setEditing(null)} style={btn(MUTED, false)}>{tx('people.receiptAi.fields.cancel')}</button>
              </>
            ) : (
              <>
                <span>{shown}</span>
                {weak && !done ? <Badge text={tx('people.receiptAi.fields.verify', { pct: String(Math.round((f.confidence ?? 0) * 100)) })} tone="danger" /> : null}
                {done ? <Badge text={f.state === 'manually_corrected' ? tx('people.receiptAi.fields.corrected') : tx('people.receiptAi.fields.confirmed')} tone="ok" /> : null}
                {canEdit && !done ? <button disabled={busy} onClick={() => act(() => apiO.correctField(doc.id, f.key, { confirmOnly: true }))} style={btn('#3E7A52', false)}>{tx('people.receiptAi.fields.confirm')}</button> : null}
                {canEdit ? <button disabled={busy} onClick={() => { setEditing(f.key); setDraft(String(f.correctedValue ?? f.text ?? '')); }} style={btn(GOLD, false)}>{tx('people.receiptAi.fields.edit')}</button> : null}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, borderBottom: `1px solid ${LINE}`, padding: '4px 0' }}><span style={{ color: MUTED }}>{label}</span><span>{value ?? '—'}</span></div>;
}
function btn(color: string, filled: boolean): React.CSSProperties {
  return { border: `1px solid ${color}`, background: filled ? color : '#fff', color: filled ? '#fff' : color, borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', opacity: 1 };
}

// ── upload panel ──────────────────────────────────────────────────────────────
// Oct 27 2026 — §18 several photos may be ONE receipt (combine → page 2, 3 … under one document) or several receipts;
// §26 a receipt the server found hard to read is announced with Retake / Process anyway (never a failure); §111 progress
// per page; §155–§157 offline, the photo is held encrypted on this device and uploaded when the connection returns.
const toPayload = async (file: File) => { const buf = new Uint8Array(await file.arrayBuffer()); return { filename: file.name, mimeType: file.type, sizeBytes: file.size, bytes: Array.from(buf), headerBytes: Array.from(buf.slice(0, 16)) }; };
let sharedQueue: ReceiptCaptureQueue | null = null;
const captureQueue = () => (sharedQueue ??= createReceiptCaptureQueue());

function UploadPanel({ onUploaded, onError }: { onUploaded: () => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [quality, setQuality] = useState<{ documentId: string; flags: string[]; deferred: boolean } | null>(null);
  const [queued, setQueued] = useState<CaptureSummary[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const refreshQueue = useCallback(() => captureQueue().pending().then(setQueued).catch(() => setQueued([])), []);
  const uploader = useCallback((f: { filename: string; mimeType: string; sizeBytes: number; bytes: Uint8Array; source: string }) =>
    apiO.upload({ filename: f.filename, mimeType: f.mimeType, sizeBytes: f.sizeBytes, bytes: Array.from(f.bytes), headerBytes: Array.from(f.bytes.slice(0, 16)), source: 'pos_upload' }).then((r) => ({ documentId: r.documentId })), []);
  useEffect(() => { void refreshQueue(); return captureQueue().bindReconnect(uploader, () => { void refreshQueue(); onUploaded(); }); }, [refreshQueue, uploader, onUploaded]);

  const holdOffline = useCallback(async (files: File[]) => {
    try {
      for (const f of files) await captureQueue().enqueue({ filename: f.name, mimeType: f.type, bytes: new Uint8Array(await f.arrayBuffer()), source: 'pos_upload' });
      await refreshQueue();
      onError(tx('people.receiptAi.offline.held', { n: String(files.length) }));
    } catch (e: any) { onError(e instanceof CaptureUnavailableError ? e.message : tx('pos.upload_failed')); }
  }, [onError, refreshQueue]);
  const syncNow = async () => {
    setBusy(true);
    try { const r = await captureQueue().sync(uploader); await refreshQueue(); if (r.uploaded.length) onUploaded(); if (r.failed.length) onError(tx('people.receiptAi.offline.stillWaiting', { n: String(r.failed.length) })); }
    finally { setBusy(false); }
  };

  const run = useCallback(async (files: File[], combine: boolean) => {
    setPendingFiles(null); setQuality(null);
    if (!files.length) return;
    if (isOffline()) { await holdOffline(files); return; }
    setBusy(true); onError('');
    try {
      if (combine) {
        setProgress(tx('people.receiptAi.progress.page', { page: '1', of: String(files.length) }));
        const first = await apiO.upload({ ...(await toPayload(files[0])), source: 'pos_upload', deferExtraction: true });
        const flags = new Set<string>(first.quality?.flags ?? []);
        for (let i = 1; i < files.length; i++) {
          setProgress(tx('people.receiptAi.progress.page', { page: String(i + 1), of: String(files.length) }));
          const p = await apiO.addPage(first.documentId, await toPayload(files[i]));
          for (const f of p.quality?.flags ?? []) flags.add(f);
        }
        if (flags.size) { setQuality({ documentId: first.documentId, flags: [...flags], deferred: true }); return; }   // §26: the person decides before it is read
        setProgress(tx('people.receiptAi.progress.reading'));
        await apiO.extract(first.documentId).catch(() => undefined);   // a provider that is away leaves it for the sweep / manual entry — honest, not an error here
        onUploaded();
        return;
      }
      let difficult: { documentId: string; flags: string[] } | null = null;
      for (let i = 0; i < files.length; i++) {
        setProgress(files.length > 1 ? tx('people.receiptAi.progress.receipt', { n: String(i + 1), of: String(files.length) }) : tx('pos.uploading'));
        const r = await apiO.upload({ ...(await toPayload(files[i])), source: 'pos_upload' });
        if (r.quality?.difficult) { const prior: string[] = difficult ? difficult.flags : []; difficult = { documentId: r.documentId, flags: [...new Set([...prior, ...r.quality.flags])] }; }
      }
      // §26: the receipt is accepted and being read either way; the guidance stays on screen until the person decides
      if (difficult) { setQuality({ ...difficult, deferred: false }); return; }
      onUploaded();
    } catch (e: any) {
      if (isOfflineFailure(e)) { await holdOffline(files); return; }
      onError(e?.message || tx('pos.upload_failed'));
    } finally { setBusy(false); setProgress(null); }
  }, [onUploaded, onError, holdOffline]);

  const onPick = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (inputRef.current) inputRef.current.value = '';
    if (files.length > 1) setPendingFiles(files); else void run(files, false);
  };
  const processAnyway = async () => {
    if (!quality) return;
    const q = quality; setQuality(null);
    if (q.deferred) { setBusy(true); try { await apiO.extract(q.documentId).catch(() => undefined); } finally { setBusy(false); } }
    onUploaded();
  };
  return (
    <div style={{ ...card, textAlign: 'center', padding: 36 }}>
      <div style={{ font: '600 15px/1.2 "Playfair Display",serif', marginBottom: 8 }}>{tx('pos.upload_a_receipt_or_document')}</div>
      <div style={{ fontSize: 12, color: MUTED, marginBottom: 14 }}>{tx('pos.jpeg_png_heic_webp_tiff_or_12b3')} · {tx('people.receiptAi.upload.multiHint')}</div>
      {pendingFiles ? (
        <div role="group" aria-label={tx('people.receiptAi.combine.question', { n: String(pendingFiles.length) })} style={{ display: 'grid', gap: 8, justifyItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 13 }}>{tx('people.receiptAi.combine.question', { n: String(pendingFiles.length) })}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button disabled={busy} onClick={() => void run(pendingFiles, true)} style={btn(GOLD, true)}>{tx('people.receiptAi.combine.one', { n: String(pendingFiles.length) })}</button>
            <button disabled={busy} onClick={() => void run(pendingFiles, false)} style={btn(GOLD, false)}>{tx('people.receiptAi.combine.separate', { n: String(pendingFiles.length) })}</button>
            <button disabled={busy} onClick={() => setPendingFiles(null)} style={btn(MUTED, false)}>{tx('people.receiptAi.fields.cancel')}</button>
          </div>
        </div>
      ) : null}
      {quality ? (
        <div role="status" style={{ border: `1px solid ${GOLD}66`, background: '#fff8ea', borderRadius: 10, padding: 12, marginBottom: 14, fontSize: 13 }}>
          <div style={{ fontWeight: 600 }}>{tx('people.receiptAi.quality.difficult')}</div>
          <div style={{ color: MUTED, fontSize: 12, marginTop: 2 }}>{quality.flags.map(qualityLabel).join(' · ')}</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 8, flexWrap: 'wrap' }}>
            <button disabled={busy} onClick={() => { setQuality(null); inputRef.current?.click(); }} style={btn(GOLD, true)}>{tx('people.receiptAi.quality.retake')}</button>
            <button disabled={busy} onClick={() => void processAnyway()} style={btn(GOLD, false)}>{tx('people.receiptAi.quality.processAnyway')}</button>
          </div>
        </div>
      ) : null}
      {queued.length ? (
        <div role="status" style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: 10, marginBottom: 14, fontSize: 12, color: MUTED }}>
          {tx('people.receiptAi.offline.waiting', { n: String(queued.length) })}
          <button disabled={busy || isOffline()} onClick={() => void syncNow()} style={{ ...btn(GOLD, false), marginLeft: 8 }}>{tx('people.receiptAi.offline.syncNow')}</button>
        </div>
      ) : null}
      <label style={{ display: 'inline-block', border: `1px solid ${GOLD}`, background: GOLD, color: '#fff', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: busy ? 'wait' : 'pointer' }}>
        {busy ? (progress ?? tx('pos.uploading')) : tx('pos.choose_file')}
        <input ref={inputRef} type="file" multiple accept="image/*,application/pdf" style={{ display: 'none' }} disabled={busy} aria-label={tx('pos.choose_file')} onChange={(e) => onPick(e.target.files)} />
      </label>
    </div>
  );
}
