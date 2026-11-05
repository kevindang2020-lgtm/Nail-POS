// POSAIFollowUpsScreen.tsx — the AI Receptionist Follow-Ups queue (spec: Follow-Ups). Real CRUD against
// /tenant/ai/receptionist/follow-ups. Follow-ups come from the AI (a handoff that fell back to a callback) or are
// created manually. Staff can assign, note, and resolve. Champagne Gold via existing tokens; honest empty states.
import { useEffect, useMemo, useState } from 'react';
import { useEventCallback } from '@aipowersalon/ui';
import { useNavigate } from 'react-router-dom';
import { posAiApi, type ReceptionistFollowUp } from '../api/posAiApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';

import { statusLabel } from '../i18n/status-label';
import { growthCode } from './growthLabels';
const cardBox: React.CSSProperties = { background: '#FFFCF6', border: '1px solid var(--line)', borderRadius: 14, padding: 14 };
const headStyle: React.CSSProperties = { fontWeight: 800, fontSize: 13.5, marginBottom: 10, fontFamily: 'var(--aps-font-head, Playfair Display)' };
const GOLD = '#A96F22';
const inputStyle: React.CSSProperties = { height: 34, padding: '0 10px', borderRadius: 8, border: '1px solid var(--line)', background: '#fff', fontSize: 13, fontFamily: 'inherit' };
const btnGold: React.CSSProperties = { height: 34, padding: '0 14px', borderRadius: 8, border: 'none', background: GOLD, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#6C6965', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit' };
const FILTERS = ['open', 'assigned', 'in_progress', 'waiting', 'resolved', 'all'] as const;
const REASONS = ['CALLBACK', 'CUSTOMER_REQUESTED_HUMAN', 'COMPLAINT', 'REFUND_REQUEST', 'PAYMENT_QUESTION', 'PRICING_REQUIRES_SALON', 'GROUP_BOOKING', 'OTHER'];
const PRIO_TONE: Record<string, { bg: string; fg: string }> = { urgent: { bg: '#F7DDD3', fg: '#B4451E' }, high: { bg: '#FBEEDD', fg: '#9B6B1E' }, normal: { bg: '#F3ECE1', fg: '#6C6965' }, low: { bg: '#EFEAE1', fg: '#9B8B78' } };
const STATUS_TONE: Record<string, { bg: string; fg: string }> = { open: { bg: '#FBEEDD', fg: '#9B6B1E' }, assigned: { bg: '#F0D4AB', fg: '#7A5518' }, in_progress: { bg: '#E7EEF5', fg: '#3B6B95' }, waiting: { bg: '#F3ECE1', fg: '#6C6965' }, resolved: { bg: '#EAF5EE', fg: '#3E8F57' }, closed: { bg: '#EFEAE1', fg: '#9B8B78' } };
const pretty = (s: string) => growthCode(s, 'followUp').toLowerCase();
const NEXT: Record<string, { label: string; to: string }[]> = {
  open: [{ get label() { return t('pos.start'); }, to: 'in_progress' }, { get label() { return t('pos.resolve'); }, to: 'resolved' }],
  assigned: [{ get label() { return t('pos.start'); }, to: 'in_progress' }, { get label() { return t('pos.resolve'); }, to: 'resolved' }],
  in_progress: [{ get label() { return t('pos.waiting_2'); }, to: 'waiting' }, { get label() { return t('pos.resolve'); }, to: 'resolved' }],
  waiting: [{ get label() { return t('pos.resume'); }, to: 'in_progress' }, { get label() { return t('pos.resolve'); }, to: 'resolved' }],
  resolved: [{ get label() { return t('pos.close'); }, to: 'closed' }, { get label() { return t('pos.reopen_2'); }, to: 'open' }],
  closed: [],
};

export function POSAIFollowUpsScreen() {
  const nav = useNavigate();
  const [rows, setRows] = useState<ReceptionistFollowUp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('open');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ reason: 'CALLBACK', priority: 'normal', callerPhone: '', notes: '' });
  const [busy, setBusy] = useState(false);

  const load = useEventCallback(() => posAiApi.receptionistFollowUps(filter === 'all' ? undefined : filter).then(setRows).catch((e: any) => setError(e?.message || t('pos.failed_to_load_follow_ups'))));
  useEffect(() => { setRows(null); load();   }, [filter, load]);

  const grouped = useMemo(() => rows ?? [], [rows]);

  const create = async () => {
    setBusy(true);
    try {
      await posAiApi.createReceptionistFollowUp({ reason: form.reason, priority: form.priority, callerPhone: form.callerPhone.trim() || undefined, notes: form.notes.trim() || undefined });
      setForm({ reason: 'CALLBACK', priority: 'normal', callerPhone: '', notes: '' }); setCreating(false); await load();
    } catch (e: any) { setError(e?.message || t('pos.could_not_create_the_follow_up')); }
    finally { setBusy(false); }
  };
  // Inline note editor (Jul 27, 2026) — replaces BOTH window.prompt calls. One editor per card, in two modes:
  // 'resolve' (optional note, then the status move) and 'note' (append a note). Native dialogs are gone.
  const [editor, setEditor] = useState<{ id: string; mode: 'resolve' | 'note' } | null>(null);
  const [editorText, setEditorText] = useState('');
  const move = async (id: string, to: string) => {
    if (to === 'resolved') { setEditor({ id, mode: 'resolve' }); setEditorText(''); return; }
    try { await posAiApi.setReceptionistFollowUpStatus(id, to); await load(); }
    catch (e: any) { setError(e?.message || t('pos.action_failed')); }
  };
  const confirmEditor = async () => {
    if (!editor) return;
    const text = editorText.trim();
    try {
      if (editor.mode === 'resolve') await posAiApi.setReceptionistFollowUpStatus(editor.id, 'resolved', text || undefined);
      else { if (!text) { setError(t('pos.type_the_note_first')); return; } await posAiApi.noteReceptionistFollowUp(editor.id, text); }
      setEditor(null); setEditorText('');
      await load();
    } catch (e: any) { setError(e?.message || t('pos.action_failed')); }
  };
  const addNote = (id: string) => { setEditor({ id, mode: 'note' }); setEditorText(''); };

  if (error) return <div className="work"><div className="err">{error}</div><button style={{ ...linkBtn, color: GOLD, marginTop: 8 }} onClick={() => { setError(null); load(); }}>{t('pos.retry')}</button></div>;

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="vh flex flex-col sm:flex-row gap-3 justify-between">
        <div>
        <div>
          <h1>{t('pos.follow_ups')}</h1>
        <div className="sub mb-3">{t('pos.calls_that_need_a_human_touch_1ixz')}</div>
        </div>
        </div>
        <button className="btn w-fit whitespace-nowrap" onClick={() => setCreating((v) => !v)}>{creating ? t('pos.close') : t('pos.new_follow_up_2')}</button>
      </div>

      {creating && (
        <section style={cardBox}>
          <div style={headStyle}>{t('pos.new_follow_up')}</div>
          <div style={{  gap: 12 }} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            <label style={{ fontSize: 12 }}>{t('pos.reason_2')}<select style={{ ...inputStyle, width: '100%' }} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>{REASONS.map((r) => <option key={r} value={r}>{pretty(r)}</option>)}</select></label>
            <label style={{ fontSize: 12 }}>{t('pos.priority')}<select style={{ ...inputStyle, width: '100%' }} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option value="low">{t('pos.low')}</option><option value="normal">{t('pos.normal')}</option><option value="high">{t('pos.high')}</option><option value="urgent">{t('pos.urgent')}</option></select></label>
            <label style={{ fontSize: 12 }}>{t('pos.caller_phone')}<input style={{ ...inputStyle, width: '100%' }} value={form.callerPhone} onChange={(e) => setForm({ ...form, callerPhone: e.target.value })} placeholder={t('pos.optional')} /></label>
          </div>
          <label style={{ fontSize: 12, display: 'block', marginTop: 10 }}>{t('pos.notes')}<textarea style={{ ...inputStyle, width: '100%', height: 60, padding: 8 }} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <div style={{ marginTop: 12 }}><button style={btnGold} disabled={busy} onClick={create}>{busy ? t('pos.saving_2') : t('pos.create_follow_up')}</button></div>
        </section>
      )}

      <section style={cardBox}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)} style={{ height: 30, padding: '0 12px', borderRadius: 999, border: '1px solid var(--line)', background: filter === f ? '#F0D4AB' : '#FFFCF6', color: filter === f ? '#7A5518' : '#6C6965', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize' }}>{pretty(f)}</button>
          ))}
        </div>

        {rows === null ? (
          <div style={{ fontSize: 12.5, color: '#9B8B78', padding: '18px 0', textAlign: 'center' }}>{t('pos.loading_u2026')}</div>
        ) : grouped.length === 0 ? (
          <div style={{ fontSize: 12.5, color: '#9B8B78', padding: '18px 0', textAlign: 'center' }}>{t('pos.no_follow_ups_here_u2014_the_zqeh')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {grouped.map((f) => {
              const st = STATUS_TONE[f.status] ?? STATUS_TONE.open; const pr = PRIO_TONE[f.priority] ?? PRIO_TONE.normal;
              return (
                <div key={f.id} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 13, textTransform: 'capitalize' }}>{pretty(f.reason)}</span>
                    <span style={{ padding: '2px 9px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, background: pr.bg, color: pr.fg, textTransform: 'uppercase' }}>{statusLabel('priority', f.priority)}</span>
                    <span style={{ padding: '2px 9px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, background: st.bg, color: st.fg, textTransform: 'capitalize' }}>{pretty(f.status)}</span>
                    {f.source === 'ai_receptionist' ? <span style={{ fontSize: 10.5, color: '#9B8B78' }}>{t('pos.u2726_from_ai')}</span> : null}
                    <span style={{ fontSize: 11, color: '#9B8B78' }}>{new Date(f.createdAtMs).toLocaleString()}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#6C6965', marginTop: 6 }}>
                    {f.callerPhone ? <span>\u260E {f.callerPhone}&nbsp;&nbsp;</span> : null}
                    {f.providerCallId ? <span style={{ color: '#9B8B78' }}>{t('pos.call')}{' '}{f.providerCallId}</span> : null}
                  </div>
                  {f.notes ? <div style={{ fontSize: 12, color: '#515050', marginTop: 6, whiteSpace: 'pre-wrap' }}>{f.notes}</div> : null}
                  {f.resolution ? <div style={{ fontSize: 12, color: '#3E8F57', marginTop: 6 }}>{t('pos.resolved')}{' '}{f.resolution}</div> : null}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
                    {(NEXT[f.status] ?? []).map((n) => <button key={n.to} style={linkBtn} onClick={() => move(f.id, n.to)}>{n.label}</button>)}
                    {f.status !== 'closed' ? <button style={linkBtn} onClick={() => addNote(f.id)}>{t('pos.add_note')}</button> : null}
                  </div>
                  {editor?.id === f.id ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, alignItems: 'center' }}>
                      <input aria-label={editor.mode === 'resolve' ? t('pos.resolution_note_optional') : t('growth.common.note')} autoFocus
                        placeholder={editor.mode === 'resolve' ? t('pos.resolution_note_optional') : t('pos.add_a_note_2')}
                        value={editorText} onChange={(ev) => setEditorText(ev.target.value)}
                        style={{ flex: 1, minHeight: 36, border: '1px solid var(--line)', borderRadius: 9, padding: '0 10px', fontSize: 12 }} />
                      <button className="btn w-fit whitespace-nowrap" onClick={confirmEditor}>{editor.mode === 'resolve' ? t('pos.resolve') : t('pos.save_note_2')}</button>
                      <button className="btn ghost" onClick={() => { setEditor(null); setEditorText(''); }}>{t('pos.cancel')}</button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div style={{ fontSize: 11.5, color: '#9B8B78' }}><button style={{ ...linkBtn, color: GOLD }} onClick={() => nav('/tenant/ai/receptionist')}>{t('pos.back_to_command_center')}</button></div>
    </div>
  );
}
