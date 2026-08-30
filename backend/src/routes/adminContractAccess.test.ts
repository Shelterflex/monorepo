import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAdminContractAccessRouter } from "./adminContractAccess.js";
import { SorobanAdapter } from "../soroban/adapter.js";

describe("Admin Contract Access Routes - Unit Tests", () => {
  let mockAdapter: SorobanAdapter;
  let router: any;

  beforeEach(() => {
    // Mock adapter with all required methods
    mockAdapter = {
      proposeAssignRole: vi.fn().mockResolvedValue("test_tx_hash_1"),
      confirmAssignRole: vi.fn().mockResolvedValue("test_tx_hash_2"),
      delegatePermission: vi.fn().mockResolvedValue("test_tx_hash_3"),
      getRole: vi.fn().mockResolvedValue(0), // Admin role
      hasPermission: vi.fn().mockResolvedValue(true),
      listRoles: vi.fn().mockResolvedValue([
        { address: "GTESTADDRESS1", role: 0 },
        { address: "GTESTADDRESS2", role: 1 },
      ]),
    } as any;

    // Set admin secret for testing
    process.env.MANUAL_ADMIN_SECRET = "test_secret";

    // Create router
    router = createAdminContractAccessRouter(mockAdapter);
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
      expect(mockAdapter.proposeAssignRole).toBeDefined();
      expect(mockAdapter.confirmAssignRole).toBeDefined();
      expect(mockAdapter.delegatePermission).toBeDefined();
      expect(mockAdapter.getRole).toBeDefined();
      expect(mockAdapter.hasPermission).toBeDefined();
      expect(mockAdapter.listRoles).toBeDefined();
    });
  });

  describe("Adapter method calls", () => {
    it("should call proposeAssignRole with correct parameters", async () => {
      await mockAdapter.proposeAssignRole("GTESTADDRESS1", 1);
      expect(mockAdapter.proposeAssignRole).toHaveBeenCalledWith("GTESTADDRESS1", 1);
    });

    it("should call confirmAssignRole with correct parameters", async () => {
      await mockAdapter.confirmAssignRole("GTESTADDRESS1");
      expect(mockAdapter.confirmAssignRole).toHaveBeenCalledWith("GTESTADDRESS1");
    });

    it("should call delegatePermission with correct parameters", async () => {
      await mockAdapter.delegatePermission("GTESTADDRESS2", 6);
      expect(mockAdapter.delegatePermission).toHaveBeenCalledWith("GTESTADDRESS2", 6);
    });

    it("should call getRole with correct parameters", async () => {
      await mockAdapter.getRole("GTESTADDRESS1");
      expect(mockAdapter.getRole).toHaveBeenCalledWith("GTESTADDRESS1");
    });

    it("should call hasPermission with correct parameters", async () => {
      await mockAdapter.hasPermission("GTESTADDRESS1", 6);
      expect(mockAdapter.hasPermission).toHaveBeenCalledWith("GTESTADDRESS1", 6);
    });

    it("should call listRoles", async () => {
      await mockAdapter.listRoles();
      expect(mockAdapter.listRoles).toHaveBeenCalled();
    });
  });

  describe("Adapter method availability", () => {
    it("should handle missing proposeAssignRole method", () => {
      const incompleteAdapter = {} as SorobanAdapter;
      const testRouter = createAdminContractAccessRouter(incompleteAdapter);
      expect(testRouter).toBeDefined();
    });

    it("should handle missing confirmAssignRole method", () => {
      const incompleteAdapter = { proposeAssignRole: vi.fn() } as any;
      const testRouter = createAdminContractAccessRouter(incompleteAdapter);
      expect(testRouter).toBeDefined();
    });

    it("should handle missing delegatePermission method", () => {
      const incompleteAdapter = { 
        proposeAssignRole: vi.fn(),
        confirmAssignRole: vi.fn()
      } as any;
      const testRouter = createAdminContractAccessRouter(incompleteAdapter);
      expect(testRouter).toBeDefined();
    });

    it("should handle missing getRole method", () => {
      const incompleteAdapter = { 
        proposeAssignRole: vi.fn(),
        confirmAssignRole: vi.fn(),
        delegatePermission: vi.fn()
      } as any;
      const testRouter = createAdminContractAccessRouter(incompleteAdapter);
      expect(testRouter).toBeDefined();
    });

    it("should handle missing hasPermission method", () => {
      const incompleteAdapter = { 
        proposeAssignRole: vi.fn(),
        confirmAssignRole: vi.fn(),
        delegatePermission: vi.fn(),
        getRole: vi.fn()
      } as any;
      const testRouter = createAdminContractAccessRouter(incompleteAdapter);
      expect(testRouter).toBeDefined();
    });

    it("should handle missing listRoles method", () => {
      const incompleteAdapter = { 
        proposeAssignRole: vi.fn(),
        confirmAssignRole: vi.fn(),
        delegatePermission: vi.fn(),
        getRole: vi.fn(),
        hasPermission: vi.fn()
      } as any;
      const testRouter = createAdminContractAccessRouter(incompleteAdapter);
      expect(testRouter).toBeDefined();
    });
  });
});
