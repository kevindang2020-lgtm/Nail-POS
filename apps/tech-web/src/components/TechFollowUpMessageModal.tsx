import { useEffect, useState } from 'react';
import { techFollowUpApi, type FollowUpTaskView } from '../api/techFollowUpApi';
import type { FollowUpTemplateOption } from '@aipowersalon/api-contracts/tenant';
import { TechFollowUpTemplateSelector } from './TechFollowUpTemplateSelector';

// Bottom-sheet modal to review/edit and send a follow-up. Loads quick templates; picking one renders it server-side for
// this task. The tech can edit freely (if the branch allows it) before sending. Sending creates the Customer App
// message via the backend; if the customer has no app account the backend reports "no app" and we surface it honestly.
import { useEscapeKey } from '@aipowersalon/ui';

export function TechFollowUpMessageModal({ task, canEdit, onClose, onSent }: {
  task: FollowUpTaskView; canEdit: boolean; onClose: () => void; onSent: (t: FollowUpTaskView) => void;
}) {
  useEscapeKey(true, onClose);
  const [message, setMessage] = useState(task.suggestedMessage);
  const [templates, setTemplates] = useState<FollowUpTemplateOption[]>([]);
  const [activeTpl, setActiveTpl] = useState<string | null>(task.templateKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { techFollowUpApi.templates().then(setTemplates).catch(() => setTemplates([])); }, []);

  const pickTemplate = async (key: string) => {
    setError(null);
    try { const r = await techFollowUpApi.preview(task.id, key); setMessage(r.message); setActiveTpl(r.templateKey); }
    catch (e) { setError((e as { message?: string })?.message || 'Could not load that template.'); }
  };

  const send = async () => {
    setBusy(true); setError(null);
    try {
      const edited = canEdit && message.trim() && message.trim() !== task.suggestedMessage;
      if (edited) { try { await techFollowUpApi.editMessage(task.id, message.trim()); } catch { /* fall through to send with message */ } }
      const updated = await techFollowUpApi.send(task.id, canEdit ? message.trim() : undefined);
      onSent(updated);
    } catch (e) { setError((e as { message?: string })?.message || 'Could not send the follow-up.'); setBusy(false); }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Send follow-up"
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
      onClick={onClose}
    >
      <div
        className="tech-card"
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
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(212, 175, 55, 0.15)', color: '#B89028', display: 'grid', placeItems: 'center', fontSize: 18 }}>
              💌
            </span>
            <div>
              <div className="tech-section-title" style={{ fontSize: 18, margin: 0 }}>Follow up with {task.customerName.split(' ')[0]}</div>
              <div className="tech-muted" style={{ fontSize: 12 }}>{task.serviceName}{task.customerHasApp ? '' : ' · customer has no app yet'}</div>
            </div>
          </div>
          <button
            className="tech-iconbtn"
            style={{ border: 'none', background: '#F5F2EA', borderRadius: '50%', width: 32, height: 32, display: 'grid', placeItems: 'center', cursor: 'pointer' }}
            aria-label="Close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <TechFollowUpTemplateSelector templates={templates} active={activeTpl} onPick={pickTemplate} />

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          readOnly={!canEdit}
          rows={5}
          aria-label="Follow-up message"
          style={{
            width: '100%',
            border: '1.5px solid var(--tech-border, #E8E2D6)',
            borderRadius: 14,
            padding: 12,
            fontFamily: 'inherit',
            fontSize: 13.5,
            resize: 'none',
            background: canEdit ? '#FAFAF8' : 'var(--tech-background)',
            color: 'var(--tech-text)',
            boxSizing: 'border-box',
            outline: 'none',
          }}
        />
        {!canEdit ? <div className="tech-muted" style={{ fontSize: 11.5, marginTop: 6 }}>Message editing is turned off for this salon.</div> : null}

        {error ? <div style={{ color: 'var(--tech-danger)', fontSize: 12.5, marginTop: 10 }} role="alert">{error}</div> : null}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 16 }}>
          <button type="button" className="tech-btn outline" onClick={onClose} disabled={busy} style={{ borderRadius: 14, height: 44, margin: 0, fontWeight: 700 }}>
            Cancel
          </button>
          <button type="button" className="tech-btn gold" style={{ borderRadius: 14, height: 44, margin: 0, fontWeight: 700 }} disabled={busy || !message.trim()} onClick={send}>
            {busy ? 'Sending…' : task.customerHasApp ? 'Send in App' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
