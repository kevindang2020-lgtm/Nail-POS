// RequestHelpModal.tsx — the primary technician asks a qualified colleague to take one service line. Self-contained
// (own overlay + state) so it doesn't entangle the ticket screen's modal chain. Picks a line → loads technicians
// qualified for that line's service (server-resolved) → pick helper + reason → POST /tech/help-requests.
import { useEffect, useState } from 'react';
import { techApi, type TechQualifiedHelper } from '../api/techApi';

const REASONS = [
  'Service requires another specialist', 'Cannot perform this service', 'Customer requested another technician',
  'Time assistance', 'Nail art specialist needed', 'Repair or correction needed', 'Other',
];

export function RequestHelpModal({ ticketId, lines, onClose, onDone }: {
  ticketId: string; lines: { id: string; name: string }[]; onClose: () => void; onDone?: (msg: string) => void;
}) {
  const [lineId, setLineId] = useState(lines[0]?.id || '');
  const [helpers, setHelpers] = useState<TechQualifiedHelper[]>([]);
  const [helperId, setHelperId] = useState('');
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState('');
  const [loadingHelpers, setLoadingHelpers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!lineId) { setHelpers([]); return; }
    let live = true; setLoadingHelpers(true); setHelperId('');
    techApi.qualifiedForLine(ticketId, lineId)
      .then((h) => { if (live) { setHelpers(h); setHelperId(h[0]?.technicianId || ''); } })
      .catch(() => { if (live) setHelpers([]); })
      .finally(() => { if (live) setLoadingHelpers(false); });
    return () => { live = false; };
  }, [ticketId, lineId]);

  const submit = async () => {
    if (!lineId || !helperId || !reason) { setErr('Pick a service, a technician, and a reason.'); return; }
    setBusy(true); setErr(null);
    try {
      await techApi.requestHelp({ ticketId, serviceLineId: lineId, helperTechnicianId: helperId, reason, note: note.trim() || undefined });
      onDone?.('Help requested — the technician has been notified.');
      onClose();
    } catch (e: any) { setErr(e?.message || 'Could not send the request.'); }
    finally { setBusy(false); }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Request help"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 12, 8, 0.55)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 100,
        padding: '16px',
        boxSizing: 'border-box',
      }}
    >
      <div
        className="tech-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#FFFFFF',
          width: '100%',
          maxWidth: 440,
          borderRadius: 24,
          margin: 0,
          padding: '24px 22px',
          boxShadow: '0 24px 60px -12px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(0, 0, 0, 0.05)',
          boxSizing: 'border-box',
          maxHeight: '88vh',
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(212, 175, 55, 0.15)', color: '#B89028', display: 'grid', placeItems: 'center', fontSize: 18 }}>
              🙋
            </span>
            <div>
              <div className="tech-section-title" style={{ fontSize: 18, margin: 0 }}>Request help</div>
              <div className="tech-muted" style={{ fontSize: 12 }}>Ask a qualified colleague</div>
            </div>
          </div>
          <button
            className="tech-iconbtn"
            onClick={onClose}
            aria-label="Close modal"
            style={{ border: 'none', background: '#F5F2EA', borderRadius: '50%', width: 32, height: 32, display: 'grid', placeItems: 'center', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        <label className="tech-label" style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Service</label>
        <select className="tech-input" value={lineId} onChange={(e) => setLineId(e.target.value)} style={{ width: '100%', marginBottom: 12, height: 42, borderRadius: 12 }}>
          {lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>

        <label className="tech-label" style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Qualified technician</label>
        {loadingHelpers
          ? <div className="tech-muted" style={{ padding: '8px 0', fontSize: 13 }}>Finding qualified technicians…</div>
          : helpers.length === 0
            ? <div className="tech-muted" style={{ padding: '8px 0', fontSize: 13, color: '#B45309' }}>No qualified technician is available for this service right now.</div>
            : <select className="tech-input" value={helperId} onChange={(e) => setHelperId(e.target.value)} style={{ width: '100%', marginBottom: 12, height: 42, borderRadius: 12 }}>
                {helpers.map((h) => <option key={h.technicianId} value={h.technicianId}>{h.displayName}</option>)}
              </select>}

        <label className="tech-label" style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Reason</label>
        <select className="tech-input" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: '100%', marginBottom: 12, height: 42, borderRadius: 12 }}>
          {REASONS.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>

        <label className="tech-label" style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Note (optional)</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Add details for your colleague…"
          style={{
            width: '100%',
            padding: 12,
            borderRadius: 14,
            border: '1.5px solid var(--tech-border, #E8E2D6)',
            background: '#FAFAF8',
            fontFamily: 'inherit',
            fontSize: 13.5,
            boxSizing: 'border-box',
            outline: 'none',
            resize: 'none',
          }}
        />

        {err && <div role="alert" style={{ color: 'var(--tech-danger)', fontSize: 13, marginTop: 8 }}>{err}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 16 }}>
          <button type="button" className="tech-btn outline" onClick={onClose} disabled={busy} style={{ borderRadius: 14, height: 44, margin: 0, fontWeight: 700 }}>Cancel</button>
          <button type="button" className="tech-btn gold" onClick={submit} disabled={busy || helpers.length === 0} style={{ borderRadius: 14, height: 44, margin: 0, fontWeight: 700 }}>{busy ? 'Sending…' : 'Send request'}</button>
        </div>
      </div>
    </div>
  );
}
