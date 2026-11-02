// stepUp.tsx — Security Deep Scan C7: refunds and voids (POST /mobile-checkout/payments/:id/refund|void,
// /mobile-checkout/tickets/:id/refund) are step-up routes. The API answers 403 { code: 'STEP_UP_REQUIRED' } when this
// session has not re-proved the password (and the authenticator code, when the account has one) recently. run(action)
// runs the action; that answer opens the inline prompt, POST /auth/step-up stamps the session, and the action is
// retried ONCE (same idempotency key — the guard refused it before anything ran). Cancel rejects with
// STEP_UP_CANCELLED, which screens treat as "nothing happened" (isStepUpCancelled → no error shown).
// Inline UI only (no native dialogs — platform invariant).
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useT } from '@aipowersalon/mobile-sdk';
import { authApi } from '../api/authApi';

export const errorCode = (e: any): string | undefined => e?.code ?? e?.details?.code ?? e?.body?.code ?? e?.body?.error?.code ?? undefined;
export const isStepUpRequired = (e: any) => errorCode(e) === 'STEP_UP_REQUIRED';
export const isStepUpCancelled = (e: any) => errorCode(e) === 'STEP_UP_CANCELLED';

type Pending = { action: () => Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void; message?: string };

export function useStepUp(): { run: <T>(action: () => Promise<T>, message?: string) => Promise<T>; prompt: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);
  const ref = useRef<Pending | null>(null);
  const run = useCallback(async <T,>(action: () => Promise<T>, message?: string): Promise<T> => {
    try { return await action(); }
    catch (e: any) {
      if (!isStepUpRequired(e)) throw e;
      return new Promise<T>((resolve, reject) => { const p = { action, resolve: resolve as (v: unknown) => void, reject, message }; ref.current = p; setPending(p); });
    }
  }, []);
  const close = () => { ref.current = null; setPending(null); };
  const prompt = pending ? (
    <StepUpPrompt
      message={pending.message}
      onConfirm={async (password, code) => {
        await (code ? authApi.stepUp(password, code) : authApi.stepUp(password));   // a wrong password throws → the prompt shows it
        const p = ref.current; close();
        if (!p) return;
        try { p.resolve(await p.action()); } catch (err) { p.reject(err); }
      }}
      onCancel={() => { const p = ref.current; close(); p?.reject(Object.assign(new Error('cancelled'), { code: 'STEP_UP_CANCELLED' })); }}
    />
  ) : null;
  return { run, prompt };
}

export function StepUpPrompt({ onConfirm, onCancel, message }: { onConfirm: (password: string, code: string) => Promise<void>; onCancel: () => void; message?: string }) {
  const tr = useT();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try { await onConfirm(password, code.replace(/\s+/g, '')); }
    catch (e: any) { setErr(e?.message || tr('pay.ticket.stepUpFailed')); setBusy(false); }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label={tr('pay.ticket.stepUpTitle')} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(30,20,10,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="pay-composepanel" style={{ background: 'var(--card, #FFFDF8)', borderRadius: 14, padding: 18, width: 'min(380px, 100%)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <strong>{tr('pay.ticket.stepUpTitle')}</strong>
        <div className="pay-note">{message ?? tr('pay.stepUp.moneyMessage')}</div>
        <input className="pay-reasoninput" type="password" autoComplete="current-password" aria-label={tr('pay.ticket.stepUpPassword')} placeholder={tr('pay.ticket.stepUpPassword')} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        <input className="pay-reasoninput" inputMode="numeric" autoComplete="one-time-code" aria-label={tr('pay.stepUp.code')} placeholder={tr('pay.stepUp.code')} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        {err && <div className="pay-note" role="alert">{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="pay-ghostbtn" onClick={onCancel} disabled={busy}>{tr('pay.stepUp.cancel')}</button>
          <button className="pay-ghostbtn" onClick={() => void submit()} disabled={busy || password.length === 0}>{busy ? tr('pay.ticket.checking') : tr('pay.ticket.stepUpConfirm')}</button>
        </div>
      </div>
    </div>
  );
}
