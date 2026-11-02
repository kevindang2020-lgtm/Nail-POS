// Segmented status filter for the technician follow-up list.
const FILTERS: { key: string; label: string }[] = [
  { key: '', label: 'All' }, { key: 'pending', label: 'Ready' }, { key: 'pending_manager_approval', label: 'Awaiting approval' }, { key: 'rejected', label: 'Returned' },
  { key: 'sent', label: 'Sent' }, { key: 'skipped', label: 'Skipped' }, { key: 'expired', label: 'Expired' },
];

export function TechFollowUpStatusFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 12 }} role="tablist" aria-label="Filter follow-ups">
      {FILTERS.map((f) => {
        const active = value === f.key;
        return (
          <button key={f.key} role="tab" aria-selected={active} onClick={() => onChange(f.key)}
            className={'tech-chip ' + (active ? 'neutral' : '')}
            style={active ? { cursor: 'pointer' } : { border: '1px solid var(--tech-border)', background: 'var(--tech-surface)', color: 'var(--tech-text-secondary)', cursor: 'pointer' }}>
            {f.label}
          </button>
        );
      })}
    </div>
  );
}
