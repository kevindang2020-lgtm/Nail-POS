// phoneMessagingParts.tsx — shared pieces of the Phone & Messaging Center (POSPhoneScreen) and Text Messaging Setup
// (POSMessagingSetupScreen): the status pill (colour AND words — never colour alone), the safe reason-code text, the
// guided checklist and the diagnostics table. Every string through t() (EN + VI, ns/phonemessaging).
import type { ReactNode } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { fmtDateTime } from '../i18n/format';
import type { MessagingReadiness, TestEvent, CheckEvent, Caps, RegItem } from '../api/posPhoneApi';

export type StatusTone = 'ok' | 'warn' | 'bad' | 'muted';
const TONE: Record<string, StatusTone> = {
  connected: 'ok', assigned: 'ok', approved: 'ok', ready_to_attempt: 'ok', verified: 'ok', ready: 'ok', done: 'ok', delivered: 'ok',
  unknown: 'warn', stale: 'warn', pending: 'warn', degraded: 'warn', configured: 'warn', untested: 'warn', unable_to_verify: 'warn', action: 'warn', checking: 'warn',
  accepted: 'warn', sent: 'warn', sending: 'warn', not_started: 'warn', misconfigured: 'warn',
  invalid: 'bad', not_owned: 'bad', missing: 'bad', rejected: 'bad', suspended: 'bad', blocked: 'bad', failed: 'bad', undelivered: 'bad',
  not_applicable: 'muted', disabled: 'muted', not_configured: 'muted',
  // round 2 (PM-01 test states, OPS-01 config / per-number webhook, API key scope)
  requested: 'warn', limited: 'warn', warning: 'warn', ok: 'ok', matches: 'ok', mismatch: 'bad', not_on_account: 'bad', not_set: 'bad',
};
export const toneOf = (state: string | null | undefined): StatusTone => TONE[String(state ?? '')] ?? 'warn';

/** every state the server can answer — read at render (a getter table, never translated at import) */
const STATE_LABEL: Record<string, () => string> = {
  connected: () => tx('pm.state.connected'), invalid: () => tx('pm.state.invalid'), unknown: () => tx('pm.state.unknown'), stale: () => tx('pm.state.stale'),
  not_configured: () => tx('pm.state.not_configured'), checking: () => tx('pm.state.checking'), assigned: () => tx('pm.state.assigned'), not_owned: () => tx('pm.state.not_owned'),
  missing: () => tx('pm.state.missing'), not_started: () => tx('pm.state.not_started'), pending: () => tx('pm.state.pending'), approved: () => tx('pm.state.approved'),
  rejected: () => tx('pm.state.rejected'), suspended: () => tx('pm.state.suspended'), not_applicable: () => tx('pm.state.not_applicable'), unable_to_verify: () => tx('pm.state.unable_to_verify'),
  ready_to_attempt: () => tx('pm.state.ready_to_attempt'), blocked: () => tx('pm.state.blocked'), degraded: () => tx('pm.state.degraded'), configured: () => tx('pm.state.configured'),
  verified: () => tx('pm.state.verified'), failed: () => tx('pm.state.failed'), untested: () => tx('pm.state.untested'), ready: () => tx('pm.state.ready'), disabled: () => tx('pm.state.disabled'),
  misconfigured: () => tx('pm.state.misconfigured'), done: () => tx('pm.state.done'), action: () => tx('pm.state.action'), sending: () => tx('pm.state.sending'),
  accepted: () => tx('pm.state.accepted'), sent: () => tx('pm.state.sent'), delivered: () => tx('pm.state.delivered'), undelivered: () => tx('pm.state.undelivered'),
  requested: () => tx('pm.state.requested'), limited: () => tx('pm.state.limited'), warning: () => tx('pm.state.warning'), ok: () => tx('pm.state.ok'),
  matches: () => tx('pm.state.matches'), mismatch: () => tx('pm.state.mismatch'), not_on_account: () => tx('pm.state.not_on_account'), not_set: () => tx('pm.state.not_set'),
};
export const stateLabel = (state: string | null | undefined) => (STATE_LABEL[String(state ?? '')]?.() ?? tx('pm.state.unknown'));

