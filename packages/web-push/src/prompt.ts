// prompt.ts — Nov 6 2026: the "Turn on notifications" banner's state for a browser push client (POS, admin).
// Nothing asks at sign-in any more; the banner asks from the person's tap (EnableNotificationsBanner in @aipowersalon/ui).
import { useEffect, useState } from 'react';
import type { WebPushClient } from './web-push';

export function usePushPrompt(client: WebPushClient, signedIn: boolean, snoozed: () => boolean, snooze: () => void): { visible: boolean; enable: () => Promise<boolean>; dismiss: () => void } {
  const [state, setState] = useState(() => client.permission());
  const [hidden, setHidden] = useState(false);
  useEffect(() => { if (signedIn) setState(client.permission()); }, [signedIn, client]);
  const visible = signedIn && state === 'prompt' && !hidden && !snoozed();
  const enable = async () => { const ok = await client.enable(); setState(client.permission()); if (ok) setHidden(true); return ok; };
  const dismiss = () => { snooze(); setHidden(true); };
  return { visible, enable, dismiss };
}
