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

export type PublicServiceSort = "newest" | "price_asc" | "price_desc";