const REASON: Record<string, () => string> = {
  USING_PLATFORM_SHARED_ACCOUNT: () => tx('pm.reason.USING_PLATFORM_SHARED_ACCOUNT'), NO_CREDENTIALS: () => tx('pm.reason.NO_CREDENTIALS'),
  NOT_CHECKED_SINCE_CHANGE: () => tx('pm.reason.NOT_CHECKED_SINCE_CHANGE'), NEVER_CHECKED: () => tx('pm.reason.NEVER_CHECKED'), API_KEY_SECRET_MISSING: () => tx('pm.reason.API_KEY_SECRET_MISSING'),
  CHECK_STALE: () => tx('pm.reason.CHECK_STALE'), TWILIO_AUTH_FAILED: () => tx('pm.reason.TWILIO_AUTH_FAILED'), TWILIO_ACCOUNT_NOT_FOUND: () => tx('pm.reason.TWILIO_ACCOUNT_NOT_FOUND'),
  TWILIO_ACCOUNT_SUSPENDED: () => tx('pm.reason.TWILIO_ACCOUNT_SUSPENDED'), TWILIO_ACCOUNT_CLOSED: () => tx('pm.reason.TWILIO_ACCOUNT_SUSPENDED'), TWILIO_WRONG_ACCOUNT: () => tx('pm.reason.TWILIO_WRONG_ACCOUNT'),
  TWILIO_TRIAL_ACCOUNT: () => tx('pm.reason.TWILIO_TRIAL_ACCOUNT'), TWILIO_API_KEY_REJECTED: () => tx('pm.reason.TWILIO_API_KEY_REJECTED'), PROVIDER_UNREACHABLE: () => tx('pm.reason.PROVIDER_UNREACHABLE'),
  PROVIDER_RATE_LIMITED: () => tx('pm.reason.PROVIDER_RATE_LIMITED'), PROVIDER_ERROR: () => tx('pm.reason.PROVIDER_ERROR'), PROVIDER_UNEXPECTED_RESPONSE: () => tx('pm.reason.PROVIDER_ERROR'),
  SECRET_DECRYPT_FAILED: () => tx('pm.reason.SECRET_DECRYPT_FAILED'), ACCOUNT_CHECK_FAILED_FIRST: () => tx('pm.reason.ACCOUNT_CHECK_FAILED_FIRST'),
  VERIFY_ONLY_NO_SENDER: () => tx('pm.reason.VERIFY_ONLY_NO_SENDER'), NO_SENDER_NUMBER: () => tx('pm.reason.NO_SENDER_NUMBER'), MESSAGING_SERVICE_SENDER_POOL: () => tx('pm.reason.MESSAGING_SERVICE_SENDER_POOL'),
  PLATFORM_NUMBER_NOT_CHECKED_HERE: () => tx('pm.reason.PLATFORM_NUMBER_NOT_CHECKED_HERE'), SENDER_NOT_CHECKED: () => tx('pm.reason.SENDER_NOT_CHECKED'), NUMBER_NO_SMS_CAPABILITY: () => tx('pm.reason.NUMBER_NO_SMS_CAPABILITY'),
  TWILIO_NUMBER_NOT_ON_ACCOUNT: () => tx('pm.reason.TWILIO_NUMBER_NOT_ON_ACCOUNT'), SENDER_CHECK_FAILED: () => tx('pm.reason.SENDER_CHECK_FAILED'),
  TOLL_FREE_VERIFICATION_SEPARATE: () => tx('pm.reason.TOLL_FREE_VERIFICATION_SEPARATE'), SHORT_CODE_SEPARATE: () => tx('pm.reason.SHORT_CODE_SEPARATE'), BRAND_REJECTED: () => tx('pm.reason.BRAND_REJECTED'),
  CAMPAIGN_REJECTED: () => tx('pm.reason.CAMPAIGN_REJECTED'), REGISTRATION_FAILED: () => tx('pm.reason.REGISTRATION_FAILED'), CAMPAIGN_SUSPENDED: () => tx('pm.reason.CAMPAIGN_SUSPENDED'),
  BRAND_SUSPENDED: () => tx('pm.reason.BRAND_SUSPENDED'), PROVIDER_STATUS_UNRECOGNISED: () => tx('pm.reason.PROVIDER_STATUS_UNRECOGNISED'), REGISTRATION_NOT_STARTED: () => tx('pm.reason.REGISTRATION_NOT_STARTED'),
  BRAND_PENDING: () => tx('pm.reason.BRAND_PENDING'), CAMPAIGN_PENDING: () => tx('pm.reason.CAMPAIGN_PENDING'), NUMBER_NOT_IN_MESSAGING_SERVICE: () => tx('pm.reason.NUMBER_NOT_IN_MESSAGING_SERVICE'),
  NO_VERIFIED_INBOUND_EVENT: () => tx('pm.reason.NO_VERIFIED_INBOUND_EVENT'), INBOUND_URL_MISMATCH: () => tx('pm.reason.INBOUND_URL_MISMATCH'), INBOUND_URL_NOT_SET: () => tx('pm.reason.INBOUND_URL_NOT_SET'),
  NOT_CHECKED: () => tx('pm.reason.NOT_CHECKED'), PUBLIC_API_BASE_URL_NOT_SET: () => tx('pm.reason.PUBLIC_API_BASE_URL_NOT_SET'), STATUS_CALLBACK_NOT_SET: () => tx('pm.reason.STATUS_CALLBACK_NOT_SET'),
  NO_VERIFIED_STATUS_EVENT: () => tx('pm.reason.NO_VERIFIED_STATUS_EVENT'), ACCOUNT_INVALID: () => tx('pm.reason.TWILIO_AUTH_FAILED'), ACCOUNT_CHECK_STALE: () => tx('pm.reason.CHECK_STALE'),
  ACCOUNT_NOT_CHECKED: () => tx('pm.reason.NEVER_CHECKED'), A2P_NOT_STARTED: () => tx('pm.reason.REGISTRATION_NOT_STARTED'), A2P_PENDING: () => tx('pm.reason.A2P_PENDING'),
  A2P_REJECTED: () => tx('pm.reason.REGISTRATION_FAILED'), A2P_SUSPENDED: () => tx('pm.reason.CAMPAIGN_SUSPENDED'), A2P_UNABLE_TO_VERIFY: () => tx('pm.reason.PROVIDER_STATUS_UNRECOGNISED'),
  TOLL_FREE_VERIFICATION_NOT_TRACKED: () => tx('pm.reason.TOLL_FREE_VERIFICATION_NOT_TRACKED'), DELIVERY_NOT_TRACKED: () => tx('pm.reason.DELIVERY_NOT_TRACKED'),
  PLATFORM_EMERGENCY_OFF: () => tx('pm.reason.PLATFORM_EMERGENCY_OFF'), PLATFORM_MODULE_OFF: () => tx('pm.reason.PLATFORM_MODULE_OFF'), PLATFORM_BLOCKED: () => tx('pm.reason.PLATFORM_BLOCKED'),
  TENANT_DISABLED: () => tx('pm.reason.TENANT_DISABLED'), VERIFY_SERVICE_MISSING: () => tx('pm.reason.VERIFY_SERVICE_MISSING'), VERIFY_TEST_FAILED: () => tx('pm.reason.VERIFY_TEST_FAILED'),
  VERIFY_NOT_TESTED: () => tx('pm.reason.VERIFY_NOT_TESTED'), TWILIO_VERIFY_AUTH_FAILED: () => tx('pm.reason.TWILIO_VERIFY_AUTH_FAILED'), TWILIO_VERIFY_SERVICE_NOT_FOUND: () => tx('pm.reason.TWILIO_VERIFY_SERVICE_NOT_FOUND'),
  TWILIO_VERIFY_SID_INVALID: () => tx('pm.reason.TWILIO_VERIFY_SID_INVALID'), TWILIO_VERIFY_CHECK_FAILED: () => tx('pm.reason.TWILIO_VERIFY_CHECK_FAILED'),
  NO_TEST_YET: () => tx('pm.reason.NO_TEST_YET'), TEST_ACCEPTED: () => tx('pm.reason.TEST_ACCEPTED'), TEST_SENT: () => tx('pm.reason.TEST_ACCEPTED'), TEST_SENDING: () => tx('pm.reason.TEST_ACCEPTED'),
  TRIAL_UNVERIFIED_DESTINATION: () => tx('pm.reason.TRIAL_UNVERIFIED_DESTINATION'), INVALID_DESTINATION: () => tx('pm.reason.INVALID_DESTINATION'), SENDER_NOT_ON_ACCOUNT: () => tx('pm.reason.TWILIO_NUMBER_NOT_ON_ACCOUNT'),
  DESTINATION_OPTED_OUT: () => tx('pm.reason.DESTINATION_OPTED_OUT'), PROVIDER_REJECTED: () => tx('pm.reason.PROVIDER_REJECTED'), A2P_NOT_APPROVED_MAY_BE_FILTERED: () => tx('pm.reason.A2P_NOT_APPROVED_MAY_BE_FILTERED'),
  // round 2 — provider registration sync (PM-03), toll-free (PM-04), configuration + key scope (OPS-01)
  NOT_VERIFIED_WITH_PROVIDER: () => tx('pm.reason.NOT_VERIFIED_WITH_PROVIDER'), PROVIDER_CHECK_STALE: () => tx('pm.reason.PROVIDER_CHECK_STALE'),
  PROVIDER_READ_AUTH: () => tx('pm.reason.PROVIDER_READ_AUTH'), PROVIDER_READ_NOT_FOUND: () => tx('pm.reason.PROVIDER_READ_NOT_FOUND'), PROVIDER_READ_RATE_LIMITED: () => tx('pm.reason.PROVIDER_RATE_LIMITED'),
  PROVIDER_READ_PROVIDER_UNAVAILABLE: () => tx('pm.reason.PROVIDER_READ_UNAVAILABLE'), PROVIDER_READ_NETWORK: () => tx('pm.reason.PROVIDER_READ_UNAVAILABLE'), PROVIDER_READ_UNEXPECTED: () => tx('pm.reason.PROVIDER_ERROR'),
  TOLL_FREE_NOT_CHECKED: () => tx('pm.reason.TOLL_FREE_NOT_CHECKED'), TOLL_FREE_UNABLE_TO_VERIFY: () => tx('pm.reason.TOLL_FREE_NOT_CHECKED'), TOLL_FREE_NOT_STARTED: () => tx('pm.reason.TOLL_FREE_NOT_STARTED'),
  TOLL_FREE_PENDING: () => tx('pm.reason.TOLL_FREE_PENDING'), TOLL_FREE_REJECTED: () => tx('pm.reason.TOLL_FREE_REJECTED'), TOLL_FREE_VERIFICATION_REQUIRED: () => tx('pm.reason.TOLL_FREE_VERIFICATION_REQUIRED'),
  SUBMIT_IN_TWILIO_CONSOLE: () => tx('pm.next.SUBMIT_IN_TWILIO_CONSOLE'), WAIT_FOR_REVIEW: () => tx('pm.next.WAIT_FOR_REVIEW'), EDIT_AND_RESUBMIT_IN_TWILIO_CONSOLE: () => tx('pm.next.EDIT_AND_RESUBMIT_IN_TWILIO_CONSOLE'),
  CONTACT_TWILIO_SUPPORT: () => tx('pm.next.CONTACT_TWILIO_SUPPORT'), REFRESH_STATUS: () => tx('pm.next.REFRESH_STATUS'),
  API_KEY_SCOPE_INSUFFICIENT: () => tx('pm.reason.API_KEY_SCOPE_INSUFFICIENT'), MESSAGING_CONFIG_INVALID: () => tx('pm.reason.MESSAGING_CONFIG_INVALID'),
  URL_NOT_ABSOLUTE: () => tx('pm.reason.URL_NOT_ABSOLUTE'), URL_NOT_HTTPS: () => tx('pm.reason.URL_NOT_HTTPS'), URL_HAS_CREDENTIALS: () => tx('pm.reason.URL_HAS_CREDENTIALS'), URL_HAS_QUERY: () => tx('pm.reason.URL_HAS_QUERY'),
  URL_HOST_NOT_PUBLIC: () => tx('pm.reason.URL_HOST_NOT_PUBLIC'), URL_HOST_IP_LITERAL: () => tx('pm.reason.URL_HOST_NOT_PUBLIC'), BASE_URL_INCLUDES_ROUTE: () => tx('pm.reason.BASE_URL_INCLUDES_ROUTE'),
  STATUS_CALLBACK_ROUTE_MISMATCH: () => tx('pm.reason.STATUS_CALLBACK_ROUTE_MISMATCH'), STATUS_CALLBACK_HOST_DIFFERS: () => tx('pm.reason.STATUS_CALLBACK_HOST_DIFFERS'),
};
/** a safe server reason code → plain words; an unknown code is shown as itself after a generic sentence */
export const reasonText = (code: string | null | undefined): string => {
  if (!code) return '';
  const f = REASON[code];
  if (f) return f();
  return /^TWILIO_[0-9]+$/.test(code) ? tx('pm.reason.twilioErrorCode', { code: code.slice(7) }) : tx('pm.reason.other', { code });
};
/** a stored Verify / test outcome: a code (current) or older plain English (before Oct 30 2026) */
export const outcomeText = (v: string | null | undefined) => (v && /^[A-Z0-9_]+$/.test(v) ? reasonText(v) : String(v ?? ''));

