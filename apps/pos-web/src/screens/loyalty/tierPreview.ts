// Tier Qualification Preview (Extras backlog · Loyalty Rewards 05): why a member sits in a tier and which configured
// rule would change it, from the salon's own tier rows only. Nothing is invented: a tier without a points threshold
// says so, and the "next tier" is the next active configured tier (by order) whose threshold is above this one.
// Tiers move only when someone with permission moves them, so this is a guide for that decision, not an automatic rule.
export type TierDef = { name: string; rank: number; minPoints: number | null; active: boolean };
export type TierPreview = {
  current: TierDef | null;              // null = the member's tier is not one of the configured tiers (e.g. Regular)
  earned: number;                       // lifetime earned points, the figure thresholds are compared with
  meetsCurrent: boolean | null;         // null when the current tier has no threshold
  next: TierDef | null;
  toNext: number | null;                // points still to earn to reach the next tier's threshold (0 = already there)
  lower: TierDef | null;                // a configured tier with a lower threshold the member would fall back to
};

export function tierPreview(tiers: TierDef[], memberTier: string, earned: number): TierPreview {
  const act = tiers.filter((t) => t.active).sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  const current = act.find((t) => t.name.toLowerCase() === String(memberTier).toLowerCase()) ?? null;
  const base = current?.minPoints ?? (current ? null : 0);
  const withMin = act.filter((t) => t.minPoints != null) as (TierDef & { minPoints: number })[];
  const above = base == null ? [] : withMin.filter((t) => t.minPoints > base && t !== current).sort((a, b) => a.minPoints - b.minPoints || a.rank - b.rank);
  const next = above[0] ?? null;
  const below = current?.minPoints != null ? withMin.filter((t) => t.minPoints < (current.minPoints as number)).sort((a, b) => b.minPoints - a.minPoints)[0] ?? null : null;
  return {
    current, earned,
    meetsCurrent: current?.minPoints == null ? null : earned >= current.minPoints,
    next, toNext: next ? Math.max(0, next.minPoints! - earned) : null,
    lower: below,
  };
}
