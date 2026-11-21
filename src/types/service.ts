export const SERVICE_CATEGORIES = [
  "Photography",
  "Videography",
  "Wedding Venue",
  "Catering",
  "Decoration",
  "Makeup & Beauty",
  "Music & Entertainment",
  "Wedding Planning",
  "Other",
] as const;

export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export const FEATURED_SERVICES_DEFAULT_LIMIT = 6;
export const FEATURED_SERVICES_MAX_LIMIT = 24;

export type ServiceApprovalStatus =
  | "pending"
  | "approved"
  | "rejected";

export interface ServiceDocument {
  vendorId: string;

  title: string;
  category: ServiceCategory;
  description: string;

  location: string;
  price: number;

  images: string[];

  approvalStatus: ServiceApprovalStatus;
  isActive: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export interface PublicService {
  id: string;
  title: string;
  category: ServiceCategory;
  description: string;
  location: string;
  price: number;
  images: string[];
  createdAt: string;
}

export interface VendorService extends PublicService {
  approvalStatus: ServiceApprovalStatus;
  isActive: boolean;
  updatedAt: string;
}

export interface VendorServiceInput {
  title: string;
  category: ServiceCategory;
  description: string;
  location: string;
  price: number;
  images: string[];
  isActive: boolean;
}

export type VendorServiceUpdate = Partial<Omit<VendorServiceInput, "isActive">>;

export type PublicServiceSort = "newest" | "price_asc" | "price_desc";

export interface FeaturedVendor {
  id: string;
  name?: string;
  profileImage?: string;
  businessName?: string;
}

export interface FeaturedService extends PublicService {
  isActive: boolean;
  approvalStatus: "approved";
  vendor: FeaturedVendor | null;
}

export interface FeaturedServicesData {
  services: FeaturedService[];
  total: number;
}

export interface FeaturedServicesResponse {
  success: true;
  data: FeaturedServicesData;
  meta: {
    limit: number;
  };
}
