// BUILD_PLAN Phase 12 (#17): the catalog routes' body validation, route by route on the real controllers — the bodies
// pos-web sends today pass intact, unknown fields are stripped, a bad body is a 400 VALIDATION_FAILED naming the field,
// an undeclared tenantId is refused.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { ServicesController as S } from './services/services.controller';
import { ServiceAddOnsController as A } from './service-add-ons/service-add-ons.controller';

const I = '22222222-2222-4222-8222-222222222222';
const c = (route: string, ctl: any, handler: string, today: Record<string, unknown>[], bad: [unknown, string]): RouteBodyCase => ({ route, ctl, handler, today, bad });
const CASES: RouteBodyCase[] = [
  c('POST /pos/services', S, 'create', [{ name: 'Gel manicure', categoryId: I, priceCents: 4500, durationMinutes: 45, status: 'active' }], [{ name: 'Gel', priceCents: 45.5 }, 'priceCents']),
  c('PATCH /pos/services/:serviceId', S, 'update', [{ name: 'Gel manicure', priceCents: 5000, durationMinutes: 50, status: 'inactive', onlineBookingEnabled: true, aiBookingEnabled: false }], [{ durationMinutes: '45' }, 'durationMinutes']),
  c('POST /pos/services/categories', S, 'catCreate', [{ name: 'Pedicure' }, { name: 'Pedicure', colorKey: 'teal' }], [{ name: ['Pedicure'] }, 'name']),
  c('PATCH /pos/services/categories/:categoryId', S, 'catUpdate', [{ name: 'Pedi', colorKey: 'rose', status: 'inactive' }], [{ colorKey: 5 }, 'colorKey']),
  c('POST /pos/services/categories/reorder', S, 'catReorder', [{ order: [I] }], [{ order: I }, 'order']),
  c('POST /pos/services/categories/:categoryId/archive', S, 'catArchive', [{ confirm: true }], [{ confirm: 'yes' }, 'confirm']),
  c('POST /pos/services/import', S, 'import', [{ csv: 'name,price\nGel,45' }], [{ csv: ['x'] }, 'csv']),
  c('POST /pos/services/import/preview', S, 'importPreview', [{ csv: 'name,price\nGel,45' }], [{ csv: { a: 1 } }, 'csv']),
  c('POST /pos/services/import/commit', S, 'importCommit', [{ csv: 'name,price\nGel,45' }], [{ csv: 45 }, 'csv']),
  c('PATCH /pos/services/:serviceId/add-ons', S, 'sAddOns', [{ addOns: [{ addOnId: I, name: 'Chrome', priceCents: 1000, durationDeltaMinutes: 10, isTaxable: true, isActive: true }] }], [{ addOns: [{ priceCents: -1 }] }, 'addOns[0].priceCents']),
  c('PATCH /pos/services/:serviceId/technician-mapping', S, 'sMap', [{ mapping: [{ technicianId: I, displayName: 'Tina', skillLevel: 'senior', isActive: true }] }], [{ mapping: { technicianId: I } }, 'mapping']),
  c('PATCH /pos/services/:serviceId/commission', S, 'sComm', [{ type: 'percent', value: 40, byTechnician: [{ technicianId: I, type: 'percent', value: 50 }] }], [{ type: 'percent', value: -5 }, 'value']),
  c('PATCH /pos/services/:serviceId/tax', S, 'sTax', [{ isTaxable: true, taxCategory: 'service', exemptAllowed: false }], [{ isTaxable: true, overridePercent: 150 }, 'overridePercent']),
  c('POST /pos/service-add-ons', A, 'create', [{ name: 'Chrome', priceCents: 1000, durationDeltaMinutes: 10, isTaxable: true, serviceIds: [I] }], [{ name: 'Chrome', priceCents: '10' }, 'priceCents']),
  c('PATCH /pos/service-add-ons/:addOnId', A, 'update', [{ priceCents: 1200 }, { name: 'Chrome+', serviceIds: [] }], [{ serviceIds: I }, 'serviceIds']),
];

describe('catalog — validated bodies, route by route', () => {
  for (const x of CASES) it(x.route, () => expect(routeBodyFailures(x, bodyPipeOf as any)).toEqual([]));
});
