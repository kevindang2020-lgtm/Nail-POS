import type { OwnerPeriod } from '../api/ownerApi';

// Shared period selector — the single source of truth for owner period chips (today/week/month/quarter/year). Replaces
// the per-screen inline copies that had diverged in shape, labels, and styling. Reuses the .owner-periods/.owner-chip
// styles so it looks identical to the chips screens already shipped.
const ALL: OwnerPeriod[] = ['today', 'week', 'month', 'quarter', 'year'];
const LABEL: Record<OwnerPeriod, string> = { today: 'Today', week: 'Week', month: 'Month', quarter: 'Quarter', year: 'Year' };

export const periodLabel = (p: OwnerPeriod): string => LABEL[p] ?? 'Month';

export function PeriodSelector({ value, onChange, options = ALL }: { value: OwnerPeriod; onChange: (p: OwnerPeriod) => void; options?: OwnerPeriod[] }) {
  return (
    <div className="owner-periods" role="tablist" aria-label="Period">
      {options.map((p) => (
        <button key={p} role="tab" aria-selected={value === p} className={`owner-chip ${value === p ? 'active' : ''}`} onClick={() => onChange(p)}>{LABEL[p]}</button>
      ))}
    </div>
  );
}
