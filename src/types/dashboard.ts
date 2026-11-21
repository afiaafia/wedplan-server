export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export function buildPaginationMeta(
  page: number,
  limit: number,
  total: number
): PaginationMeta {
  const totalPages = Math.ceil(total / limit);

  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

export interface VendorDashboardSummary {
  totalServices: number;
  activeServices: number;
  pendingApproval: number;
  totalBookings: number;
  pendingBookingRequests: number;
  acceptedBookings: number;
  currentSubscriptionPlan: "free" | "premium";
  activeServiceLimit: number | null;
}

export interface AdminDashboardStats {
  totalUsers: number;
  totalCustomers: number;
  totalVendors: number;
  totalServices: number;
  pendingServiceApprovals: number;
  totalBookings: number;
  totalTransactions: number;
  premiumVendors: number;
}

export interface AdminDashboardData {
  stats: AdminDashboardStats;
  recentUsers: Array<{
    id: string;
    name: string;
    email: string;
    image?: string;
    role: "customer" | "vendor" | "admin";
    createdAt: string;
  }>;
  recentServices: Array<{
    id: string;
    title: string;
    category: string;
    approvalStatus: string;
    createdAt: string;
    vendorName?: string;
    image?: string;
  }>;
  recentBookings: Array<{
    id: string;
    serviceId: string;
    status: string;
    createdAt: string;
    eventDate: string;
  }>;
  recentTransactions: Array<{
    id: string;
    plan: string;
    amount: number;
    currency: string;
    status: string;
    createdAt: string;
    vendorName?: string;
  }>;
}
