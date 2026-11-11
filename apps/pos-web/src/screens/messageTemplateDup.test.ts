import { describe, it, expect } from 'vitest';
import { similarTemplates } from './messageTemplateDup';
const r = (o: any) => ({ id: 'a', name: 'Reminder', channel: 'sms', status: 'active', bodyPreview: 'Hi {customer_first_name}, see you tomorrow at {appointment_time}!', ...o });
describe('similarTemplates', () => {
  it('flags same-name and near-identical bodies on the same channel only', () => {
    expect(similarTemplates({ name: 'reminder ', channel: 'sms', body: '' }, [r({})])).toEqual([{ id: 'a', name: 'Reminder', reason: 'name' }]);
    expect(similarTemplates({ name: 'New', channel: 'sms', body: 'hi {customer_first_name} see you tomorrow at {appointment_time}' }, [r({})])[0].reason).toBe('body');
    expect(similarTemplates({ name: 'New', channel: 'email', body: 'hi {customer_first_name} see you tomorrow at {appointment_time}' }, [r({})])).toEqual([]);
    expect(similarTemplates({ name: 'New', channel: 'sms', body: 'Your receipt total is ready to view online today' }, [r({})])).toEqual([]);
    expect(similarTemplates({ name: 'Reminder', channel: 'sms', body: '' }, [r({ status: 'archived' })])).toEqual([]);
  });
  it('compares a long template on its 160-char preview prefix', () => {
    const long = 'x'.repeat(10) + ' ' + 'word '.repeat(40);
    expect(similarTemplates({ name: 'N', channel: 'sms', body: long + ' extra tail' }, [r({ bodyPreview: long.slice(0, 160) })]).length).toBe(1);
  });
});
