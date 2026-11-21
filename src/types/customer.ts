import type { BookingStatus } from "./booking.js";
import type { ServiceCategory } from "./service.js";

export const CUSTOMER_BOOKING_FILTERS = [
  "all",
  "pending",
  "accepted",
  "rejected",
  "cancelled",
] as const;

export type CustomerBookingFilter = (typeof CUSTOMER_BOOKING_FILTERS)[number];

export interface CustomerBookingService {
  id: string;
  title: string;
  image: string | null;
  category: ServiceCategory | null;
  price: number | null;
}

export interface CustomerBookingVendor {
  id: string;
  name: string | null;
  businessName: string | null;
  profileImage: string | null;
}

export interface CustomerBooking {
  id: string;
  serviceId: string;
  service: CustomerBookingService | null;
  vendorId: string;
  vendor: CustomerBookingVendor | null;
  eventDate: string;
  eventLocation: string;
  message: string;
  status: BookingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerDashboardStats {
  totalBookings: number;
  pendingBookings: number;
  acceptedBookings: number;
  rejectedBookings: number;
}

export interface CustomerDashboardData {
  stats: CustomerDashboardStats;
  bookings: CustomerBooking[];
}

export interface CustomerProfile {
  id: string;
  name: string;
  email: string;
  image: string | null;
  businessName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerBookingPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}
