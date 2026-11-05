// appointments.ts — wire contract (Constitution 13 §13, §15). Realm: tenant.

export interface TechApptFilters {
  date?: string; search?: string; technicianId?: string; status?: string; source?: string; serviceCategory?: string; conflictOnly?: boolean; depositStatus?: string; branchId?: string; page?: number; pageSize?: number;
  /** 200-technician §2 (Oct 26 2026): page the technician LANES (and the appointments on them) instead of returning one
   *  lane per technician of the salon. Omitted = every lane (the legacy shape). */
  lanePage?: number; lanePageSize?: number;
  /** search the lanes by technician name or "#n" (n = the lane's place in the name-ordered roster) */
  laneSearch?: string;
  /** 'none' = do not return filters.technicians (every technician's name); the POS screen pages lanes and picks technicians
   *  through the server-paged picker instead */
  roster?: 'none';
}
/** GET /pos/tech-appointments/state with lanePage: the lane page that came back. */
export interface TechApptLanePage { page: number; pageSize: number; total: number; totalPages: number; totalAll: number }
