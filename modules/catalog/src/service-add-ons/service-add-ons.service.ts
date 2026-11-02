// service-add-ons.service.ts — composes ServicesService to produce a catalog-wide add-ons view. Reuses the
// services module's getState (service list) + getAddOns (per service); no repo changes, no new table.
import { buildAddOnCatalog, buildAddOnSummary, type ServiceAddOnsContext, type ServiceAddOnsState, type ServiceLite, type AddOnLite, type CreateAddOnRequest, type UpdateAddOnRequest } from './service-add-ons.dto';
import type { ServicesService } from '../services/services.service';
import * as crypto from 'crypto';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export class ServiceAddOnsForbiddenError extends Error {}
export class ServiceAddOnsValidationError extends Error {}

export class ServiceAddOnsService {
  constructor(private readonly services: ServicesService) {}

  async getState(ctx: ServiceAddOnsContext): Promise<ServiceAddOnsState> {
    if (!ctx?.userId || !ctx?.tenantId) throw new ServiceAddOnsForbiddenError('Not authenticated');
    const state = await this.services.getState(ctx as any);
    const items = (state?.services?.items || []);
    const services: ServiceLite[] = items.map((s) => ({ serviceId: s.serviceId, name: s.serviceName, categoryName: s.categoryName }));
    const addOnsByService: Record<string, AddOnLite[]> = {};
    await Promise.all(services.map(async (s) => {
      const a = await this.services.getAddOns(ctx as any, s.serviceId);
      if (a && a.length) addOnsByService[s.serviceId] = a as AddOnLite[];
    }));
    const catalog = buildAddOnCatalog(services, addOnsByService);
    return { kpis: buildAddOnSummary(catalog), addOns: catalog };
  }

  async create(ctx: ServiceAddOnsContext, req: CreateAddOnRequest) {
    if (!ctx?.userId || !ctx?.tenantId) throw new ServiceAddOnsForbiddenError('Not authenticated');
    if (!req.name || !req.name.trim()) throw withCode(new ServiceAddOnsValidationError('Name is required'), 'NAME_REQUIRED');
    const state = await this.services.getState(ctx as any);
    const items = (state?.services?.items || []);
    // Oct 30 2026 (Add-Ons guide: "do not attach every Add-On to every service by default"): an add-on saved without a
    // service list used to be attached to EVERY service in the salon — the photo's French tips on Haircut / Hair Coloring.
    // The services are now chosen explicitly; an empty list is refused.
    if (!req.serviceIds || req.serviceIds.length === 0) throw withCode(new ServiceAddOnsValidationError('Choose the services this add-on can be added to.'), 'ADD_ON_SERVICES_REQUIRED');
    const known = new Set(items.map((s) => s.serviceId));
    const targetServiceIds = req.serviceIds.filter((id) => known.has(id));
    if (!targetServiceIds.length) throw withCode(new ServiceAddOnsValidationError('Choose the services this add-on can be added to.'), 'ADD_ON_SERVICES_REQUIRED');
    
    const addOnId = 'ao_' + crypto.randomUUID().replace(/-/g, '').substring(0, 12);
    
    await Promise.all(targetServiceIds.map(async (serviceId) => {
      const current = (await this.services.getAddOns(ctx as any, serviceId)) || [];
      const newAddOn = {
        addOnId,
        name: req.name.trim(),
        priceCents: req.priceCents || 0,
        durationDeltaMinutes: req.durationDeltaMinutes || 0,
        isTaxable: req.isTaxable || false,
        isActive: true,
      };
      await this.services.setAddOns(ctx as any, serviceId, [...current, newAddOn]);
    }));
    return { addOnId };
  }

  async update(ctx: ServiceAddOnsContext, addOnId: string, req: UpdateAddOnRequest) {
    if (!ctx?.userId || !ctx?.tenantId) throw new ServiceAddOnsForbiddenError('Not authenticated');
    const state = await this.services.getState(ctx as any);
    const items = (state?.services?.items || []);
    
    await Promise.all(items.map(async (s) => {
      const current = (await this.services.getAddOns(ctx as any, s.serviceId)) || [];
      const idx = current.findIndex((a) => a.addOnId === addOnId);
      if (idx !== -1) {
        const updated = { ...current[idx] };
        if (req.name !== undefined) updated.name = req.name.trim();
        if (req.priceCents !== undefined) updated.priceCents = req.priceCents;
        if (req.durationDeltaMinutes !== undefined) updated.durationDeltaMinutes = req.durationDeltaMinutes;
        if (req.isTaxable !== undefined) updated.isTaxable = req.isTaxable;
        
        const newAddOns = [...current];
        newAddOns[idx] = updated;
        await this.services.setAddOns(ctx as any, s.serviceId, newAddOns);
      }
    }));
    return { ok: true };
  }

  async archive(ctx: ServiceAddOnsContext, addOnId: string) {
    if (!ctx?.userId || !ctx?.tenantId) throw new ServiceAddOnsForbiddenError('Not authenticated');
    const state = await this.services.getState(ctx as any);
    const items = (state?.services?.items || []);
    
    await Promise.all(items.map(async (s) => {
      const current = (await this.services.getAddOns(ctx as any, s.serviceId)) || [];
      const idx = current.findIndex((a) => a.addOnId === addOnId);
      if (idx !== -1) {
        const newAddOns = [...current];
        newAddOns[idx] = { ...newAddOns[idx], isActive: false };
        await this.services.setAddOns(ctx as any, s.serviceId, newAddOns);
      }
    }));
    return { ok: true };
  }

  async reactivate(ctx: ServiceAddOnsContext, addOnId: string) {
    if (!ctx?.userId || !ctx?.tenantId) throw new ServiceAddOnsForbiddenError('Not authenticated');
    const state = await this.services.getState(ctx as any);
    const items = (state?.services?.items || []);
    
    await Promise.all(items.map(async (s) => {
      const current = (await this.services.getAddOns(ctx as any, s.serviceId)) || [];
      const idx = current.findIndex((a) => a.addOnId === addOnId);
      if (idx !== -1) {
        const newAddOns = [...current];
        newAddOns[idx] = { ...newAddOns[idx], isActive: true };
        await this.services.setAddOns(ctx as any, s.serviceId, newAddOns);
      }
    }));
    return { ok: true };
  }
}
