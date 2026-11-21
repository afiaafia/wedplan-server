import { countVendorBookings } from "./booking.model.js";
import {
  countActiveVendorServices,
  countVendorServices,
  countVendorServicesPendingApproval,
} from "./service.model.js";

export interface VendorDashboardStats {
  totalServices: number;
  activeServices: number;
  pendingApproval: number;
  totalBookings: number;
}

export interface DashboardCountDependencies {
  countTotal: (vendorId: string) => Promise<number>;
  countActive: (vendorId: string) => Promise<number>;
  countPending: (vendorId: string) => Promise<number>;
  countBookings: (vendorId: string) => Promise<number>;
}

const defaultDependencies: DashboardCountDependencies = {
  countTotal: countVendorServices,
  countActive: countActiveVendorServices,
  countPending: countVendorServicesPendingApproval,
  countBookings: countVendorBookings,
};

export async function getVendorDashboardStats(
  vendorId: string,
  dependencies: DashboardCountDependencies = defaultDependencies
): Promise<VendorDashboardStats> {
  const [totalServices, activeServices, pendingApproval, totalBookings] =
    await Promise.all([
      dependencies.countTotal(vendorId),
      dependencies.countActive(vendorId),
      dependencies.countPending(vendorId),
      dependencies.countBookings(vendorId),
    ]);

  return {
    totalServices,
    activeServices,
    pendingApproval,
    totalBookings,
  };
}
