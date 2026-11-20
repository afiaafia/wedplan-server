export type BookingStatus =
  | "Pending"
  | "Accepted"
  | "Rejected"
  | "Cancelled";

export interface BookingDocument {
  serviceId: string;
  customerId: string;
  vendorId: string;

  eventDate: Date;
  eventLocation: string;
  message: string;

  status: BookingStatus;

  createdAt: Date;
  updatedAt: Date;
}
