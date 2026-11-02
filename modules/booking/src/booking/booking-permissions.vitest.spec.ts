// booking-permissions.vitest.spec.ts — GET /pos/booking/permissions answers from the SAME checks the server enforces.
// Before Oct 6 2026 it compared roles in lowercase and looked for pos.* keys sessions never carry: every flag was false
// for every user, owners included, so the New Booking / Walk-In screens never offered "Edit price" to anyone.
import { describe, it, expect } from 'vitest';
import { permissionsFor } from '@aipowersalon/permissions';
import { BookingController } from './booking.controller';

const ctl = new BookingController({} as any);
const ask = (role: string) => ctl.permissions({ ctx: { tenantId: 't', branchId: 'b', userId: 'u', role, permissions: [...permissionsFor(role as any)] } });

describe('booking permissions flags', () => {
  it('owner and manager may override prices and edit the catalog (Functional Decision: manager + reason)', () => {
    for (const role of ['OWNER', 'MANAGER']) expect(ask(role)).toMatchObject({ canOverridePrice: true, canEditCatalog: true, canManageAddOns: true, role });
  });
  it('front desk, reception and technicians may not', () => {
    for (const role of ['FRONT_DESK', 'RECEPTION', 'TECHNICIAN']) expect(ask(role)).toMatchObject({ canOverridePrice: false, canEditCatalog: false, canManageAddOns: false });
  });
});
