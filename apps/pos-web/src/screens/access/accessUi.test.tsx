// accessUi.test.tsx — the step-up wrapper and the refusal wording used by every Phase 9 access screen.
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { install, sent, stepUpRoute, kit } from './accessTestKit';
import { api } from '../../api/client';
import { accessError, reasonLabel, useStepUp, errorCode, isStepUpCancelled } from './accessUi';

function Probe({ path }: { path: string }) {
  const { run, prompt } = useStepUp();
  const [out, setOut] = useState('');
  return (<div>{prompt}<button onClick={() => run(() => api.post<{ ok: boolean }>(path, {})).then((r) => setOut('ok:' + JSON.stringify(r)), (e) => setOut('err:' + (e?.code ?? e?.message)))}>Go</button><div data-testid="out">{out}</div></div>);
}
beforeEach(() => install({
  'POST /auth/step-up': stepUpRoute(),
  'POST /x/gated': () => (kit.steppedUp ? { body: { ok: true } } : { status: 403, body: { code: 'STEP_UP_REQUIRED', message: 'step up' } }),
  'POST /x/denied': { status: 403, body: { code: 'PERMISSION_DENIED', message: 'nope', reason: 'missing_permission' } },
  'POST /x/always-step': { status: 403, body: { code: 'STEP_UP_REQUIRED' } },
  'POST /x/authenticator': { status: 403, body: { code: 'STEP_UP_REQUIRED' } },
}));

describe('useStepUp', () => {
  it('a route that needs no step-up runs once with no prompt; a plain 403 passes straight through', async () => {
    render(<Probe path="/x/denied" />);
    fireEvent.click(screen.getByText('Go'));
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('err:PERMISSION_DENIED'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sent('POST', '/x/denied').length).toBe(1);
  });
  it('STEP_UP_REQUIRED → prompt → password (+ code when given) → POST /auth/step-up → the action is retried exactly once', async () => {
    render(<Probe path="/x/gated" />);
    fireEvent.click(screen.getByText('Go'));
    const dlg = await screen.findByRole('dialog', { name: "Confirm it's you" });
    expect(within(dlg).getByText('Confirm')).toBeDisabled();   // no password yet
    fireEvent.change(within(dlg).getByLabelText('Your password'), { target: { value: 'right-pw' } });
    fireEvent.change(within(dlg).getByLabelText('Authenticator code'), { target: { value: '123 456' } });
    fireEvent.click(within(dlg).getByText('Confirm'));
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('ok:{"ok":true}'));
    expect(sent('POST', '/auth/step-up')[0].body).toEqual({ password: 'right-pw', code: '123456' });
    expect(sent('POST', '/x/gated').length).toBe(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('a retry that is still refused rejects with that error — never a loop of prompts', async () => {
    render(<Probe path="/x/always-step" />);
    fireEvent.click(screen.getByText('Go'));
    const dlg = await screen.findByRole('dialog');
    fireEvent.change(within(dlg).getByLabelText('Your password'), { target: { value: 'right-pw' } });
    fireEvent.click(within(dlg).getByText('Confirm'));
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('err:STEP_UP_REQUIRED'));
    expect(sent('POST', '/x/always-step').length).toBe(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('Cancel rejects with STEP_UP_CANCELLED (screens show nothing for it) and does not retry', async () => {
    render(<Probe path="/x/gated" />);
    fireEvent.click(screen.getByText('Go'));
    const dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByText('Cancel'));
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('err:STEP_UP_CANCELLED'));
    expect(sent('POST', '/x/gated').length).toBe(1);
    expect(sent('POST', '/auth/step-up').length).toBe(0);
  });
  it('reads the code from every error shape the POS clients throw (api client, posHttp module errors)', () => {
    expect(errorCode({ code: 'STEP_UP_REQUIRED' })).toBe('STEP_UP_REQUIRED');
    expect(errorCode({ details: { code: 'STEP_UP_REQUIRED' } })).toBe('STEP_UP_REQUIRED');
    expect(errorCode({ status: 403, body: { code: 'STEP_UP_REQUIRED' } })).toBe('STEP_UP_REQUIRED');
    expect(errorCode({ status: 403, body: { error: { code: 'STEP_UP_REQUIRED' } } })).toBe('STEP_UP_REQUIRED');
    expect(isStepUpCancelled({ code: 'STEP_UP_CANCELLED' })).toBe(true);
    expect(isStepUpCancelled(new Error('x'))).toBe(false);
  });
  it('a wrong password keeps the prompt open with the server’s message and does not retry', async () => {
    render(<Probe path="/x/gated" />);
    fireEvent.click(screen.getByText('Go'));
    const dlg = await screen.findByRole('dialog');
    fireEvent.change(within(dlg).getByLabelText('Your password'), { target: { value: 'nope' } });
    fireEvent.click(within(dlg).getByText('Confirm'));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('Password is not correct.');
    expect(sent('POST', '/x/gated').length).toBe(1);
  });
});

describe('accessError / reasonLabel', () => {
  it('explains LAST_OWNER, a 409 conflict, a 403 with its reason code, and a cancelled step-up', () => {
    expect(accessError({ status: 409, code: 'LAST_OWNER' })).toMatch(/at least one active owner/);
    expect(accessError({ status: 409, code: 'VERSION_CONFLICT', message: 'Request failed.' })).toMatch(/changed this at the same time/);
    expect(accessError({ status: 403, code: 'PERMISSION_DENIED', message: 'You do not have permission to do that.', details: { reason: 'out_of_branch_scope' } })).toBe('You do not have permission to make this change. (Outside their branches)');
    expect(accessError({ code: 'STEP_UP_CANCELLED' })).toMatch(/cancelled/);
    expect(reasonLabel('granted_temporarily')).toBe('Temporary grant');
    expect(reasonLabel('some_new_code')).toBe('Some new code');   // an unknown code is humanised, never raw
  });
});
