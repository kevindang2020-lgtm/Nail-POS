import type { FollowUpTemplate } from '../api/techFollowUpApi';

// Quick-template chooser used inside the send modal. Tapping a template asks the backend to render it for this task
// (server-side, with the customer/service/tech/salon filled in) and replaces the editable message.
export function TechFollowUpTemplateSelector({ templates, active, onPick }: { templates: FollowUpTemplate[]; active: string | null; onPick: (key: string) => void }) {
  if (templates.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }} aria-label="Message templates">
      {templates.map((t) => (
        <button key={t.key} type="button" className={'tech-chip ' + (active === t.key ? 'neutral' : '')}
          style={active === t.key ? undefined : { border: '1px solid var(--tech-border)', background: 'var(--tech-surface-soft)', color: 'var(--tech-text)', cursor: 'pointer' }}
          onClick={() => onPick(t.key)}>{t.label}</button>
      ))}
    </div>
  );
}
