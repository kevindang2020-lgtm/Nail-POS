// AiAssistantPanel.tsx — the single reusable POS entry point for any of the 15 AI assistants. Drop it into any POS area
// with a packageCode; it checks the tenant's access state (gate decision) and either offers the assistant or renders a
// clean locked/upgrade panel with the exact reason — it never calls the model when locked. This is the pattern every POS
// area reuses (Checkout → upsell, Queue → tech assignment, Customers → profile, etc.).
import { useEffect, useState } from 'react';
import { posAiApi, type PosAiPackage } from '../api/posAiApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { serverText } from '../i18n/server-text';

interface Props {
  packageCode: string;
  /** Button label, e.g. "Suggest upsells". */
  cta?: string;
  action?: string;
  /** Build the (tenant-scoped) prompt at click time from local screen state. */
  buildPrompt?: () => string;
}

export function AiAssistantPanel({ packageCode, cta, action = 'invoke', buildPrompt }: Props) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'locked' | 'hidden'>('loading');
  const [pkg, setPkg] = useState<PosAiPackage | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    posAiApi.packages()
      .then((r) => { if (!alive) return; const p = r.packages.find((x) => x.code === packageCode) ?? null; setPkg(p); setPhase(p ? (p.accessible ? 'ready' : 'locked') : 'hidden'); })
      .catch(() => { if (alive) setPhase('hidden'); }); // fail quiet in POS — never block the till on an AI status call
    return () => { alive = false; };
  }, [packageCode]);

  const run = () => {
    setBusy(true); setErr(null);
    posAiApi.invoke(packageCode, { action, prompt: buildPrompt ? buildPrompt() : '' })
      .then((r) => { setResult(r.text ?? ''); if (typeof r.remainingUsage === 'number' && pkg) setPkg({ ...pkg, remainingUsage: r.remainingUsage }); })
      .catch((e: any) => setErr(e?.status === 403 ? t('pos.this_ai_assistant_is_no_longer_1whc') : e?.message || t('pos.ai_request_failed')))
      .finally(() => setBusy(false));
  };

  if (phase === 'loading' || phase === 'hidden') return null;

  const wrap: React.CSSProperties = { border: '1px solid var(--line, #e7e2d8)', borderRadius: 12, padding: 12, background: 'var(--surface, #fffdf8)', margin: '10px 0' };
  const head: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 };
  const btn: React.CSSProperties = { border: 'none', borderRadius: 9, padding: '8px 14px', fontWeight: 700, fontFamily: 'inherit', background: 'var(--accent, #A9824C)', color: '#fff', cursor: 'pointer' };

  if (phase === 'locked') {
    return (
      <div style={wrap} data-testid={`ai-locked-${packageCode}`}>
        <div style={head}><span aria-hidden>🔒</span><strong>{serverText(pkg?.name)}</strong></div>
        <div style={{ fontSize: 13, color: 'var(--muted, #777)' }}>{pkg?.lockLabel ? serverText(pkg.lockLabel) : t('pos.not_available_on_your_plan')}</div>
        <div style={{ fontSize: 12, color: 'var(--muted, #999)', marginTop: 6 }}>{t('pos.ask_your_salon_owner_to_enable_o60q')}</div>
      </div>
    );
  }

  return (
    <div style={wrap} data-testid={`ai-panel-${packageCode}`}>
      <div style={head}><span aria-hidden>✨</span><strong>{serverText(pkg?.name)}</strong>{pkg && pkg.remainingUsage >= 0 ? <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted, #999)' }}>{pkg.remainingUsage.toLocaleString()} {pkg.usageUnit} {t('pos.left')}</span> : null}</div>
      {result == null ? (
        <button style={btn} disabled={busy} onClick={run}>{busy ? t('pos.thinking') : (cta ?? t('growth.assistant.cta'))}</button>
      ) : (
        <>
          <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', background: '#fff', border: '1px solid var(--line, #eee)', borderRadius: 8, padding: 10 }}>{result}</div>
          <button style={{ ...btn, background: 'transparent', color: 'var(--text, #333)', border: '1px solid var(--line, #ddd)', marginTop: 8 }} disabled={busy} onClick={run}>{busy ? t('pos.thinking') : t('pos.regenerate')}</button>
        </>
      )}
      {err ? <div style={{ fontSize: 12.5, color: '#B85B4D', marginTop: 8 }}>{err}</div> : null}
    </div>
  );
}
