import type { BookableService, BookableTechnician, BookingOptions, BookingResult } from '@aipowersalon/api-contracts/customer';
export type { BookableService, BookableTechnician, BookingOptions, BookingResult };   // owned by packages/api-contracts (Constitution 13 §13)

export interface CreateBookingRequest {
  salonId?: string;              // developer, Sep 2026: multi-salon customer app names the salon (ignored when the session already scopes it)
  serviceId: string;             // kept for backward compatibility; serviceIds takes precedence
  serviceIds?: string[];         // developer, Sep 2026: several services in one booking
  technicianId: string;
  addOnIds?: string[];           // developer, Sep 2026: add-ons the customer selected
  date: string;       // YYYY-MM-DD
  startTime: string;  // HH:MM (24h, salon-local)
  inspirationNote?: string;      // "Book This Look": human-readable note shown to the technician
  inspirationPhotoId?: string;   // portfolio photo that inspired the booking (stored on the appointment)
  dealId?: string;               // Marketplace: reserve this deal for the booking (oversell-safe hold → consumed on success)
  bookingSessionId?: string;     // Phase 4: the sealed booking session a 428 issued — continues that verification
  deviceId?: string;             // Phase 4: the requesting device (kept with the verification session)
  dealIdempotencyKey?: string;   // optional client key so a retried booking replays the same reservation
}

export interface RescheduleRequest { date: string; startTime: string }
export interface RescheduleResult { appointmentId: string; date: string; startTime: string; endTime: string; status: string }
