// accessUi.tsx — shared pieces of the Phase 9 Roles & Permissions / Access governance screens: the step-up prompt (a
// step-up route answers 403 STEP_UP_REQUIRED; the person re-proves their password — and code, when they use an
// authenticator — and the action is retried ONCE), reason-code labels, the sensitivity pill and error wording.
// Inline UI only (no native dialogs — check:dialogs).
import { useCallback, useRef, useState, type ReactNode } from 'react';
import type { AuthzReason, PermissionDefinition, PermissionSensitivity } from '@aipowersalon/api-contracts/tenant';
import { posStepUpApi } from '../../api/posStepUpApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

import { statusLabel, statusLabelOrNull, humanizeCode } from '../../i18n/status-label';
import { fmtInZone } from '../../i18n/format';
// an authorization reason code → its label (ns/admin `admin.access.reason.<code>`), read at render; never a raw code
export const REASON_CODES: readonly AuthzReason[] = ['granted_by_role', 'granted_by_template', 'granted_by_override', 'granted_temporarily', 'denied_by_override',
  'missing_permission', 'out_of_branch_scope', 'out_of_own_scope', 'platform_key_for_tenant', 'tenant_key_for_platform', 'account_inactive', 'policy_denied', 'step_up_required'];
export const reasonLabel = (r: string) => { const k = `admin.access.reason.${r}`; const l = tx(k); return l !== k ? l : statusLabelOrNull('accessReason', r) ?? humanizeCode(r); };

export const roleLabel = (r: string | null | undefined) => statusLabel('role', r);
export const fmtWhen = (iso: string | null | undefined) => {
  if (!iso) return tx('admin.access.never');
  const d = new Date(iso); if (isNaN(d.getTime())) return '—';
  return `${fmtInZone(d, { month: 'short', day: '2-digit', year: 'numeric' })} ${fmtInZone(d, { hour: 'numeric', minute: '2-digit' })}`;
};

const SENS_STYLE: Record<PermissionSensitivity, { bg: string; fg: string }> = {
  low: { bg: 'var(--line)', fg: 'var(--muted)' }, medium: { bg: 'rgba(169,111,34,0.10)', fg: '#8a5a1c' },
  high: { bg: 'rgba(214,120,40,0.16)', fg: '#a2521a' }, critical: { bg: 'rgba(196,48,48,0.14)', fg: '#a32626' },
};
export function SensitivityPill({ s }: { s: PermissionSensitivity | undefined | null }) {
  if (!s) return null;
  const st = SENS_STYLE[s] ?? SENS_STYLE.low;
  return <span data-testid={`sens-${s}`} style={{ fontSize: 10, fontWeight: 800, padding: '1px 7px', borderRadius: 999, background: st.bg, color: st.fg, textTransform: 'uppercase', letterSpacing: '.03em' }}>{s}</span>;
}

/** A catalog key's human label, falling back to the key itself when the registry does not know it. */
export function useDefinitions(catalog: PermissionDefinition[] | null) {
  const byKey = new Map((catalog ?? []).map((d) => [d.key, d]));
  return { def: (k: string) => byKey.get(k) ?? null, label: (k: string) => byKey.get(k)?.label ?? k };
}
/** Registry entries grouped by domain, in a stable order (the custom-role builder, the override picker, the effective view). */
export function groupByDomain<T extends { key: string }>(keys: T[], def: (k: string) => PermissionDefinition | null): { domain: string; items: T[] }[] {
  const m = new Map<string, T[]>();
  for (const k of keys) { const d = def(k.key)?.domain ?? k.key.split('.')[0]; if (!m.has(d)) m.set(d, []); m.get(d)!.push(k); }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([domain, items]) => ({ domain, items }));
}

/** What to tell the person when an access change is refused. */
export function accessError(e: any, fallback: string = tx('admin.access.error.saveChange')): string {
  const code = e?.code ?? e?.details?.code;
  if (code === 'STEP_UP_CANCELLED') return tx('pos.not_changed_the_password_confirmation_was_wxix');
  if (code === 'LAST_OWNER') return tx('pos.the_salon_must_keep_at_least_15rz');
  if (e?.status === 409) return e?.message && e.message !== 'Request failed.' ? e.message : tx('pos.someone_changed_this_at_the_same_gtbd');
  if (e?.status === 403) {
    const reason = e?.details?.reason ? ` (${reasonLabel(String(e.details.reason))})` : '';
    return (e?.message && e.message !== 'You do not have permission to do that.' ? e.message : tx('pos.you_do_not_have_permission_to_1fm2')) + reason;
  }
  return e?.message || fallback;
}
export const isForbidden = (e: any) => e?.status === 403;

