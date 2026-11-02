import { useEffect, useState } from 'react';
import { disputesApi, type DisputeDetail, type EvidenceSummary, type EvidenceChecklist, type ReviewWorkspace } from '../api/superAdminApi';
import { money, dd } from './_chartkit';

// DisputeEvidenceModals — Unit 2 workflows for three Super Admin Actions:
//  • Review Disputes: full workspace (record + reason-code checklist + existing evidence + timeline).
//  • Collect Supporting Evidence: reason-code checklist + request-from-tenant + accept/reject review of items.
//  • Upload Receipts & Records: client-side validation mirror + secure upload (server hashes, dedupes, scans).
// The server is authoritative for validation, hashing, dedupe, and scanning; the client checks only for fast feedback.

const ALLOWED_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
const MAX_BYTES = 15 * 1024 * 1024;
const BLOCKED_EXT = /\.(exe|sh|bat|cmd|com|js|mjs|jar|msi|dll|scr|ps1|vbs|app|bin)$/i;

function Overlay({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div role="dialog" aria-label={title} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.32)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 50, padding: '5vh 16px' }} onClick={onClose}>
      <div className="panel" style={{ width: wide ? 720 : 520, maxHeight: '86vh', overflowY: 'auto', background: '#fff' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>{title}</strong>
          <button className="btn ghost" style={{ height: 26 }} onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ReviewBadge({ s }: { s: string }) {
  const tone: Record<string, [string, string]> = { accepted: ['#E7F2EA', '#2F6B43'], rejected: ['#FBEAEA', '#9B2C2C'], incomplete: ['#FBF1E3', '#9A6114'], uploaded: ['#E7EFF7', '#2B5E8C'] };
  const [bg, c] = tone[s] ?? ['#EEE', '#555'];
  return <span style={{ background: bg, color: c, padding: '1px 7px', borderRadius: 999, fontSize: 10.5, fontWeight: 600 }}>{s}</span>;
}

export function ReviewDisputeModal({ disputeRef, onClose, onChanged }: { disputeRef: string; onClose: () => void; onChanged?: () => void }) {
  const [ws, setWs] = useState<ReviewWorkspace | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => { setErr(null); disputesApi.review(disputeRef).then((d) => setWs(d as ReviewWorkspace)).catch((e: any) => setErr(e?.message || 'Failed to load')); };
  useEffect(load, [disputeRef]);
  const d: DisputeDetail | undefined = ws?.dispute;

  const review = async (evidenceId: string, decision: string) => {
    try { await disputesApi.reviewEvidence(disputeRef, evidenceId, { decision }); load(); onChanged?.(); } catch (e: any) { setErr(e?.message || 'Review failed'); }
  };

  return (
    <Overlay title={`Review Dispute — ${disputeRef}`} onClose={onClose} wide>
      {err && <div className="state" style={{ color: '#9B2C2C' }}>{err}</div>}
      {!d ? <div className="state">Loading workspace…</div> : (
        <div style={{ display: 'grid', gap: 12, fontSize: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Field l="Tenant" v={d.tenantName} /><Field l="Branch" v={d.branchName ?? '—'} />
            <Field l="Amount" v={`${money(d.amountCents)} ${d.currency}`} /><Field l="Reason" v={d.reasonCode ?? '—'} />
            <Field l="Transaction" v={d.transactionRef ?? '—'} /><Field l="Processor" v={d.processorType ?? '—'} />
            <Field l="Deadline" v={dd(d.dueBy)} /><Field l="Risk" v={d.riskLevel} />
          </div>
          {d.notes && <div style={{ padding: 8, background: 'var(--cream2,#FAF6EF)', borderRadius: 8 }}><span className="muted">Customer complaint / notes:</span><div>{d.notes}</div></div>}

          <div>
            <strong style={{ fontSize: 12.5 }}>Evidence checklist</strong>
            <div style={{ display: 'grid', gap: 3, marginTop: 6 }}>
              {ws!.checklist.required.map((r) => <div key={r} style={{ display: 'flex', gap: 6 }}><span style={{ color: ws!.missingRequired.includes(r) ? '#9B2C2C' : '#2F6B43' }}>{ws!.missingRequired.includes(r) ? '✗' : '✓'}</span><span>{r} <span className="muted">(required)</span></span></div>)}
              {ws!.checklist.recommended.map((r) => <div key={r} style={{ display: 'flex', gap: 6 }}><span className="muted">○</span><span>{r} <span className="muted">(recommended)</span></span></div>)}
            </div>
          </div>

          <div>
            <strong style={{ fontSize: 12.5 }}>Uploaded evidence ({d.evidence.length})</strong>
            {d.evidence.length === 0 ? <div className="state">No evidence uploaded yet.</div> : (
              <table className="tgrid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, marginTop: 6 }}>
                <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10 }}><th>Type</th><th>File</th><th>Scan</th><th>Review</th><th>Actions</th></tr></thead>
                <tbody>{d.evidence.map((e) => (
                  <tr key={e.id} style={{ borderTop: '1px solid var(--line)' }}>
                    <td>{e.type}</td><td>{e.fileName ?? '—'}</td><td>{e.scanStatus}</td><td><ReviewBadge s={e.reviewStatus} /></td>
                    <td style={{ display: 'flex', gap: 4 }}>
                      <button className="btn ghost" style={{ height: 22, padding: '0 6px' }} onClick={() => review(e.id, 'accepted')}>Accept</button>
                      <button className="btn ghost" style={{ height: 22, padding: '0 6px' }} onClick={() => review(e.id, 'rejected')}>Reject</button>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>

          <div>
            <strong style={{ fontSize: 12.5 }}>Timeline</strong>
            <div style={{ display: 'grid', gap: 2, marginTop: 6 }}>
              {d.timeline.length === 0 ? <div className="muted">No status history.</div> : d.timeline.map((t, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, fontSize: 11 }}><span className="muted" style={{ whiteSpace: 'nowrap' }}>{dd(t.at)}</span><span>{t.fromStatus ? `${t.fromStatus} → ` : ''}{t.toStatus} <span className="muted">({t.source})</span></span></div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Overlay>
  );
}

export function CollectEvidenceModal({ disputeRef, onClose, onChanged }: { disputeRef: string; onClose: () => void; onChanged?: () => void }) {
  const [data, setData] = useState<{ checklist: EvidenceChecklist; evidence: EvidenceSummary[] } | null>(null);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => { setErr(null); disputesApi.evidence(disputeRef).then((d) => setData(d as any)).catch((e: any) => setErr(e?.message || 'Failed to load')); };
  useEffect(load, [disputeRef]);

  const request = async () => {
    try { const r = await disputesApi.requestEvidence(disputeRef, { note: note || undefined }); setMsg(`Evidence requested (status: ${r.evidenceStatus}). The tenant has been notified in the record.`); onChanged?.(); load(); }
    catch (e: any) { setErr(e?.message || 'Request failed'); }
  };

  return (
    <Overlay title={`Collect Supporting Evidence — ${disputeRef}`} onClose={onClose}>
      {err && <div className="state" style={{ color: '#9B2C2C' }}>{err}</div>}
      {msg && <div style={{ padding: '6px 10px', background: '#E7F2EA', color: '#2F6B43', borderRadius: 8, fontSize: 12 }}>{msg}</div>}
      {!data ? <div className="state">Loading checklist…</div> : (
        <div style={{ display: 'grid', gap: 12, fontSize: 12 }}>
          <div>
            <strong style={{ fontSize: 12.5 }}>Reason-code checklist</strong>
            <div style={{ display: 'grid', gap: 3, marginTop: 6 }}>
              {data.checklist.required.map((r) => <div key={r}>• {r} <span className="muted">(required)</span></div>)}
              {data.checklist.recommended.map((r) => <div key={r} className="muted">• {r} (recommended)</div>)}
            </div>
          </div>
          <div>
            <label className="flabel">Request note to tenant (optional)</label>
            <textarea className="finput" style={{ minHeight: 60 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Describe what evidence is needed…" />
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <button className="btn" onClick={request}>Request Evidence from Tenant</button>
              <button className="btn ghost" onClick={onClose}>Done</button>
            </div>
          </div>
          <div>
            <strong style={{ fontSize: 12.5 }}>Current evidence ({data.evidence.length})</strong>
            {data.evidence.length === 0 ? <div className="state">None yet — use “Upload Receipts &amp; Records”.</div> : (
              <div style={{ display: 'grid', gap: 3, marginTop: 6 }}>{data.evidence.map((e) => <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between' }}><span>{e.evidenceType} — {e.fileName}</span><ReviewBadge s={e.reviewStatus} /></div>)}</div>
            )}
          </div>
        </div>
      )}
    </Overlay>
  );
}

export function UploadEvidenceModal({ disputeRef, onClose, onChanged }: { disputeRef: string; onClose: () => void; onChanged?: () => void }) {
  const [evidenceType, setEvidenceType] = useState('signed_receipt');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const validateLocal = (f: File): string | null => {
    if (BLOCKED_EXT.test(f.name)) return 'Executable and script files are not allowed.';
    if (!ALLOWED_MIME.has(f.type)) return `Unsupported file type: ${f.type || 'unknown'}. Allowed: PDF, PNG, JPEG, WEBP, DOCX, XLSX.`;
    if (f.size > MAX_BYTES) return `File exceeds the ${Math.round(MAX_BYTES / 1024 / 1024)} MB limit.`;
    return null;
  };

  const onPick = (f: File | null) => { setMsg(null); setErr(null); setFile(f); setLocalErr(f ? validateLocal(f) : null); };

  const toBase64 = (f: File) => new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] ?? ''); r.onerror = reject; r.readAsDataURL(f); });

  const submit = async () => {
    if (!file) { setLocalErr('Choose a file first.'); return; }
    const le = validateLocal(file); if (le) { setLocalErr(le); return; }
    setBusy(true); setErr(null);
    try {
      const contentBase64 = await toBase64(file);
      const r = await disputesApi.uploadEvidence(disputeRef, { evidenceType, fileName: file.name, mimeType: file.type, sizeBytes: file.size, contentBase64, description: description || undefined });
      setMsg(`Uploaded “${r.evidence.fileName}” — scan: ${r.evidence.scanStatus}.`); setFile(null); onChanged?.();
    } catch (e: any) { setErr(e?.message || 'Upload failed'); }
    finally { setBusy(false); }
  };

  return (
    <Overlay title={`Upload Receipts & Records — ${disputeRef}`} onClose={onClose}>
      {err && <div className="state" style={{ color: '#9B2C2C' }}>{err}</div>}
      {msg && <div style={{ padding: '6px 10px', background: '#E7F2EA', color: '#2F6B43', borderRadius: 8, fontSize: 12 }}>{msg}</div>}
      <div style={{ display: 'grid', gap: 10, fontSize: 12 }}>
        <div><label className="flabel">Evidence type</label>
          <select className="finput" value={evidenceType} onChange={(e) => setEvidenceType(e.target.value)}>
            {['signed_receipt', 'itemized_receipt', 'service_record', 'appointment_record', 'customer_checkin', 'service_completion', 'customer_communication', 'cancellation_policy', 'refund_policy', 'proof_of_refund', 'proof_of_service', 'technician_notes', 'before_after_photos', 'membership_agreement', 'other'].map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
        <div><label className="flabel">File (PDF, PNG, JPEG, WEBP, DOCX, XLSX — max 15 MB)</label>
          <input className="finput" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx" onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
          {file && <div className="muted" style={{ marginTop: 4 }}>{file.name} · {(file.size / 1024).toFixed(0)} KB · {file.type || 'unknown'}</div>}
          {localErr && <div style={{ color: '#9B2C2C', marginTop: 4 }}>{localErr}</div>}
        </div>
        <div><label className="flabel">Description (optional)</label><input className="finput" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" disabled={busy || !file || !!localErr} onClick={submit}>{busy ? 'Uploading…' : 'Upload Evidence'}</button>
          <button className="btn ghost" onClick={onClose}>Done</button>
        </div>
        <div className="muted" style={{ fontSize: 11 }}>Files are stored by secure reference (never a public URL), hashed for duplicate detection, and malware-scanned server-side before acceptance.</div>
      </div>
    </Overlay>
  );
}

function Field({ l, v }: { l: string; v: string }) {
  return <div><div className="muted" style={{ fontSize: 10.5 }}>{l}</div><div>{v}</div></div>;
}
