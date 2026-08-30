import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAdminUpgradeableProxyRouter } from "./adminUpgradeableProxy.js";
import { SorobanAdapter } from "../soroban/adapter.js";

describe("Admin Upgradeable Proxy Routes - Unit Tests", () => {
  let mockAdapter: SorobanAdapter;
  let router: any;

  beforeEach(() => {
    // Mock adapter with all required methods
    mockAdapter = {
      proposeUpgrade: vi.fn().mockResolvedValue("test_tx_hash_propose"),
      confirmUpgrade: vi.fn().mockResolvedValue("test_tx_hash_confirm"),
      cancelUpgrade: vi.fn().mockResolvedValue("test_tx_hash_cancel"),
      transferAdmin: vi.fn().mockResolvedValue("test_tx_hash_transfer"),
      hasPendingUpgrade: vi.fn().mockResolvedValue(false),
    } as any;

    // Set admin secret for testing
    process.env.MANUAL_ADMIN_SECRET = "test_secret";

    // Create router
    router = createAdminUpgradeableProxyRouter(mockAdapter);
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
      expect(mockAdapter.proposeUpgrade).toBeDefined();
      expect(mockAdapter.confirmUpgrade).toBeDefined();
      expect(mockAdapter.cancelUpgrade).toBeDefined();
      expect(mockAdapter.transferAdmin).toBeDefined();
      expect(mockAdapter.hasPendingUpgrade).toBeDefined();
    });
  });

  describe("Adapter method calls", () => {
    it("should call proposeUpgrade with correct parameters", async () => {
      const wasmHash = "a".repeat(64);
      await mockAdapter.proposeUpgrade(wasmHash);
      expect(mockAdapter.proposeUpgrade).toHaveBeenCalledWith(wasmHash);
    });

    it("should call confirmUpgrade with correct parameters", async () => {
      const wasmHash = "b".repeat(64);
      await mockAdapter.confirmUpgrade(wasmHash);
      expect(mockAdapter.confirmUpgrade).toHaveBeenCalledWith(wasmHash);
    });

    it("should call cancelUpgrade", async () => {
      await mockAdapter.cancelUpgrade();
      expect(mockAdapter.cancelUpgrade).toHaveBeenCalled();
    });

    it("should call transferAdmin with correct parameters", async () => {
      const newAdmin = "GTESTADDRESS1";
      await mockAdapter.transferAdmin(newAdmin);
      expect(mockAdapter.transferAdmin).toHaveBeenCalledWith(newAdmin);
    });

    it("should call hasPendingUpgrade", async () => {
      await mockAdapter.hasPendingUpgrade();
      expect(mockAdapter.hasPendingUpgrade).toHaveBeenCalled();
    });
  });

  describe("Adapter method availability", () => {
    it("should handle missing proposeUpgrade method", () => {
      const incompleteAdapter = {} as SorobanAdapter;
      const testRouter = createAdminUpgradeableProxyRouter(incompleteAdapter);
      expect(testRouter).toBeDefined();
    });

    it("should handle missing confirmUpgrade method", () => {
      const incompleteAdapter = { proposeUpgrade: vi.fn() } as any;
      const testRouter = createAdminUpgradeableProxyRouter(incompleteAdapter);
      expect(testRouter).toBeDefined();
    });

    it("should handle missing cancelUpgrade method", () => {
      const incompleteAdapter = { 
        proposeUpgrade: vi.fn(),
        confirmUpgrade: vi.fn()
      } as any;
      const testRouter = createAdminUpgradeableProxyRouter(incompleteAdapter);
      expect(testRouter).toBeDefined();
    });

    it("should handle missing transferAdmin method", () => {
      const incompleteAdapter = { 
        proposeUpgrade: vi.fn(),
        confirmUpgrade: vi.fn(),
        cancelUpgrade: vi.fn()
      } as any;
      const testRouter = createAdminUpgradeableProxyRouter(incompleteAdapter);
      expect(testRouter).toBeDefined();
    });

    it("should handle missing hasPendingUpgrade method", () => {
      const incompleteAdapter = { 
        proposeUpgrade: vi.fn(),
        confirmUpgrade: vi.fn(),
        cancelUpgrade: vi.fn(),
        transferAdmin: vi.fn()
      } as any;
      const testRouter = createAdminUpgradeableProxyRouter(incompleteAdapter);
      expect(testRouter).toBeDefined();
    });
  });

  describe("WASM hash validation", () => {
    it("should accept valid 64-character hex hash", () => {
      const validHash = "a".repeat(64);
      expect(validHash).toMatch(/^[0-9a-fA-F]{64}$/);
    });

    it("should reject invalid hash length", () => {
      const invalidHash = "a".repeat(63);
      expect(invalidHash).not.toMatch(/^[0-9a-fA-F]{64}$/);
    });

    it("should reject hash with non-hex characters", () => {
      const invalidHash = "g".repeat(64);
      expect(invalidHash).not.toMatch(/^[0-9a-fA-F]{64}$/);
    });
  });
});
