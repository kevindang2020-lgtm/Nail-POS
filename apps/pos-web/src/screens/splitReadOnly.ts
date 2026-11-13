// splitReadOnly.ts — extras Split Payments 17 (financial read-only mode during an outage). useStaleKeep remembers WHICH query
// a loader's data answered and when; when a later read of that SAME query fails (not a 403), it returns the time of the last
// good read so the screen can keep those figures labelled stale. Any other failure returns null (show the error instead).
import { useEffect, useRef, useState } from 'react';
import { isForbidden } from '../components/FinanceKit';

export function useStaleKeep(l: { data: unknown; error: unknown }, queryKey: string): Date | null {
  const keyRef = useRef(queryKey);
  keyRef.current = queryKey;
  const [ok, setOk] = useState<{ key: string; at: Date } | null>(null);
  // a loader only applies the answer to its NEWEST request, so the data that arrives belongs to the current query
  useEffect(() => { if (l.data) setOk({ key: keyRef.current, at: new Date() }); }, [l.data]);
  return l.error && !isForbidden(l.error) && l.data && ok && ok.key === queryKey ? ok.at : null;
}
