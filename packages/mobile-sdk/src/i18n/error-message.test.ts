// error-message.test — V-5 (Oct 27 2026): the Owner / Tech apps word a coded server refusal in Vietnamese from their
// errors.<CODE> catalogue (details.messageCode first, then the answer code); English keeps the server's sentence.
import { describe, it, expect, afterEach } from 'vitest';
import { registerCatalog, setLanguage, resetI18nForTests } from './i18n';
import { localizedErrorMessage } from './error-message';

afterEach(async () => { await setLanguage('en'); resetI18nForTests(); });
describe('localizedErrorMessage', () => {
  it('English → the server sentence; Vietnamese → errors.<messageCode> filled from details, else errors.<code>, else the server sentence', async () => {
    registerCatalog('en', { 'errors.TICKET_NOT_FOUND': 'That ticket could not be found.', 'errors.TIME_OFF_TOO_LONG': 'Time off cannot be more than {max} days in one request.' });
    registerCatalog('vi', { 'errors.TICKET_NOT_FOUND': 'Không tìm thấy hóa đơn này.', 'errors.TIME_OFF_TOO_LONG': 'Mỗi yêu cầu nghỉ phép tối đa {max} ngày.' });
    expect(localizedErrorMessage('BAD_REQUEST', { error: { details: { messageCode: 'TICKET_NOT_FOUND' } } }, 'Ticket not found')).toBe('Ticket not found');
    await setLanguage('vi');
    expect(localizedErrorMessage('not_found', { error: { details: { messageCode: 'TICKET_NOT_FOUND' } } }, 'Ticket not found')).toBe('Không tìm thấy hóa đơn này.');
    expect(localizedErrorMessage('BAD_REQUEST', { details: { messageCode: 'TIME_OFF_TOO_LONG', max: 30 } }, 'Time off cannot exceed 30 days in one request')).toBe('Mỗi yêu cầu nghỉ phép tối đa 30 ngày.');
    expect(localizedErrorMessage('TICKET_NOT_FOUND', {}, 'x')).toBe('Không tìm thấy hóa đơn này.');
    expect(localizedErrorMessage('SOMETHING_NEW', {}, 'Brand new failure.')).toBe('Brand new failure.');
  });
});
