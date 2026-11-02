// coded-text.ts — Vietnamese POS mandate §21 / §120 (Oct 27 2026): text a SERVER writes for staff to read ("why this
// place", a turn-history line, an AI alert reason, a Money Protection explanation) travels as a stable CODE + VARIABLES
// next to the existing English sentence. The POS renders the code in the cashier's language (key `srv.<code>` in
// apps/pos-web/src/i18n/ns/srv.*.ts) and falls back to the English sentence for a code it does not know — so a new server
// code never shows blank or a raw key, and older clients keep reading the English field. Additive and backward compatible.
//
// Rules: `code` is UPPER_SNAKE or dotted ("TURN_BASIS.LOWEST_TURNS"); `vars` hold already-formatted, language-neutral
// values (numbers, names, dates as YYYY-MM-DD, turn counts as "1.50") — never English words. A var whose value starts
// with "@" is a REFERENCE to another catalogue key ("@status.turnReason.ON_BREAK", "@srv.TURN_BASIS.ROTATION"): the POS
// words that key (with the same vars) and puts the words in — so a reason / kind / nested sentence is translated too.
// "@key#p0" words the key with the vars named "p0_<name>" (prefix stripped) — several nested sentences in one line. Free prose an LLM wrote is NOT
// coded text (it cannot be keyed); see docs/i18n/VIETNAMESE_POS_ENGINEERING_REPORT.md "AI prose".
export type CodedTextVars = Record<string, string | number | null | undefined>;
export interface CodedText { code: string; vars?: CodedTextVars }

/** build a CodedText, dropping empty vars (keeps payloads small and placeholders exact) */
export function coded(code: string, vars?: CodedTextVars): CodedText {
  if (!vars) return { code };
  const v: CodedTextVars = {};
  for (const [k, x] of Object.entries(vars)) if (x !== undefined && x !== null && x !== '') v[k] = x;
  return Object.keys(v).length ? { code, vars: v } : { code };
}

/** a var value that the POS resolves as another catalogue key (see the header) */
export const codedRef = (key: string): string => '@' + key;
