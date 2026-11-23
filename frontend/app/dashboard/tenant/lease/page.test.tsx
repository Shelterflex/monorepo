import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TenantLeasePage from "./page";
import * as tenantApi from "@/lib/tenantApi";

vi.mock("@/lib/tenantApi", () => ({
  getTenantCurrentLease: vi.fn(),
  getTenantLeaseDetails: vi.fn(),
}));

vi.mock("@/store/useAuthStore", () => ({
  default: (selector: any) =>
    selector({
      user: { name: "Alice Tenant", email: "alice@example.com" },
    }),
}));

vi.mock("@/components/dashboard-header", () => ({
  DashboardHeader: () => <div data-testid="dashboard-header" />,
}));

vi.mock("@/components/dashboard/DashboardSidebar", () => ({
  DashboardSidebar: () => <div data-testid="dashboard-sidebar" />,
}));

const mockCurrentLease: tenantApi.TenantCurrentLease = {
  dealId: "deal-123",
  property: "Sunrise Apartments, Unit 4B",
  location: "Victoria Island, Lagos",
  monthlyPayment: 250000,
  nextPaymentDate: "2026-12-01T00:00:00Z",
  leaseEnd: "2027-11-30T00:00:00Z",
  totalPaid: 500000,
  totalOwed: 3000000,
  progress: 17,
  landlord: { name: "John Landlord" },
};

const mockLeaseDetails: tenantApi.TenantLeaseDetails = {
  dealId: "deal-123",
  property: {
    title: "Sunrise Apartments, Unit 4B",
    address: "Victoria Island, Lagos",
    beds: 2,
    baths: 2,
    sqm: 95,
  },
  lease: {
    startDate: "2026-12-01T00:00:00Z",
    endDate: "2027-11-30T00:00:00Z",
    duration: "12 months",
    monthlyPayment: 250000,
    status: "active",
  },
  landlord: {
    name: "John Landlord",
    company: "Acme Properties",
    phone: "+2348012345678",
    email: "john@example.com",
  },
  paymentProgress: {
    totalPaid: 500000,
    totalOwed: 3000000,
    paymentsCompleted: 2,
    totalPayments: 12,
  },
};

describe("TenantLeasePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders active lease details when current lease exists", async () => {
    vi.mocked(tenantApi.getTenantCurrentLease).mockResolvedValue({
      success: true,
      data: mockCurrentLease,
    });
    vi.mocked(tenantApi.getTenantLeaseDetails).mockResolvedValue({
      success: true,
      data: mockLeaseDetails,
    });

    render(<TenantLeasePage />);

    expect(await screen.findByText("Sunrise Apartments, Unit 4B")).toBeInTheDocument();
    expect(screen.getByText("John Landlord")).toBeInTheDocument();
    expect(screen.getByText(/Active Lease/i)).toBeInTheDocument();
    expect(screen.getByText("12 months")).toBeInTheDocument();
    expect(screen.getByText("2 Beds")).toBeInTheDocument();
  });

  it("renders 'No Active Lease' when current lease is empty or missing dealId", async () => {
    vi.mocked(tenantApi.getTenantCurrentLease).mockResolvedValue({
      success: true,
      data: null as any,
    });

    render(<TenantLeasePage />);

    expect(await screen.findByText("No Active Lease")).toBeInTheDocument();
    expect(screen.getByText(/You do not have an active lease at the moment/i)).toBeInTheDocument();
  });

  it("handles 404 explicitly as no active lease", async () => {
    const error404: any = new Error("404 Not Found");
    error404.status = 404;
    vi.mocked(tenantApi.getTenantCurrentLease).mockRejectedValue(error404);

    render(<TenantLeasePage />);

    expect(await screen.findByText("No Active Lease")).toBeInTheDocument();
  });

  it("renders error state when fetch fails with non-404 error", async () => {
    vi.mocked(tenantApi.getTenantCurrentLease).mockRejectedValue(
      new Error("Network connection error")
    );

    render(<TenantLeasePage />);

    expect(await screen.findByText("Failed to load lease information")).toBeInTheDocument();
    expect(screen.getByText("Network connection error")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