/** The server's error code, wherever the client that threw put it: the api client (`code`, `details.code`) or a posHttp
 *  module's own error (`body.code`, `body.error.code`). */
export const errorCode = (e: any): string | undefined => e?.code ?? e?.details?.code ?? e?.body?.code ?? e?.body?.error?.code ?? undefined;
export const isStepUpRequired = (e: any) => errorCode(e) === 'STEP_UP_REQUIRED';
/** The person closed the step-up prompt: nothing changed and nothing went wrong — screens show no error for it. */
export const isStepUpCancelled = (e: any) => errorCode(e) === 'STEP_UP_CANCELLED';

type Pending = { action: () => Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void; message?: string };

/** Wrap a step-up route: run(action) runs it; a STEP_UP_REQUIRED answer opens the prompt, and a successful
 *  confirmation retries the action once. Cancel rejects with code STEP_UP_CANCELLED (isStepUpCancelled — show nothing).
 *  run(action, message) overrides the prompt's sentence for that one action. Render `prompt` somewhere in the screen. */
export function useStepUp(message?: string): { run: <T>(action: () => Promise<T>, message?: string) => Promise<T>; prompt: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);
  const ref = useRef<Pending | null>(null);
  const run = useCallback(async <T,>(action: () => Promise<T>, msg?: string): Promise<T> => {
    try { return await action(); }
    catch (e: any) {
      if (!isStepUpRequired(e)) throw e;
      return new Promise<T>((resolve, reject) => { const p = { action, resolve: resolve as (v: unknown) => void, reject, message: msg }; ref.current = p; setPending(p); });
    }
  }, []);
  const close = () => { ref.current = null; setPending(null); };
  const prompt = pending ? (
    <StepUpPrompt
      message={pending.message ?? message}
      onConfirm={async (password, code) => {
        await posStepUpApi.stepUp(code ? { password, code } : { password });   // a wrong password throws → the prompt shows it
        const p = ref.current; close();
        if (!p) return;
        try { p.resolve(await p.action()); } catch (err) { p.reject(err); }
      }}
      onCancel={() => { const p = ref.current; close(); p?.reject(Object.assign(new Error(tx('pos.cancelled')), { code: 'STEP_UP_CANCELLED' })); }}
    />
  ) : null;
  return { run, prompt };
}

export function StepUpPrompt({ onConfirm, onCancel, message }: { onConfirm: (password: string, code: string) => Promise<void>; onCancel: () => void; message?: string }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try { await onConfirm(password, code.replace(/\s+/g, '')); }
    catch (e: any) { setErr(e?.message || tx('pos.password_or_code_is_not_correct')); setBusy(false); }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label={tx('pos.confirm_it_s_you')} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(30,20,10,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--card,#FFFDF8)', borderRadius: 14, padding: 18, width: 'min(380px, 100%)', display: 'flex', flexDirection: 'column', gap: 8, boxShadow: '0 12px 40px rgba(0,0,0,.18)' }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>{tx('pos.confirm_it_s_you')}</h2>
        <div className="sub" style={{ fontSize: 12.5 }}>{message ?? tx('pos.changing_who_can_do_what_needs_pxon')} {tx('pos.and_the_code_from_your_authenticator_sqd4')}</div>
        <input type="password" aria-label={tx('pos.your_password')} placeholder={tx('pos.password')} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        <input inputMode="numeric" aria-label={tx('pos.authenticator_code')} placeholder={tx('pos.6_digit_code_if_you_use_orn6')} value={code} onChange={(e) => setCode(e.target.value)} />
        {err && <div className="err" role="alert">{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onCancel} disabled={busy}>{tx('pos.cancel')}</button>
          <button className="btn primary" onClick={() => void submit()} disabled={busy || password.length === 0}>{tx('pos.confirm')}</button>
        </div>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '4px 0 12px' }}>
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={`btn${value === t.id ? ' primary' : ' ghost'}`} onClick={() => onChange(t.id)}>{t.label}</button>
      ))}
    </div>
  );
}
