// useCredentials.ts — which credential this display runs with (23-inch spec §8–§12):
//   a one-off session link (?session=&token=) ─→ that checkout only
//   a paired display ─────────────────────────→ its device credential from the secure store (deviceCredential.ts)
//   nothing ──────────────────────────────────→ the pairing screen
// A device credential the server refuses (the owner revoked the display) is forgotten and the display goes back to pairing.
import { useCallback, useEffect, useRef, useState } from 'react';
import { readCreds, type Creds } from './api';
import { credentialStore, takeTokenFromAddress, type CredentialStore } from './deviceCredential';

export type CredentialStatus = 'loading' | 'unpaired' | 'ready';

export function useCredentials(store: CredentialStore = credentialStore()) {
  const storeRef = useRef(store);
  const [st, setSt] = useState<{ status: CredentialStatus; creds: Creds | null }>(() => {
    const fromAddress = takeTokenFromAddress();
    if (fromAddress) {
      void storeRef.current.set(fromAddress);   // moved into the store; already wiped from the address
      return { status: 'ready', creds: { mode: 'device', deviceToken: fromAddress } };
    }
    const session = readCreds();
    if (session?.mode === 'session') return { status: 'ready', creds: session };
    return { status: 'loading', creds: null };
  });

  useEffect(() => {
    if (st.status !== 'loading') return;
    let live = true;
    storeRef.current.get()
      .then((t) => { if (live) setSt(t ? { status: 'ready', creds: { mode: 'device', deviceToken: t } } : { status: 'unpaired', creds: null }); })
      .catch(() => { if (live) setSt({ status: 'unpaired', creds: null }); });
    return () => { live = false; };
  }, [st.status]);

  /** The pairing handed this display its credential. */
  const paired = useCallback(async (token: string) => {
    await storeRef.current.set(token);
    setSt({ status: 'ready', creds: { mode: 'device', deviceToken: token } });
  }, []);

  /** The server refused the credential (revoked): forget it — the display shows its pairing screen. */
  const forget = useCallback(async () => {
    await storeRef.current.remove().catch(() => undefined);
    setSt({ status: 'unpaired', creds: null });
  }, []);

  return { status: st.status, creds: st.creds, paired, forget };
}
