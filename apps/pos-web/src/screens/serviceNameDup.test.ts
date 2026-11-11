import { describe, it, expect } from 'vitest';
import { similarServices } from './serviceNameDup';
const items = [{ serviceId: 's1', serviceName: 'Gel Manicure', categoryName: 'Nails' }, { serviceId: 's2', serviceName: 'Spa Pedicure' }];
describe('similarServices', () => {
  it('flags same words, case/accents/punctuation and one- or two-letter typos', () => {
    expect(similarServices('gel manicure', items).map((x) => x.serviceId)).toEqual(['s1']);
    expect(similarServices('Manicure - Gel', items).map((x) => x.serviceId)).toEqual(['s1']);
    expect(similarServices('Gel Manicur', items).map((x) => x.serviceId)).toEqual(['s1']);
    expect(similarServices('Gél Mänicure!', items).map((x) => x.serviceId)).toEqual(['s1']);
  });
  it('ignores different services, very short names and the service being edited', () => {
    expect(similarServices('Acrylic Full Set', items)).toEqual([]);
    expect(similarServices('Ge', items)).toEqual([]);
    expect(similarServices('Gel Manicure', items, 's1')).toEqual([]);
  });
});
