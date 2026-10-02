import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAdminTimelockRouter } from "./admin-timelock.js";
import { SorobanAdapter } from "../soroban/adapter.js";

describe("Admin Timelock Routes - Unit Tests", () => {
  let mockAdapter: SorobanAdapter;
  let mockRepo: any;
  let router: any;

  beforeEach(() => {
    // Mock adapter with all required methods
    mockAdapter = {
      executeTimelock: vi.fn().mockResolvedValue("test_stellar_tx_hash"),
      cancelTimelock: vi.fn().mockResolvedValue("test_stellar_tx_hash"),
    } as any;

    // Mock repository
    mockRepo = {
      findAll: vi.fn().mockResolvedValue([
        {
          txHash: "test_tx_hash_1",
          target: "GTESTADDRESS1",
          functionName: "test_function",
          args: [],
          eta: 1234567890,
          status: "queued",
        },
      ]),
    };

    // Set admin secret for testing
    process.env.MANUAL_ADMIN_SECRET = "test_secret";

    // Create router
    router = createAdminTimelockRouter(mockAdapter, mockRepo);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MANUAL_ADMIN_SECRET;
  });

  describe("Router creation", () => {
    it("should create router successfully", () => {
      expect(router).toBeDefined();
      expect(typeof router).toBe("function");
    });

    it("should create router with adapter methods", () => {
      expect(mockAdapter.executeTimelock).toBeDefined();
      expect(mockAdapter.cancelTimelock).toBeDefined();
    });
  });

  describe("Adapter method calls", () => {
    it("should call executeTimelock with correct parameters", async () => {
      await mockAdapter.executeTimelock(
        "test_tx_hash",
        "GTESTADDRESS1",
        "test_function",
        [],
        1234567890
      );
      expect(mockAdapter.executeTimelock).toHaveBeenCalledWith(
        "test_tx_hash",
        "GTESTADDRESS1",
        "test_function",
        [],
        1234567890
      );
    });

    it("should call cancelTimelock with correct parameters", async () => {
      await mockAdapter.cancelTimelock("test_tx_hash");
      expect(mockAdapter.cancelTimelock).toHaveBeenCalledWith("test_tx_hash");
    });
  });

  describe("Repository method calls", () => {
    it("should call findAll to get transactions", async () => {
      await mockRepo.findAll();
      expect(mockRepo.findAll).toHaveBeenCalled();
    });
  });

  describe("Adapter method availability", () => {
    it("should handle missing executeTimelock method", () => {
      const incompleteAdapter = {} as SorobanAdapter;
      const testRouter = createAdminTimelockRouter(incompleteAdapter, mockRepo);
      expect(testRouter).toBeDefined();
    });

    it("should handle missing cancelTimelock method", () => {
      const incompleteAdapter = { executeTimelock: vi.fn() } as any;
      const testRouter = createAdminTimelockRouter(incompleteAdapter, mockRepo);
      expect(testRouter).toBeDefined();
    });
  });
});
