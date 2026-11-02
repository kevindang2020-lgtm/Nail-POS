// usePairing.ts — 23-inch spec §8–§12: the display pairs ITSELF. It asks the server for a code, shows it, and polls (with
// the secret only it holds) until the owner types the code into the POS — then collects its device credential, once.
// An expired code is replaced by a fresh one; an unreachable server is retried; nothing here involves a salon login.
import { useEffect, useRef, useState } from 'react';
import type { DisplayPairingStart } from '@aipowersalon/api-contracts/customer';
import { DisplayApiError, pollPairing, startPairing } from './api';
import { displayPlatform } from './deviceCredential';

export const PAIRING_POLL_MS = 2_000;
const RETRY_MS = 5_000;
const RATE_LIMITED_RETRY_MS = 60_000;

export interface PairingView {
  code: string | null;
  expiresAt: string | null;
  /** set for a moment after the owner paired it: the salon and branch it now belongs to */
  pairedTo: { salonName: string; branchName: string | null; deviceName: string } | null;
  problem: string | null;
}

export function usePairing(onPaired: (deviceToken: string) => void): PairingView {
  const [view, setView] = useState<PairingView>({ code: null, expiresAt: null, pairedTo: null, problem: null });
  const onPairedRef = useRef(onPaired);
  onPairedRef.current = onPaired;

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let current: DisplayPairingStart | null = null;
    const later = (fn: () => void, ms: number) => { if (live) timer = setTimeout(fn, ms); };

    const start = async () => {
      try {
        current = await startPairing(displayPlatform());
        if (!live) return;
        setView({ code: current.code, expiresAt: current.expiresAt, pairedTo: null, problem: null });
        later(poll, PAIRING_POLL_MS);
      } catch (e) {
        if (!live) return;
        const limited = e instanceof DisplayApiError && e.status === 429;
        setView((v) => ({ ...v, code: null, problem: limited ? 'Too many codes were requested from this network. A new code will appear in a minute.' : 'Can’t reach the salon’s server. Retrying…' }));
        later(start, limited ? RATE_LIMITED_RETRY_MS : RETRY_MS);
      }
    };

    const poll = async () => {
      if (!current) return start();
      try {
        const r = await pollPairing(current);
        if (!live) return;
        if (r.status === 'waiting') { setView((v) => (v.problem ? { ...v, problem: null } : v)); later(poll, PAIRING_POLL_MS); return; }
        if (r.status === 'expired') { current = null; await start(); return; }
        // paired: the credential is handed over exactly once — keep it, show where it now belongs, then run as that display
        setView({ code: null, expiresAt: null, pairedTo: { salonName: r.salonName, branchName: r.branchName, deviceName: r.deviceName }, problem: null });
        onPairedRef.current(r.deviceToken);
      } catch (e) {
        if (!live) return;
        if (e instanceof DisplayApiError && e.status === 403) { current = null; await start(); return; }
        setView((v) => ({ ...v, problem: 'Can’t reach the salon’s server. Retrying…' }));
        later(poll, RETRY_MS);
      }
    };

    void start();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, []);

  return view;
}
