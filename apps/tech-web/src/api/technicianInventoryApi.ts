// technicianInventoryApi.ts — technician-facing inventory client for the real @Controller('technician/inventory')
// routes. Same-origin, session cookie; the server derives tenant+branch and the technician identity (no ids sent
// from the client). Cost/vendor data is already stripped server-side for technicians. Reads return server-truth.
import { api } from './client';

// A product as the technician search returns it (cost/retail are stripped server-side for techs).
export interface TechInvProduct {
  id: string;
  name: string;
  brand_name?: string | null;
  category_name?: string | null;
  color_name?: string | null;
  color_number?: string | null;
  color_family?: string | null;
  sku?: string | null;
  barcode?: string | null;
  unit_type?: string | null;
  tracking_mode?: string | null;
  quantity_on_hand?: number | null;
  onHand?: number;
  status?: string;
}

export interface TechInvReport {
  id: string;
  product_id: string;
  inventory_unit_id?: string | null;
  report_type: string;
  status: string;
  note?: string | null;
  created_at: string;
  product_name?: string | null;
  color_number?: string | null;
}

// Report-type codes accepted by the backend (108_inventory_management.sql report_type values).
export type TechReportType =
  | 'bottle_low' | 'bottle_empty' | 'open_new' | 'damaged' | 'missing'
  | 'expired' | 'wrong_quantity' | 'need_reorder' | 'used' | 'other';

export interface SubmitReportInput {
  reportType: TechReportType;
  productId?: string;
  unitId?: string;
  estimatedRemainingPercent?: number;
  reportedQuantity?: number;
  note?: string;
  serviceTicketId?: string;
}

export const technicianInventoryApi = {
  // Search this salon's catalog (limited view). Empty query returns the first page.
  search: (search?: string) =>
    api.get<{ products: TechInvProduct[] }>('/technician/inventory/search', search ? { search } : undefined),

  // The technician's own recent reports (with live status).
  myReports: () => api.get<{ reports: TechInvReport[] }>('/technician/inventory/reports/mine'),

  // Submit a product/bottle status report. The server validates against the current bottle state and
  // rejects duplicate pending reports for the same bottle+type (HTTP 409).
  submitReport: (body: SubmitReportInput) =>
    api.post<{ reportId: string; status: string }>('/technician/inventory/reports', body as unknown as Record<string, unknown>),

  // Open a replacement bottle (technicians are allowed this one lifecycle action).
};
