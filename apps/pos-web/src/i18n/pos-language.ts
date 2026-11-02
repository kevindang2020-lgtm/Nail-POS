// pos-language.ts — how the POS picks, switches and saves the language (Vietnamese POS mandate §6–§8, §13–§15, §89; WP-B).
//
// Resolution (§8): user.preferred_language ?? salon default (Settings → Business) ?? 'en'. The server resolves the first
// two in GET pos/me/locale; this module only adds the English fallback. There is NO browser-language and NO device-choice
// layer for the POS (the four mobile apps keep theirs in initLanguage). The only local copy is the LAST SERVER ANSWER for
// this person (per user id), used when that request cannot reach the server (offline start, §89) — never a device pick.
//
// Switching (§6/§7/§11): optimistic — the screen changes at once (setLanguage → every subscribed root re-renders in place,
// nothing reloads or remounts), then PUT pos/me/language saves it on the person's login row. If the SERVER refuses the
// save the switch is rolled back and the caller shows why; if the request never reached the server (offline) the choice
// is kept for this session and re-sent when the connection returns (§89: switching never needs the network).
import { getLanguage, setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { isAppLanguage, type AppLanguage } from '@aipowersalon/api-contracts';

export const POS_FALLBACK_LANGUAGE: AppLanguage = 'en';
const CACHE_PREFIX = 'aps.pos.language.v1:';

/** §8: the server's answer (user ?? salon default) or English. */
export function resolvePosLanguage(answer: { language?: unknown } | null | undefined): AppLanguage {
  const v = answer?.language;
  return isAppLanguage(v) ? v : POS_FALLBACK_LANGUAGE;
}

function readCache(userId: string): AppLanguage | null {
  try { const v = localStorage.getItem(CACHE_PREFIX + userId); return isAppLanguage(v) ? v : null; } catch { return null; }
}
function writeCache(userId: string, l: AppLanguage): void { try { localStorage.setItem(CACHE_PREFIX + userId, l); } catch { /* private mode */ } }

// every user switch bumps this; a server answer that arrives after a switch never overrides the person's tap,
// and a failed save only rolls back if it is still the latest switch
let switchSeq = 0;

/** After sign-in: apply the server's answer. Never throws; never reloads. */
export async function loadPosLanguage(userId: string, get: () => Promise<{ language?: unknown } | null | undefined>): Promise<AppLanguage> {
  const seq = switchSeq;
  let lang: AppLanguage;
  try { lang = resolvePosLanguage(await get()); writeCache(userId, lang); }
  catch { lang = readCache(userId) ?? POS_FALLBACK_LANGUAGE; }
  if (seq !== switchSeq) return getLanguage();
  await setLanguage(lang);
  return lang;
}

/** Signed out (login screen, accept-invite, password recovery): there is no user and no salon → English. */
export function resetPosLanguage(): void { if (getLanguage() !== POS_FALLBACK_LANGUAGE) void setLanguage(POS_FALLBACK_LANGUAGE); }

export type SwitchResult = { ok: true; pending?: boolean } | { ok: false; previous: AppLanguage; error: unknown };

/** The request never reached the server (no HTTP status) — offline, DNS, a dropped connection. */
function isNetworkFailure(e: unknown): boolean {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status !== 'number' || status === 0;
}

let retryArmed = false;
function retryWhenOnline(userId: string | null | undefined, put: (l: AppLanguage) => Promise<unknown>): void {
  if (retryArmed || typeof window === 'undefined') return;
  retryArmed = true;
  const again = () => {
    window.removeEventListener('online', again);
    retryArmed = false;
    const l = getLanguage();
    void put(l).then(() => { if (userId) writeCache(userId, l); }, () => { /* the next sign-in resolves it */ });
  };
  window.addEventListener('online', again);
}

/** The topbar switch: change now, save, roll back if the server refuses. */
export async function switchPosLanguage(next: AppLanguage, o: { userId?: string | null; put: (l: AppLanguage) => Promise<unknown> }): Promise<SwitchResult> {
  if (!isAppLanguage(next)) return { ok: true };
  const previous = getLanguage();
  if (next === previous) return { ok: true };
  const seq = ++switchSeq;
  await setLanguage(next);                        // optimistic: the screen is already in the new language
  try {
    await o.put(next);
    if (o.userId) writeCache(o.userId, next);
    return { ok: true };
  } catch (error) {
    if (isNetworkFailure(error)) {               // offline: keep it, save it when the connection returns
      if (o.userId) writeCache(o.userId, next);
      retryWhenOnline(o.userId, o.put);
      return { ok: true, pending: true };
    }
    if (seq === switchSeq && getLanguage() === next) await setLanguage(previous);   // the server refused → roll back
    return { ok: false, previous, error };
  }
}

export function resetPosLanguageForTests(): void { switchSeq = 0; retryArmed = false; }
