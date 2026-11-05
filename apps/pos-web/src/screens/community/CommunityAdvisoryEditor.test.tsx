// CommunityAdvisoryEditor.test.tsx — BUILD_PLAN Phase 8: /community/new + /community/drafts/:id — rules first, draft
// create (every field), privacy-scan result, wording suggestions, submit (→ manager approval / moderation), withdraw,
// edit of a published post (PUT /community/posts/:id), from-incident start, 409 reload, AI help 503.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { B, err, installFetch, myPost, scanSummary, sent, settings, type Route as R } from './communityTestKit';

const perms = { deny: new Set<string>() };
vi.mock('../../components/usePermissions', () => ({ useCan: () => (p: string) => !perms.deny.has(p) }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ principal: { role: 'RECEPTION', userId: 'u1' } }) }));
import { CommunityAdvisoryEditor } from './CommunityAdvisoryEditor';

let routes: Record<string, R>;
const defaults = (): Record<string, R> => ({
  [`GET ${B}/settings`]: { body: settings() },
  [`POST ${B}/rules/acknowledge`]: (c) => ({ body: { acknowledged: true, rulesVersion: c.body.rulesVersion } }),
  [`POST ${B}/advisories`]: (c) => ({ body: myPost({ id: 'd1', ...c.body, body: 'Caller from [phone removed] asked for the code', privacyScanFlags: ['phone'], version: 1 }) }),
  [`GET ${B}/mine/d1`]: { body: myPost({ id: 'd1', version: 1 }) },
  [`PUT ${B}/advisories/d1`]: (c) => ({ body: { post: myPost({ id: 'd1', title: c.body.title, version: 2 }), scan: scanSummary(), wording: null } }),
  [`POST ${B}/advisories/d1/submit`]: () => ({ body: { post: myPost({ id: 'd1', status: 'manager_approval', version: 3 }), scan: scanSummary(), wording: null } }),
  [`POST ${B}/advisories/d1/withdraw`]: { body: myPost({ id: 'd1', status: 'incident_draft', version: 4 }) },
  [`POST ${B}/advisories/assist`]: err(503, 'ai_not_configured'),
  [`GET ${B}/incidents/i9`]: { body: { id: 'i9', branchId: null, category: 'gift_card_scam', severity: 'high', occurredOn: '2026-10-05', rawDetail: 'private', advisoryPostId: null, createdAt: '' } },
});
const renderAt = (url: string) => render(<MemoryRouter initialEntries={[url]}><Routes><Route path="/community/new" element={<CommunityAdvisoryEditor />} /><Route path="/community/drafts/:id" element={<CommunityAdvisoryEditor />} /></Routes></MemoryRouter>);
const fill = () => {
  fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'account_takeover_attempt' } });
  fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'high' } });
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Caller asked for our login code' } });
  fireEvent.change(screen.getByLabelText('What happened'), { target: { value: 'A caller from 555-123-4567 said he was our processor and asked for the code.' } });
};
beforeEach(() => { perms.deny = new Set(); routes = defaults(); installFetch(routes); });

