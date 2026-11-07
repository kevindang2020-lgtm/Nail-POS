// ns/nav.en.ts — the POS "nav" namespace, English (Vietnamese POS mandate, build plan §2 rule 1). Hand-written, SEMANTIC keys
// ('nav.<area>.<item>'); the generated catalog.en.ts is frozen — new POS keys go into a namespace file like this one.
export const NAV_EN = {
  'nav.language.menu': 'Language: {current}',
  'nav.section.team': 'TEAM',
  'nav.language.saveFailed': 'Your language could not be saved. Switched back to {previous}.',
  // Nov 6 2026: the "Turn on notifications" banner (shell/POSLayout.tsx PosPushPrompt)
  'pos.pushPrompt.title': 'Turn on notifications',
  'pos.pushPrompt.reason': 'Get alerts at the front desk for check-ins, ready tickets and payments.',
  'pos.pushPrompt.turnOn': 'Turn on',
  'pos.pushPrompt.notNow': 'Not now',
  'pos.pushPrompt.blocked': 'Notifications are blocked. You can allow them in your browser settings.',
  'pos.pushPrompt.ok': 'OK',
  // Reception Copilot view tabs and pickers (moved out of the frozen catalog, Nov 7 2026 — keys unchanged)
  'pos.copilot_view': 'Copilot view',
  'pos.copilot_view_all': 'All',
  'pos.copilot_view_desk': 'Front desk',
  'pos.copilot_view_actions': 'Actions',
  'pos.copilot_view_history': 'History & search',
  'pos.copilot_view_settings': 'Settings',
  'pos.copilot_pick_technician': 'Technician name',
  'pos.copilot_pick_appointment': 'Customer name, phone or date',
};
