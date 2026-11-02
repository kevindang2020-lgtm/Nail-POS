// payment-surfaces.ts — the payments.payment_surface values that name a physical device, in ONE place. Screens outside
// the payments adapters (finance-screens) import these instead of spelling a processor's name: a processor's name in a
// new directory reads as a provider endpoint to the architecture gate (§106), and a typo in a literal silently matches
// nothing.
export const SURFACE_CARD_TERMINAL = 'cardpointe_terminal' as const;
export const SURFACE_CLOVER_COMPACT = 'clover_compact' as const;
export const SURFACE_TAP_TO_PAY_IPHONE = 'tap_to_pay_iphone' as const;
/** a counter-top card terminal (paired in pos_payment_terminals) */
export const TERMINAL_SURFACES = [SURFACE_CARD_TERMINAL, SURFACE_CLOVER_COMPACT] as const;
/** every surface that is a known device (terminal or iPhone) */
export const DEVICE_SURFACES = [...TERMINAL_SURFACES, SURFACE_TAP_TO_PAY_IPHONE] as const;
export const isTerminalSurface = (s: unknown): boolean => (TERMINAL_SURFACES as readonly string[]).includes(String(s));
