import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApplicationService } from "./applicationService.js";
import { listingApplicationRepository } from "../repositories/ListingApplicationRepository.js";
import { auditLog } from "../utils/auditLogger.js";
import { outboxStore } from "../outbox/index.js";
import {
  ListingApplicationStatus,
  PaymentPlan,
} from "../models/listingApplication.js";
import type {
  ListingApplication,
  CreateListingApplicationInput,
} from "../models/listingApplication.js";

// Mock dependencies
vi.mock("../repositories/ListingApplicationRepository.js");
vi.mock("../utils/auditLogger.js");
vi.mock("../outbox/index.js", () => ({
  outboxStore: {
    create: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock("./rtiAssessmentService.js", () => ({
  computeRti: vi.fn().mockReturnValue({
    monthlyIncome: 100000,
    monthlyRepayment: 5000,
    rtiPercent: 5,
    verdict: "pass",
    assessedAt: "2026-08-28T00:00:00.000Z",
  }),
}));

describe("ApplicationService", () => {
  let applicationService: ApplicationService;

  beforeEach(() => {
    applicationService = new ApplicationService(listingApplicationRepository);
    vi.clearAllMocks();
  });

  describe("apply", () => {
    it("creates a new application with PENDING status", async () => {
      const tenantId = "tenant-1";
      const listingId = "listing-1";
      const input: CreateListingApplicationInput = {
        tenantId,
        listingId,
        landlordId: "landlord-1",
        preferredStartDate: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
        paymentPlan: PaymentPlan.SIX_MONTHS,
      };
      const mockApplication: ListingApplication = {
        id: "app-1",
        tenantId,
        listingId,
        landlordId: "landlord-1",
        status: ListingApplicationStatus.PENDING,
        preferredStartDate: input.preferredStartDate,
        paymentPlan: input.paymentPlan,
        appliedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(
        listingApplicationRepository.findDuplicateActive,
      ).mockResolvedValue(null);
      vi.mocked(listingApplicationRepository.create).mockResolvedValue(
        mockApplication,
      );
      vi.mocked(auditLog).mockImplementation(() => {});

      const result = await applicationService.apply(input);

      expect(
        listingApplicationRepository.findDuplicateActive,
      ).toHaveBeenCalledWith(tenantId, listingId);
      expect(listingApplicationRepository.create).toHaveBeenCalledWith(input);
      expect(auditLog).toHaveBeenCalled();
      expect(result).toEqual(mockApplication);
    });

    it("rejects duplicate active applications for the same tenant and listing", async () => {
      const tenantId = "tenant-1";
      const listingId = "listing-1";
      const input: CreateListingApplicationInput = {
        tenantId,
        listingId,
        landlordId: "landlord-1",
        preferredStartDate: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
        paymentPlan: PaymentPlan.SIX_MONTHS,
      };
      const existingApplication: ListingApplication = {
        id: "app-1",
        tenantId,
        listingId,
        landlordId: "landlord-1",
        status: ListingApplicationStatus.PENDING,
        preferredStartDate: input.preferredStartDate,
        paymentPlan: input.paymentPlan,
        appliedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(
        listingApplicationRepository.findDuplicateActive,
      ).mockResolvedValue(existingApplication);

      await expect(applicationService.apply(input)).rejects.toThrow(
        "Tenant already has an active application",
      );

      expect(listingApplicationRepository.create).not.toHaveBeenCalled();
      expect(auditLog).not.toHaveBeenCalled();
    });

    it("validates preferred start date is at least 7 days in the future", async () => {
      const input: CreateListingApplicationInput = {
        tenantId: "tenant-1",
        listingId: "listing-1",
        landlordId: "landlord-1",
        preferredStartDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
        paymentPlan: PaymentPlan.SIX_MONTHS,
      };

      await expect(applicationService.apply(input)).rejects.toThrow(
        "Preferred start date must be at least 7 days",
      );

      expect(listingApplicationRepository.create).not.toHaveBeenCalled();
    });
  });

  describe("reviewApplication", () => {
    const applicationId = "app-1";
    const landlordId = "landlord-1";
    const mockApplication: ListingApplication = {
      id: applicationId,
      tenantId: "tenant-1",
      listingId: "listing-1",
      landlordId,
      status: ListingApplicationStatus.PENDING,
      preferredStartDate: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
      paymentPlan: PaymentPlan.SIX_MONTHS,
      appliedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it("transitions from PENDING to APPROVED", async () => {
      vi.mocked(listingApplicationRepository.findById).mockResolvedValue(
        mockApplication,
      );
      vi.mocked(listingApplicationRepository.updateStatus).mockResolvedValue({
        ...mockApplication,
        status: ListingApplicationStatus.APPROVED,
      });
      vi.mocked(auditLog).mockImplementation(() => {});

      const result = await applicationService.reviewApplication(
        applicationId,
        landlordId,
        "approve",
      );

      expect(listingApplicationRepository.findById).toHaveBeenCalledWith(
        applicationId,
      );
      expect(listingApplicationRepository.updateStatus).toHaveBeenCalledWith(
        applicationId,
        "approved",
        landlordId,
        undefined,
        expect.objectContaining({
          verdict: expect.any(String),
        }),
      );
      expect(result.status).toBe("approved");
    });

    it("transitions from PENDING to REJECTED", async () => {
      vi.mocked(listingApplicationRepository.findById).mockResolvedValue(
        mockApplication,
      );
      vi.mocked(listingApplicationRepository.updateStatus).mockResolvedValue({
        ...mockApplication,
        status: ListingApplicationStatus.REJECTED,
      });
      vi.mocked(auditLog).mockImplementation(() => {});

      const result = await applicationService.reviewApplication(
        applicationId,
        landlordId,
        "reject",
        "Insufficient income",
      );

      expect(listingApplicationRepository.updateStatus).toHaveBeenCalledWith(
        applicationId,
        "rejected",
        landlordId,
        "Insufficient income",
        expect.objectContaining({
          verdict: expect.any(String),
        }),
      );
      expect(result.status).toBe("rejected");
    });

    it("rejects review if landlord does not own the listing", async () => {
      const wrongLandlordId = "landlord-2";
      vi.mocked(listingApplicationRepository.findById).mockResolvedValue(
        mockApplication,
      );

      await expect(
        applicationService.reviewApplication(
          applicationId,
          wrongLandlordId,
          "approve",
        ),
      ).rejects.toThrow(
        "You can only review applications for your own listings",
      );

      expect(listingApplicationRepository.updateStatus).not.toHaveBeenCalled();
    });

    it("throws error if application not found", async () => {
      vi.mocked(listingApplicationRepository.findById).mockResolvedValue(null);

      await expect(
        applicationService.reviewApplication(
          applicationId,
          landlordId,
          "approve",
        ),
      ).rejects.toThrow("Application not found");
    });
  });

  describe("withdrawApplication", () => {
    const applicationId = "app-1";
    const tenantId = "tenant-1";
    const mockApplication: ListingApplication = {
      id: applicationId,
      tenantId,
      listingId: "listing-1",
      landlordId: "landlord-1",
      status: ListingApplicationStatus.PENDING,
      preferredStartDate: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
      paymentPlan: PaymentPlan.SIX_MONTHS,
      appliedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it("transitions from PENDING to WITHDRAWN", async () => {
      vi.mocked(listingApplicationRepository.findById).mockResolvedValue(
        mockApplication,
      );
      vi.mocked(listingApplicationRepository.withdraw).mockResolvedValue({
        ...mockApplication,
        status: ListingApplicationStatus.WITHDRAWN,
      });
      vi.mocked(auditLog).mockImplementation(() => {});

      const result = await applicationService.withdrawApplication(
        applicationId,
        tenantId,
      );

      expect(listingApplicationRepository.findById).toHaveBeenCalledWith(
        applicationId,
      );
      expect(listingApplicationRepository.withdraw).toHaveBeenCalledWith(
        applicationId,
      );
      expect(auditLog).toHaveBeenCalled();
      expect(result.status).toBe(ListingApplicationStatus.WITHDRAWN);
    });

    it("transitions from UNDER_REVIEW to WITHDRAWN", async () => {
      const underReviewApplication = {
        ...mockApplication,
        status: ListingApplicationStatus.UNDER_REVIEW,
      };
      vi.mocked(listingApplicationRepository.findById).mockResolvedValue(
        underReviewApplication,
      );
      vi.mocked(listingApplicationRepository.withdraw).mockResolvedValue({
        ...underReviewApplication,
        status: ListingApplicationStatus.WITHDRAWN,
      });
      vi.mocked(auditLog).mockImplementation(() => {});

      const result = await applicationService.withdrawApplication(
        applicationId,
        tenantId,
      );

      expect(listingApplicationRepository.withdraw).toHaveBeenCalledWith(
        applicationId,
      );
      expect(result.status).toBe(ListingApplicationStatus.WITHDRAWN);
    });

    it("rejects withdrawal from APPROVED status", async () => {
      const approvedApplication = {
        ...mockApplication,
        status: ListingApplicationStatus.APPROVED,
      };
      vi.mocked(listingApplicationRepository.findById).mockResolvedValue(
        approvedApplication,
      );

      await expect(
        applicationService.withdrawApplication(applicationId, tenantId),
      ).rejects.toThrow("Cannot withdraw application in approved status");

      expect(listingApplicationRepository.withdraw).not.toHaveBeenCalled();
    });

    it("rejects withdrawal from REJECTED status", async () => {
      const rejectedApplication = {
        ...mockApplication,
        status: ListingApplicationStatus.REJECTED,
      };
      vi.mocked(listingApplicationRepository.findById).mockResolvedValue(
        rejectedApplication,
      );

      await expect(
        applicationService.withdrawApplication(applicationId, tenantId),
      ).rejects.toThrow("Cannot withdraw application in rejected status");

      expect(listingApplicationRepository.withdraw).not.toHaveBeenCalled();
    });

    it("rejects withdrawal from already WITHDRAWN status", async () => {
      const withdrawnApplication = {
        ...mockApplication,
        status: ListingApplicationStatus.WITHDRAWN,
      };
      vi.mocked(listingApplicationRepository.findById).mockResolvedValue(
        withdrawnApplication,
      );

      await expect(
        applicationService.withdrawApplication(applicationId, tenantId),
      ).rejects.toThrow("Cannot withdraw application in withdrawn status");

      expect(listingApplicationRepository.withdraw).not.toHaveBeenCalled();
    });

    it("rejects withdrawal if tenant does not own the application", async () => {
      const wrongTenantId = "tenant-2";
      vi.mocked(listingApplicationRepository.findById).mockResolvedValue(
        mockApplication,
      );

      await expect(
        applicationService.withdrawApplication(applicationId, wrongTenantId),
      ).rejects.toThrow("You can only withdraw your own applications");

      expect(listingApplicationRepository.withdraw).not.toHaveBeenCalled();
    });

    it("throws error if application not found", async () => {
      vi.mocked(listingApplicationRepository.findById).mockResolvedValue(null);

      await expect(
        applicationService.withdrawApplication(applicationId, tenantId),
      ).rejects.toThrow("Application not found");
    });
  });

  describe("state machine transitions", () => {
    it("allows full lifecycle: PENDING -> APPROVED", async () => {
      const applicationId = "app-1";
      const landlordId = "landlord-1";
      const pendingApp: ListingApplication = {
        id: applicationId,
        tenantId: "tenant-1",
        listingId: "listing-1",
        landlordId,
        status: ListingApplicationStatus.PENDING,
        preferredStartDate: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
        paymentPlan: PaymentPlan.SIX_MONTHS,
        appliedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(listingApplicationRepository.findById).mockResolvedValue(
        pendingApp,
      );
      vi.mocked(listingApplicationRepository.updateStatus).mockResolvedValue({
        ...pendingApp,
        status: ListingApplicationStatus.APPROVED,
      });
      vi.mocked(auditLog).mockImplementation(() => {});

      const result = await applicationService.reviewApplication(
        applicationId,
        landlordId,
        "approve",
      );
      expect(result.status).toBe(ListingApplicationStatus.APPROVED);
    });

    it("allows full lifecycle: PENDING -> REJECTED", async () => {
      const applicationId = "app-1";
      const landlordId = "landlord-1";
      const pendingApp: ListingApplication = {
        id: applicationId,
        tenantId: "tenant-1",
        listingId: "listing-1",
        landlordId,
        status: ListingApplicationStatus.PENDING,
        preferredStartDate: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
        paymentPlan: PaymentPlan.SIX_MONTHS,
        appliedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(listingApplicationRepository.findById).mockResolvedValue(
        pendingApp,
      );
      vi.mocked(listingApplicationRepository.updateStatus).mockResolvedValue({
        ...pendingApp,
        status: ListingApplicationStatus.REJECTED,
      });
      vi.mocked(auditLog).mockImplementation(() => {});

      const result = await applicationService.reviewApplication(
        applicationId,
        landlordId,
        "reject",
      );
      expect(result.status).toBe(ListingApplicationStatus.REJECTED);
    });

    it("allows withdrawal from PENDING and UNDER_REVIEW states", async () => {
      const applicationId = "app-1";
      const tenantId = "tenant-1";
      const pendingApp: ListingApplication = {
        id: applicationId,
        tenantId,
        listingId: "listing-1",
        landlordId: "landlord-1",
        status: ListingApplicationStatus.PENDING,
        preferredStartDate: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
        paymentPlan: PaymentPlan.SIX_MONTHS,
        appliedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Withdraw from PENDING
      vi.mocked(listingApplicationRepository.findById).mockResolvedValue(
        pendingApp,
      );
      vi.mocked(listingApplicationRepository.withdraw).mockResolvedValue({
        ...pendingApp,
        status: ListingApplicationStatus.WITHDRAWN,
      });
      vi.mocked(auditLog).mockImplementation(() => {});

      let result = await applicationService.withdrawApplication(
        applicationId,
        tenantId,
      );
      expect(result.status).toBe(ListingApplicationStatus.WITHDRAWN);

      // Withdraw from UNDER_REVIEW
      const underReviewApp = {
        ...pendingApp,
        status: ListingApplicationStatus.UNDER_REVIEW,
      };
      vi.mocked(listingApplicationRepository.findById).mockResolvedValue(
        underReviewApp,
      );
      vi.mocked(listingApplicationRepository.withdraw).mockResolvedValue({
        ...underReviewApp,
        status: ListingApplicationStatus.WITHDRAWN,
      });

      result = await applicationService.withdrawApplication(
        applicationId,
        tenantId,
      );
      expect(result.status).toBe("withdrawn");
    });
  });

  describe("reviewApplication with RTI assessment", () => {
    const applicationId = "app-1";
    const landlordId = "landlord-1";
    const mockApplication: ListingApplication = {
      id: applicationId,
      tenantId: "tenant-1",
      listingId: "listing-1",
      landlordId,
      status: ListingApplicationStatus.PENDING,
      preferredStartDate: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
      paymentPlan: PaymentPlan.SIX_MONTHS,
      appliedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it("computes and attaches RTI assessment during application review", async () => {
      const { computeRti } = await import("./rtiAssessmentService.js");
      const mockRtiAssessment = {
        monthlyIncome: 100000,
        monthlyRepayment: 5000,
        rtiPercent: 5,
        verdict: "pass" as const,
        assessedAt: "2026-08-28T00:00:00.000Z",
      };

      vi.mocked(listingApplicationRepository.findById).mockResolvedValue(
        mockApplication,
      );
      vi.mocked(listingApplicationRepository.updateStatus).mockResolvedValue({
        ...mockApplication,
        status: ListingApplicationStatus.APPROVED,
        rtiAssessment: mockRtiAssessment,
      });
      vi.mocked(auditLog).mockImplementation(() => {});

      const result = await applicationService.reviewApplication(
        applicationId,
        landlordId,
        "approve",
      );

      // Verify RTI was computed
      expect(computeRti).toHaveBeenCalledWith("tenant-1", 5000);
      // Verify updateStatus was called with RTI assessment
      expect(listingApplicationRepository.updateStatus).toHaveBeenCalledWith(
        applicationId,
        "approved",
        landlordId,
        undefined,
        expect.objectContaining({
          verdict: "pass",
          rtiPercent: 5,
        }),
      );
      // Verify RTI is in response
      expect(result.rtiAssessment).toBeDefined();
      expect(result.rtiAssessment?.verdict).toBe("pass");
    });

    it("continues review even if RTI computation fails", async () => {
      const { computeRti } = await import("./rtiAssessmentService.js");
      vi.mocked(computeRti).mockImplementation(() => {
        throw new Error("RTI service unavailable");
      });

      vi.mocked(listingApplicationRepository.findById).mockResolvedValue(
        mockApplication,
      );
      vi.mocked(listingApplicationRepository.updateStatus).mockResolvedValue({
        ...mockApplication,
        status: ListingApplicationStatus.APPROVED,
      });
      vi.mocked(auditLog).mockImplementation(() => {});

      const result = await applicationService.reviewApplication(
        applicationId,
        landlordId,
        "approve",
      );

      // Review should still succeed without RTI
      expect(result.status).toBe("approved");
      // updateStatus should be called with undefined RTI
      expect(listingApplicationRepository.updateStatus).toHaveBeenCalledWith(
        applicationId,
        "approved",
        landlordId,
        undefined,
        undefined,
      );
    });
  });
});
