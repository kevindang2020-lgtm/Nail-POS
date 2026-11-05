import type { OwnerPeriod } from '../api/ownerApi';

// Shared period selector — the single source of truth for owner period chips (today/week/month/quarter/year). Replaces
// the per-screen inline copies that had diverged in shape, labels, and styling. Reuses the .owner-periods/.owner-chip
// styles so it looks identical to the chips screens already shipped.
const ALL: OwnerPeriod[] = ['today', 'week', 'month', 'quarter', 'year'];
const LABEL: Record<OwnerPeriod, string> = { today: 'Today', week: 'Week', month: 'Month', quarter: 'Quarter', year: 'Year' };

export const periodLabel = (p: OwnerPeriod): string => LABEL[p] ?? 'Month';

export function PeriodSelector({
  value,
  onChange,
  options = ALL,
  customLabel,
  onClearCustom,
  onOpenCalendar,
}: {
  value: OwnerPeriod;
  onChange: (p: OwnerPeriod) => void;
  options?: OwnerPeriod[];
  customLabel?: string | null;
  onClearCustom?: () => void;
  onOpenCalendar?: () => void;
}) {
  return (
    <div className="owner-periods" role="tablist" aria-label="Period">
      {options.map((p) => {
        const isSelected = !customLabel && value === p;
        return (
          <button
            key={p}
            role="tab"
            aria-selected={isSelected}
            className={`owner-chip ${isSelected ? 'active' : ''}`}
            onClick={() => {
              if (customLabel && onClearCustom) onClearCustom();
              onChange(p);
            }}
          >
            {LABEL[p]}
          </button>
        );
      })}
      {customLabel && (
        <button
          role="tab"
          aria-selected="true"
          className="owner-chip active"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          onClick={onOpenCalendar}
        >
          <span>{customLabel}</span>
          {onClearCustom && (
            <span
              role="button"
              aria-label="Clear date filter"
              onClick={(e) => {
                e.stopPropagation();
                onClearCustom();
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 16,
                height: 16,
                borderRadius: '50%',
                background: 'rgba(0, 0, 0, 0.12)',
                fontSize: 10,
                lineHeight: 1,
                marginLeft: 2,
              }}
            >
              ✕
            </span>
          )}
        </button>
      )}
    </div>
  );
}
