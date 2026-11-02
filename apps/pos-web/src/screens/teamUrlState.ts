// teamUrlState.ts — Team Management round 2A (TM-02 / TM-03): the useSearchParams hook over the pure URL rules in
// teamUrlCore.ts (allowlists, defaults left out, the search text never in the URL, filter change → page 1, ?created=<id>).
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { readTeamUrl, teamQuery, nextTeamUrl, type TeamUrl } from './teamUrlCore';
export * from './teamUrlCore';

export function useTeamUrlState(): [TeamUrl, (patch: Partial<TeamUrl> | ((cur: TeamUrl) => TeamUrl), opts?: { replace?: boolean }) => void] {
  const [sp, setSp] = useSearchParams();
  const state = useMemo(() => readTeamUrl(sp), [sp]);
  const set = useCallback((patch: Partial<TeamUrl> | ((cur: TeamUrl) => TeamUrl), opts?: { replace?: boolean }) => {
    setSp((prev) => { const cur = readTeamUrl(prev); return teamQuery(typeof patch === 'function' ? patch(cur) : nextTeamUrl(cur, patch)); }, { replace: !!opts?.replace });
  }, [setSp]);
  return [state, set];
}
