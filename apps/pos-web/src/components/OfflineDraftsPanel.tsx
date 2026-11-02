// OfflineDraftsPanel.tsx — Functional Decision 33, reconnect step: notes saved offline wait here. For each draft the
// order is authenticate → refresh → validate; then a person applies or discards it. A draft whose record changed on
// another device meanwhile is shown as a conflict ("Apply anyway" overwrites; "Discard" keeps the newer notes).
import { useEffect, useState } from 'react';
import { listDrafts, removeDraft, checkDraft, DRAFTS_CHANGED, type OfflineDraft, type DraftCheck } from '../api/offline-drafts';
import { posCustomersApi } from '../api/posCustomersApi';
import { authApi } from '../api/authApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';

const deps = {
  online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
  whoAmI: () => authApi.me(),
  fetchCurrent: (id: string) => posCustomersApi.getNotes(id) as Promise<Record<string, unknown> | null>,
};

export function OfflineDraftsPanel({ online }: { online: boolean }) {
  const [drafts, setDrafts] = useState<OfflineDraft[]>(() => listDrafts());
  const [open, setOpen] = useState(false);
  const [checks, setChecks] = useState<Record<string, DraftCheck | 'checking'>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const on = () => setDrafts(listDrafts());
    window.addEventListener(DRAFTS_CHANGED, on);
    return () => window.removeEventListener(DRAFTS_CHANGED, on);
  }, []);
  useEffect(() => { setDrafts(listDrafts()); }, [online]);

  const check = async (d: OfflineDraft) => {
    setChecks((c) => ({ ...c, [d.id]: 'checking' }));
    const r = await checkDraft(d, deps);
    setChecks((c) => ({ ...c, [d.id]: r }));
  };
  const reviewAll = async () => { setOpen(true); setMsg(null); for (const d of listDrafts()) await check(d); };
  const apply = async (d: OfflineDraft) => {
    setBusy(d.id); setMsg(null);
    try { await posCustomersApi.setNotes(d.targetId, d.payload); removeDraft(d.id); setMsg(t('pos.applied_the_notes_for_label', { label: String(d.label) })); }
    catch (e: any) { setMsg(e?.message || t('pos.could_not_apply_that_draft_it_1pe4')); }
    finally { setBusy(null); }
  };
  const discard = (d: OfflineDraft) => { removeDraft(d.id); setMsg(t('pos.discarded_the_draft_for_label', { label: String(d.label) })); };

  if (!online || drafts.length === 0) return null;
  return (
    <div role="region" aria-label={t('pos.notes_saved_offline')} style={{ background: '#FBF5EA', borderBottom: '1px solid #EFE3C8', padding: '8px 16px', fontSize: 13 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontWeight: 600 }}>{drafts.length === 1 ? t('pos.1_note_was') : t('pos.length_notes_were', { length: String(drafts.length) })} {t('pos.saved_on_this_device_while_offline')}</span>
        {!open && <button className="btn ghost" onClick={reviewAll}>{t('pos.review')}</button>}
      </div>
      {open && (
        <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
          {drafts.map((d) => {
            const c = checks[d.id];
            return (
              <li key={d.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span><b>{d.label}</b> {t('pos.customer_notes_saved')}{' '}{new Date(d.savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                {!c || c === 'checking' ? <span className="s muted">{t('pos.checking')}</span>
                  : c.status === 'ready' ? <><span className="s">{t('pos.unchanged_since_you_started_ready')}</span><button className="btn" disabled={busy === d.id} onClick={() => apply(d)}>{t('pos.apply_2')}</button><button className="btn ghost" onClick={() => discard(d)}>{t('pos.discard')}</button></>
                  : c.status === 'conflict' ? <><span className="s" style={{ color: '#A1520B' }}>{t('pos.these_notes_were_changed_on_another_x82e')}</span><button className="btn ghost" disabled={busy === d.id} onClick={() => apply(d)}>{t('pos.apply_anyway')}</button><button className="btn ghost" onClick={() => discard(d)}>{t('pos.discard')}</button></>
                  : c.status === 'gone' ? <><span className="s">{t('pos.that_customer_no_longer_exists')}</span><button className="btn ghost" onClick={() => discard(d)}>{t('pos.discard')}</button></>
                  : c.status === 'signed_out' ? <span className="s">{t('pos.sign_in_again_to_check_this_12b8')}</span>
                  : <><span className="s">{t('pos.still_offline_try_again_shortly')}</span><button className="btn ghost" onClick={() => check(d)}>{t('pos.check_again')}</button></>}
              </li>
            );
          })}
        </ul>
      )}
      {msg && <div className="s" style={{ marginTop: 6 }}>{msg}</div>}
    </div>
  );
}