describe('advisory editor', () => {
  it('rules are shown before the first draft when not yet accepted', async () => {
    routes[`GET ${B}/settings`] = { body: settings({ rulesAcknowledgedByMe: false, rulesVersion: 'v-next' }) };
    renderAt('/community/new');
    const dlg = await screen.findByRole('dialog', { name: 'Safety Community rules' });
    expect(dlg.textContent).toContain('never who did it');
    fireEvent.click(within(dlg).getByRole('button', { name: 'I agree to the community rules' }));
    await waitFor(() => expect(sent('POST', `${B}/rules/acknowledge`)[0]?.body).toEqual({ rulesVersion: 'v-next' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('Submit advisory creates the draft with every field, then submits with its version → "sent to a manager"', async () => {
    renderAt('/community/new');
    await screen.findByLabelText('Title');
    fill();
    fireEvent.click(screen.getByLabelText('Phone call'));
    fireEvent.change(screen.getByLabelText(/What helped/), { target: { value: 'Never read a code to a caller.' } });
    fireEvent.change(screen.getByLabelText(/Tags/), { target: { value: 'processor, code ' } });
    fireEvent.change(screen.getByLabelText(/Amount involved/), { target: { value: '200_500' } });
    fireEvent.change(screen.getByLabelText(/Region/), { target: { value: 'NJ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit advisory' }));
    expect(await screen.findByTestId('community-submit-result')).toHaveTextContent('Sent to a manager for approval.');
    expect(sent('POST', `${B}/advisories`)[0].body).toEqual({
      category: 'account_takeover_attempt', severity: 'high', title: 'Caller asked for our login code',
      body: 'A caller from 555-123-4567 said he was our processor and asked for the code.', region: 'NJ', incidentDate: null, scamMethod: null,
      channels: ['phone'], recommendation: 'Never read a code to a caller.', tags: ['processor', 'code'], paymentProcessor: null, amountRange: '200_500',
      officialReference: null, authorDisplay: null, fromIncidentId: null,
    });
    expect(sent('POST', `${B}/advisories/d1/submit`)[0].body).toEqual({ expectedVersion: 1 });
    expect(screen.getByTestId('community-status')).toHaveTextContent('Waiting for manager approval');
    expect(screen.getByTestId('community-scan')).toHaveTextContent(/Hidden before sharing: phone/i);
    expect(screen.getByTestId('community-redacted-preview')).toHaveTextContent('[phone removed]');
    // withdraw back to a draft
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw to draft' }));
    await waitFor(() => expect(sent('POST', `${B}/advisories/d1/withdraw`)[0]?.body).toEqual({ expectedVersion: 3 }));
  });
  it('validation stops an empty draft before any request', async () => {
    renderAt('/community/new');
    fireEvent.click(await screen.findByRole('button', { name: 'Save draft' }));
    expect(await screen.findByTestId('community-editor-error')).toHaveTextContent('Choose a category.');
    expect(sent('POST', `${B}/advisories`).length).toBe(0);
  });
  it('accusatory wording: the server suggestions are shown', async () => {
    routes[`POST ${B}/advisories`] = err(400, 'wording_requires_rewrite', { matched: 'scammer', suggestions: ['suspected scam attempt', 'under review'] });
    renderAt('/community/new');
    await screen.findByLabelText('Title');
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByTestId('community-wording')).toHaveTextContent('“scammer” sounds like an accusation');
    expect(screen.getByText('suspected scam attempt')).toBeTruthy();
  });
  it('an existing draft: Save sends expectedVersion; a 409 reloads it; posting restriction in words', async () => {
    renderAt('/community/drafts/d1');
    const title = await screen.findByLabelText('Title');
    await waitFor(() => expect((title as HTMLInputElement).value).toBe('Caller asked for the processor login code'));
    fireEvent.change(title, { target: { value: 'Caller asked for the login code' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(sent('PUT', `${B}/advisories/d1`)[0]?.body).toMatchObject({ title: 'Caller asked for the login code', expectedVersion: 1 }));
    routes[`PUT ${B}/advisories/d1`] = err(409, 'version_conflict');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Changed again here' } });
    const n = sent('GET', `${B}/mine/d1`).length;
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByTestId('community-editor-error')).toHaveTextContent('Someone else changed this');
    expect(sent('GET', `${B}/mine/d1`).length).toBe(n + 1);
    routes[`PUT ${B}/advisories/d1`] = err(403, 'community_posting_restricted');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Changed a third time' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(screen.getByTestId('community-editor-error')).toHaveTextContent('paused posting for your salon'));
  });
  it('a returned draft shows the reviewer note; a published post saves through PUT /community/posts/:id with a change note', async () => {
    routes[`GET ${B}/mine/d1`] = { body: myPost({ id: 'd1', status: 'returned_for_correction', returnReason: 'Remove the street name.', version: 5 }) };
    const { unmount } = renderAt('/community/drafts/d1');
    expect(await screen.findByTestId('community-return-reason')).toHaveTextContent('Remove the street name.');
    unmount();
    routes[`GET ${B}/mine/d1`] = { body: myPost({ id: 'd1', status: 'published_unverified', version: 7 }) };
    routes[`PUT ${B}/posts/d1`] = (c) => ({ body: { post: myPost({ id: 'd1', status: 'published_unverified', title: c.body.title, version: 8 }), scan: scanSummary({ categories: [] }), wording: null } });
    renderAt('/community/drafts/d1');
    await screen.findByRole('heading', { name: 'Edit published advisory' });
    await waitFor(() => expect((screen.getByLabelText('Title') as HTMLInputElement).value).not.toBe(''));
    expect(screen.queryByRole('button', { name: 'Submit advisory' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Caller asked for the login code (updated)' } });
    fireEvent.change(screen.getByLabelText(/What changed/), { target: { value: 'clarified title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(sent('PUT', `${B}/posts/d1`)[0]?.body).toMatchObject({ expectedVersion: 7, changeNote: 'clarified title', title: 'Caller asked for the login code (updated)' }));
    expect(sent('PUT', `${B}/advisories/d1`).length).toBe(0);
  });
  it('a moderation-bound post that is in review is read-only', async () => {
    routes[`GET ${B}/mine/d1`] = { body: myPost({ id: 'd1', status: 'moderation_review' }) };
    renderAt('/community/drafts/d1');
    expect(await screen.findByText(/cannot be edited while it is moderation review/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
    expect(screen.getByLabelText('Title')).toBeDisabled();
  });
  it('from a private incident: category / severity / date prefilled, fromIncidentId sent', async () => {
    renderAt('/community/new?fromIncident=i9');
    expect(await screen.findByTestId('community-from-incident')).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText('Category') as HTMLSelectElement).value).toBe('gift_card_scam'));
    expect((screen.getByLabelText('Severity') as HTMLSelectElement).value).toBe('high');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Gift card balance check scam' } });
    fireEvent.change(screen.getByLabelText('What happened'), { target: { value: 'Someone asked us to read gift card numbers over the phone.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(sent('POST', `${B}/advisories`)[0]?.body).toMatchObject({ fromIncidentId: 'i9', incidentDate: '2026-10-05', category: 'gift_card_scam' }));
  });
  it('AI wording help not configured → plain message', async () => {
    renderAt('/community/new');
    await screen.findByLabelText('Title');
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Suggest neutral wording' }));
    expect(await screen.findByTestId('community-editor-error')).toHaveTextContent('Writing help is not available right now');
  });
  it('anonymous is offered only when the salon allows it', async () => {
    renderAt('/community/new');
    await screen.findByLabelText('Title');
    expect(screen.queryByRole('option', { name: /Anonymous/ })).toBeNull();
  });
});