export const when = (iso: string | null | undefined) => (iso ? fmtDateTime(iso) : tx('pm.never'));

export function Pill({ state, testId }: { state: string | null | undefined; testId?: string }) {
  return <span className={'pmc-pill ' + toneOf(state)} data-testid={testId} data-state={state ?? ''}>{stateLabel(state)}</span>;
}

export function CapsLine({ caps }: { caps: Caps | null | undefined }) {
  if (!caps) return <span className="pmc-muted">{tx('pm.caps.unknown')}</span>;
  const chip = (on: boolean, label: string) => <span className={'pmc-cap' + (on ? ' on' : '')}>{label}{' '}{on ? tx('pm.caps.yes') : tx('pm.caps.no')}</span>;
  return <span className="pmc-caps">{chip(caps.sms, tx('pm.caps.sms'))}{chip(caps.voice, tx('pm.caps.voice'))}{chip(caps.mms, tx('pm.caps.mms'))}</span>;
}

const STEP_LABEL: Record<string, () => string> = {
  connect: () => tx('pm.step.connect'), number: () => tx('pm.step.number'), registration: () => tx('pm.step.registration'), webhooks: () => tx('pm.step.webhooks'), test: () => tx('pm.step.test'),
};
export function Checklist({ items, onOpen }: { items: MessagingReadiness['checklist']; onOpen: (link: string) => void }) {
  return (
    <ol className="pmc-steps" data-testid="pm-checklist">
      {items.map((s, i) => (
        <li key={s.key} className={'pmc-step ' + toneOf(s.state)} data-testid={`pm-step-${s.key}`}>
          <span className="pmc-step-n" aria-hidden>{i + 1}</span>
          <div className="pmc-step-main">
            <div className="pmc-step-t">{STEP_LABEL[s.key]?.() ?? s.key} <Pill state={s.state} /></div>
            {s.reasonCode && s.state !== 'done' ? <div className="pmc-step-r">{reasonText(s.reasonCode)}</div> : null}
          </div>
          {s.state !== 'done' && s.state !== 'not_applicable' ? <button type="button" className="fk-btn" onClick={() => onOpen(s.fixLink)}>{tx('pm.fix')}</button> : null}
        </li>
      ))}
    </ol>
  );
}

