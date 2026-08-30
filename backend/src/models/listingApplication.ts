/**
 * Listing Application Model
 * Represents a tenant's application to rent a specific listing
 */

export enum ListingApplicationStatus {
  PENDING = "pending",
  UNDER_REVIEW = "under_review",
  APPROVED = "approved",
  REJECTED = "rejected",
  WITHDRAWN = "withdrawn",
}

export enum PaymentPlan {
  THREE_MONTHS = "3m",
  SIX_MONTHS = "6m",
  TWELVE_MONTHS = "12m",
  OUTRIGHT = "outright",
}

export interface RtiAssessment {
  monthlyIncome: number | null;
  monthlyRepayment: number;
  rtiPercent: number | null;
  verdict: "pass" | "borderline" | "fail" | "income_unverified";
  assessedAt: string;
}

export interface ListingApplication {
  id: string;
  listingId: string;
  tenantId: string;
  landlordId: string;
  status: ListingApplicationStatus;
  coverNote?: string;
  preferredStartDate: Date;
  paymentPlan: PaymentPlan;
  appliedAt: Date;
  reviewedAt?: Date;
  reviewedBy?: string;
  reviewerNotes?: string;
  rtiAssessment?: RtiAssessment;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateListingApplicationInput {
  listingId: string;
  tenantId: string;
  landlordId: string;
  coverNote?: string;
  preferredStartDate: Date;
  paymentPlan: PaymentPlan;
}
