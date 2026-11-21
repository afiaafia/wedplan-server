export const BOOKING_STATUSES = [
  "Pending",
  "Accepted",
  "Rejected",
  "Cancelled",
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const ACTIVE_BOOKING_STATUSES: readonly BookingStatus[] = [
  "Pending",
  "Accepted",
];

export interface BookingDocument {
  serviceId: string;
  customerId: string;
  vendorId: string;

  eventDate: Date;
  eventLocation: string;
  message: string;

  status: BookingStatus;

  activeRequestKey?: string;

  createdAt: Date;
  updatedAt: Date;
}

export interface BookableServiceRecord {
  id: string;
  title: string;
  vendorId: string;
}

export interface BookingCreationResult {
  id: string;
  serviceId: string;
  serviceTitle: string;
  vendorId: string;
  eventDate: string;
  eventLocation: string;
  message: string;
  status: BookingStatus;
  createdAt: string;
}