export function TestRows({ tests, empty }: { tests: TestEvent[]; empty: ReactNode }) {
  if (!tests.length) return <div className="pmc-muted">{empty}</div>;
  return (
    <table className="pmc-table" data-testid="pm-test-rows">
      <thead><tr><th>{tx('pm.col.when')}</th><th>{tx('pm.col.to')}</th><th>{tx('pm.col.status')}</th><th>{tx('pm.col.detail')}</th></tr></thead>
      <tbody>{tests.map((x) => (
        <tr key={x.id}><td>{when(x.createdAt)}</td><td>{x.destinationMasked}{x.accountSidLast4 ? <span className="pmc-r">{tx('pm.account.sidHint', { last4: x.accountSidLast4 })}</span> : null}</td><td><Pill state={x.displayState ?? x.status} /></td>
          <td>{x.status === 'delivered' ? tx('pm.test.deliveredAt', { when: when(x.deliveredAt) }) : x.final ? reasonText(x.errorCode) : tx('pm.test.awaitingCallback')}{x.providerSidLast6 ? ` · …${x.providerSidLast6}` : ''}</td></tr>
      ))}</tbody>
    </table>
  );
}

export function CheckRows({ checks }: { checks: CheckEvent[] }) {
  if (!checks.length) return <div className="pmc-muted">{tx('pm.diag.noChecks')}</div>;
  return (
    <table className="pmc-table" data-testid="pm-check-rows">
      <thead><tr><th>{tx('pm.col.when')}</th><th>{tx('pm.col.kind')}</th><th>{tx('pm.col.account')}</th><th>{tx('pm.col.number')}</th><th>{tx('pm.col.verify')}</th><th>{tx('pm.col.detail')}</th></tr></thead>
      <tbody>{checks.map((c) => (
        <tr key={c.id}>
          <td>{when(c.checkedAt)}{c.current ? '' : ` · ${tx('pm.diag.olderConfig')}`}</td>
          <td>{c.trigger === 'save' ? tx('pm.diag.onSave') : tx('pm.diag.manual')}</td>
          <td><Pill state={c.accountState === 'unreachable' || c.accountState === 'error' ? 'unknown' : c.accountState} /></td>
          <td>{c.senderState ? <Pill state={c.senderState} /> : '—'}</td>
          <td>{c.verifyState === 'ok' ? <Pill state="verified" /> : c.verifyState === 'failed' ? <Pill state="failed" /> : '—'}</td>
          <td>{[c.reasonCode ? reasonText(c.reasonCode) : '', c.durationMs != null ? `${c.durationMs} ms` : ''].filter(Boolean).join(' · ')}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

/**
 * One carrier-registration item (PM-03): the state, whether TWILIO confirmed it (never assumed from a submission), the
 * provider's status word, when it was last read — and after a failed read, the last successful one.
 */
export function RegRow({ label, item, testId }: { label: string; item: RegItem | null | undefined; testId?: string }) {
  if (!item) return null;
  return (<>
    <dt>{label}</dt>
    <dd data-testid={testId}>
      <Pill state={item.state} />
      <span className={'pmc-r ' + (item.verified ? 'pmc-ok' : 'pmc-muted')} data-testid={testId ? `${testId}-verified` : undefined}>{item.verified ? tx('pm.reg.confirmed') : tx('pm.reg.notConfirmed')}</span>
      {item.providerStatus ? <span className="pmc-r">{item.providerStatus}</span> : null}
      <span className="pmc-r">{tx('pm.checked', { when: when(item.checkedAt) })}</span>
      {item.errorClass ? <span className="pmc-r">{tx('pm.reg.lastSuccess', { when: when(item.lastSuccessAt) })}{item.retryCount ? ` · ${tx('pm.reg.retry', { n: String(item.retryCount), when: when(item.nextRetryAt) })}` : ''}</span> : null}
      {item.reasonCode && item.state !== 'approved' ? <div className="pmc-step-r">{reasonText(item.reasonCode)}</div> : null}
    </dd>
  </>);
}

/** "/tenant/communications/messaging-setup#credentials" → the router path + the section to scroll to */
export function splitLink(link: string): { path: string; hash: string } {
  const i = link.indexOf('#');
  return i < 0 ? { path: link, hash: '' } : { path: link.slice(0, i), hash: link.slice(i + 1) };
}
