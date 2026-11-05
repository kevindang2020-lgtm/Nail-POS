// CommunityEvidence.tsx — the posting salon's private evidence for one advisory (contract §4: own salon only). Other
// salons only ever see "N files · reviewed" (`post.evidence`), never the files. Upload = ticket (type, size, sha256) →
// PUT the bytes to storage → complete (the server verifies the object and scans it; fail closed). Opening a file asks
// for a reason (it is logged) and gets a short-lived link. No storage configured → the server's 503 is shown in words.
import { useCallback, useEffect, useState } from 'react';
import type { CommunityEvidenceView } from '@aipowersalon/api-contracts/tenant';
import { posCommunityApi as api, sha256Hex } from '../../api/posCommunityApi';
import { btnGhost, card, cardHead, communityErrorText, errText, input, muted, okText, row, when } from './communityUi';
import { t } from '@aipowersalon/mobile-sdk/i18n';

export const EVIDENCE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const EVIDENCE_MAX_BYTES = 15 * 1024 * 1024;
const SCAN: Record<CommunityEvidenceView['scanStatus'], string> = { get unscanned() { return t('growth.community.scan.unscanned'); }, get clean() { return t('growth.community.scan.clean'); }, get infected() { return t('growth.community.scan.infected'); }, get error() { return t('growth.community.scan.error'); } };

export function CommunityEvidencePanel({ postId, canUpload, tick }: { postId: string; canUpload: boolean; tick?: number }) {
  const [items, setItems] = useState<CommunityEvidenceView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const load = useCallback(() => api.postEvidence(postId).then((r) => { setItems(r); setError(null); }).catch((e) => setError(communityErrorText(e, t('growth.community.couldNotLoadTheEvidence')))), [postId]);
  useEffect(() => { load(); }, [load, tick]);

  const upload = async (file: File | undefined) => {
    setMsg(null); setError(null);
    if (!file) return;
    if (!EVIDENCE_TYPES.includes(file.type)) { setError(t('pos.only_jpeg_png_webp_images_or_l7to')); return; }
    if (file.size > EVIDENCE_MAX_BYTES) { setError(t('pos.that_file_is_larger_than_15_f3w3')); return; }
    setBusy(true);
    try {
      const sha256 = await sha256Hex(file);
      const ticket = await api.requestEvidenceUpload({ postId, mimeType: file.type, sizeBytes: file.size, sha256 });
      await api.putEvidenceBytes(ticket, file);
      const done = await api.completeEvidence(ticket.evidenceId);
      setMsg(done.scanStatus === 'clean' ? t('pos.uploaded_and_scanned_clean') : t('pos.uploaded_v0', { v0: String(SCAN[done.scanStatus] ?? done.scanStatus) }));
      await load();
    } catch (e) { setError(communityErrorText(e, t('growth.community.theUploadDidNotFinish'))); }
    finally { setBusy(false); }
  };
  const open = async (id: string) => {
    setError(null);
    try {
      const a = await api.evidenceAccess(id, reason.trim());
      setOpening(null); setReason('');
      window.open(a.url, '_blank', 'noopener');
    } catch (e) { setError(communityErrorText(e, t('growth.community.couldNotOpenTheFile'))); }
  };

  return (
    <section style={card} aria-label={t('pos.private_evidence')} data-testid="community-evidence">
      <div style={cardHead}>{t('pos.private_evidence')}{' '}<span style={muted}>{t('pos.only_your_salon_and_moderators_can_jkc6')}</span></div>
      {error ? <div role="alert" style={errText}>{error}</div> : null}
      {msg ? <div role="status" style={okText}>{msg}</div> : null}
      {items && items.length === 0 ? <div style={muted}>{t('pos.no_files_yet')}</div> : null}
      <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0', display: 'grid', gap: 6 }}>
        {(items ?? []).map((ev) => (
          <li key={ev.id} style={{ ...row, justifyContent: 'space-between', fontSize: 12.5 }} data-testid="community-evidence-row">
            <span>{ev.mimeType || 'file'} · {ev.sizeBytes != null ? t('pos.v0_kb_2', { v0: String(Math.ceil(ev.sizeBytes / 1024)) }) : '—'} · {ev.uploadStatus === 'uploaded' ? SCAN[ev.scanStatus] : ev.uploadStatus === 'failed' ? t('pos.upload_failed') : t('pos.upload_not_finished')} · {when(ev.createdAt)}</span>
            {ev.uploadStatus === 'uploaded' && ev.scanStatus === 'clean' ? (
              opening === ev.id ? (
                <span style={row}>
                  <input style={input} aria-label={t('pos.reason_for_opening_this_file')} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('pos.why_are_you_opening_it')} />
                  <button style={btnGhost} disabled={reason.trim().length < 3} onClick={() => open(ev.id)}>{t('pos.open_file')}</button>
                  <button style={btnGhost} onClick={() => setOpening(null)}>{t('pos.cancel')}</button>
                </span>
              ) : <button style={btnGhost} onClick={() => { setOpening(ev.id); setReason(''); }}>{t('pos.open_5')}</button>
            ) : null}
          </li>
        ))}
      </ul>
      {canUpload ? (
        <label style={{ ...row, fontSize: 12.5 }}>
          <span>{busy ? t('pos.uploading') : t('pos.add_evidence_jpeg_png_webp_or_tt71')}</span>
          <input type="file" aria-label={t('pos.upload_evidence_file')} accept={EVIDENCE_TYPES.join(',')} disabled={busy} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
      ) : null}
    </section>
  );
}
