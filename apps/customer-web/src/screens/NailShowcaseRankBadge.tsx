// NailShowcaseRankBadge.tsx — renders a customer's rank as "#8" plus the tier pill ("Top 10" … "Top 500").
const TIERS = [10, 20, 30, 50, 100, 500];

export function rankTier(rank?: number | null): string | null {
  if (!rank || rank < 1) return null;
  for (const t of TIERS) if (rank <= t) return `Top ${t}`;
  return null;
}

export function NailShowcaseRankBadge({ rank, showTier = true }: { rank?: number | null; showTier?: boolean }) {
  if (!rank || rank < 1) return null;
  const tier = rankTier(rank);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontWeight: 800, color: 'var(--customer-primary)' }}>#{rank}</span>
      {showTier && tier ? (
        <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--customer-primary)', borderRadius: 999, padding: '2px 8px' }}>{tier}</span>
      ) : null}
    </span>
  );
}
