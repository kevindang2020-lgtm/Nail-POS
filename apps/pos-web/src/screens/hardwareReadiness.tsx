// hardwareReadiness.tsx — extras Device Assignments 08 "SUNMI Hardware Readiness Checklist": OS / browser / touch / agent /
// reconnect / peripheral evidence for THIS register, measured live in this browser (shell/displayProfile measureDisplay,
// the realtime client's own status, navigator facts). No fabricated provider or driver support: what the browser cannot
// report says "not reported", and peripherals point to their own device rows (the app installs no driver and no local
// agent — card terminals are network devices the payment path pairs; receipt printing was removed by Kevin's decision).
// Read only: it measures, it changes nothing and sends nothing.
import { useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { measureDisplay, densityFor, type PosDisplayProfile } from '../shell/displayProfile';
import { realtimeStatus } from '../realtime/realtime-client';
import { FitDialog } from '../components/FitKit';

export type HwState = 'ok' | 'warn' | 'info' | 'not_reported';
/** value = measured numbers / names only; code = a fixed code the dialog shows through its label (dfx.hw.c.<code>) */
export interface HwCheck { id: 'screen' | 'viewport' | 'touch' | 'browser' | 'os' | 'mode' | 'network' | 'reconnect' | 'agent' | 'peripherals'; state: HwState; value: string; code?: string }
export interface HwEnv { userAgent: string; brands: string[] | null; platform: string | null; online: boolean; realtime: string }

const browserOf = (env: HwEnv): { name: string; chromium: boolean } => {
  const brand = (env.brands ?? []).find((b) => !/not.?a.?brand/i.test(b) && b !== 'Chromium') ?? (env.brands ?? []).find((b) => b === 'Chromium');
  if (brand) return { name: brand, chromium: (env.brands ?? []).includes('Chromium') };
  const ua = env.userAgent;
  if (/Edg\//.test(ua)) return { name: 'Microsoft Edge', chromium: true };
  if (/Chrome\//.test(ua)) return { name: 'Chrome', chromium: true };
  if (/Firefox\//.test(ua)) return { name: 'Firefox', chromium: false };
  if (/Safari\//.test(ua)) return { name: 'Safari', chromium: false };
  return { name: '', chromium: false };
};
/** the OS: the browser's own platform text when it gives one, else a code read from the user agent (label dfx.hw.c.os.<code>) */
const OS_CODES: ReadonlyArray<readonly [RegExp, string]> = [[/Android/, 'android'], [/Windows/, 'windows'], [/Mac OS X/, 'macos'], [/Linux/, 'linux']];
const osOf = (env: HwEnv): { value: string; code?: string } => {
  if (env.platform) return { value: env.platform };
  const hit = OS_CODES.find(([re]) => re.test(env.userAgent));
  return hit ? { value: '', code: `os.${hit[1]}` } : { value: '' };
};

/** Pure: the checklist from one display measurement and the browser's own facts. The certified family is the shell's own
 *  density rule (compact / comfortable = the SUNMI FLEX 3 27″ and larger); the certified browser is Chrome (the harness). */
export function hardwareReadiness(p: Pick<PosDisplayProfile, 'innerW' | 'innerH' | 'screenW' | 'screenH' | 'dpr' | 'touch' | 'displayMode'>, env: HwEnv): HwCheck[] {
  const screenDensity = densityFor(p.screenW, p.screenH), viewDensity = densityFor(p.innerW, p.innerH);
  const b = browserOf(env), os = osOf(env);
  return [
    { id: 'screen', state: screenDensity === 'compact' || screenDensity === 'comfortable' ? 'ok' : 'warn', value: `${p.screenW}×${p.screenH} @${p.dpr}x` },
    { id: 'viewport', state: viewDensity === 'compact' || viewDensity === 'comfortable' ? 'ok' : 'warn', value: `${p.innerW}×${p.innerH}`, code: `density.${viewDensity}` },
    { id: 'touch', state: p.touch ? 'ok' : 'warn', value: '' },
    { id: 'browser', state: !b.name ? 'not_reported' : b.chromium ? 'ok' : 'warn', value: b.name },
    { id: 'os', state: os.value || os.code ? 'info' : 'not_reported', ...os },
    { id: 'mode', state: 'info', value: '', code: `mode.${p.displayMode}` },
    { id: 'network', state: env.online ? 'ok' : 'warn', value: '' },
    { id: 'reconnect', state: env.realtime === 'CONNECTED' ? 'ok' : 'warn', value: '', code: `rt.${env.realtime}` },
    { id: 'agent', state: 'not_reported', value: '' },
    { id: 'peripherals', state: 'not_reported', value: '' },
  ];
}

export function readHwEnv(): HwEnv {
  const nav = window.navigator as Navigator & { userAgentData?: { brands?: { brand: string }[]; platform?: string } };
  return { userAgent: nav.userAgent || '', brands: nav.userAgentData?.brands ? nav.userAgentData.brands.map((x) => x.brand) : null, platform: nav.userAgentData?.platform || null,
    online: nav.onLine !== false, realtime: realtimeStatus() };
}

const TONE: Record<HwState, string> = { ok: 'ok', warn: 'warn', info: '', not_reported: '' };

export function HardwareReadinessDialog({ onClose }: { onClose: () => void }) {
  const [at, setAt] = useState(() => Date.now());
  const checks = hardwareReadiness(measureDisplay(), readHwEnv());
  return (
    <FitDialog testId="dfx-hw" title={tx('dfx.hw.title')} subtitle={tx('dfx.hw.sub')} onClose={onClose} footer={<>
      <button className="btn ghost" data-testid="dfx-hw-again" onClick={() => setAt(Date.now())}>{tx('dfx.hw.again')}</button>
      <button className="btn" onClick={onClose}>{tx('pos.close')}</button></>}>
      <dl className="ahx-dl" data-at={at}>
        {checks.map((c) => (
          <div key={c.id} style={{ display: 'contents' }} data-testid={`dfx-hw-${c.id}`} data-state={c.state}>
            <dt>{tx(`dfx.hw.k.${c.id}`)}</dt>
            <dd><span className={'chip ' + TONE[c.state]}>{tx(`dfx.hw.s.${c.state}`)}</span> {c.value ? <span>{c.value}</span> : null}{c.code ? <span> {tx(`dfx.hw.c.${c.code}`)}</span> : null}
              <div className="sub">{tx(`dfx.hw.d.${c.id}.${c.state}`)}</div></dd>
          </div>
        ))}
      </dl>
    </FitDialog>
  );
}
