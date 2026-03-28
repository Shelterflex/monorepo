import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealSorobanAdapter } from "./real-adapter.js";
import { SorobanConfig } from "./client.js";
import { TxType } from "../outbox/types.js";

// Mock @stellar/stellar-sdk to avoid complex XDR setup
vi.mock("@stellar/stellar-sdk", async () => {
  const actual = await vi.importActual("@stellar/stellar-sdk");

  class MockServer {
    constructor(url: string) {
      this.url = url;
    }
    url: string;
    getLatestLedger = vi.fn();
    getEvents = vi.fn();
    simulateTransaction = vi.fn();
    getAccount = vi.fn();
    sendTransaction = vi.fn();
    getTransaction = vi.fn();
  }

  return {
    ...actual,
    rpc: {
      Server: MockServer,
    },
  };
});

describe("RealSorobanAdapter - Receipt Decoding & Normalization", () => {
  let adapter: any;
  let mockServer: any;
  const mockConfig: SorobanConfig = {
    rpcUrl: "http://localhost",
    networkPassphrase: "Test",
    contractId: "C123",
    adminSecret: "SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX1",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new RealSorobanAdapter(mockConfig);
    mockServer = (adapter as any).server;
  });

  describe("normalizeReceipt", () => {
    it("should correctly normalize a valid receipt event", () => {
      const rawReceipt = {
        tx_id: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
        external_ref: new Uint8Array([0xaa, 0xbb, 0xcc]),
        tx_type: "TENANT_REPAYMENT",
        deal_id: "deal_123",
        listing_id: "listing_456",
        amount_usdc: 100000000n,
        amount_ngn: 150000n,
        fx_rate_ngn_per_usdc: 1500n,
        fx_provider: "manual",
        from: "GAAA",
        to: "GBBB",
        metadata_hash: new Uint8Array([0x12, 0x34]),
      };

      const result = (adapter as any).normalizeReceipt(rawReceipt);

      expect(result).toEqual({
        tx_id: "deadbeef",
        external_ref: "aabbcc",
        tx_type: TxType.TENANT_REPAYMENT,
        deal_id: "deal_123",
        listing_id: "listing_456",
        amount_usdc: "100000000",
        amount_ngn: 150000,
        fx_rate: 1500,
        fx_provider: "manual",
        from: "GAAA",
        to: "GBBB",
        metadata_hash: "1234",
      });
    });

    it("should use tx_id as fallback for external_ref if missing", () => {
      const rawReceipt = {
        tx_id: new Uint8Array([0x12, 0x34]),
        tx_type: "STAKE",
        deal_id: "d1",
        amount_usdc: 50n,
      };

      const result = (adapter as any).normalizeReceipt(rawReceipt);
      expect(result.external_ref).toBe("1234");
      expect(result.tx_type).toBe(TxType.STAKE);
    });

    it("should safely handle malformed or unexpected event data", () => {
      const rawReceipt = {};
      const result = (adapter as any).normalizeReceipt(rawReceipt);

      expect(result).toBeDefined();
      expect(result.deal_id).toBe("");
      expect(result.amount_usdc).toBe("0");
    });

    it("should handle edge cases like wrong types or missing fields", () => {
      const rawReceipt = {
        tx_id: "not-a-buffer",
        amount_usdc: "100",
        tx_type: 123,
        deal_id: null,
        amount_ngn: "not-a-number",
      };

      const result = (adapter as any).normalizeReceipt(rawReceipt);

      expect(result.tx_id).toBe("not-a-buffer");
      expect(result.amount_usdc).toBe("100");
      expect(result.tx_type).toBe("");
      expect(result.deal_id).toBe("");
      expect(result.amount_ngn).toBeUndefined();
    });

    it("should normalize TxType case-insensitively", () => {
      expect((adapter as any).normalizeTxType("landlord_payout")).toBe(
        TxType.LANDLORD_PAYOUT,
      );
    });

    it("should handle unknown TxTypes by returning lowercase string", () => {
      expect((adapter as any).normalizeTxType("UNKNOWN_TYPE")).toBe(
        "unknown_type",
      );
    });

    it("should skip malformed decoded event payload in getReceiptEvents without crashing", async () => {
      mockServer.getLatestLedger.mockResolvedValue({ sequence: 200 });
      mockServer.getEvents.mockResolvedValue({
        events: [
          {
            inSuccessfulContractCall: true,
            type: "contract",
            contractId: "C123",
            value: "not-base64",
            txHash: "abc123",
            ledger: 150,
          },
        ],
      });

      await expect(adapter.getReceiptEvents(100)).resolves.toEqual([]);
    });
  });

  describe("bytesLikeToHex", () => {
    it("should convert Uint8Array to hex string", () => {
      const input = new Uint8Array([0, 255, 16]);
      expect((adapter as any).bytesLikeToHex(input)).toBe("00ff10");
    });

    it("should handle Buffer", () => {
      const input = Buffer.from([0xca, 0xfe]);
      expect((adapter as any).bytesLikeToHex(input)).toBe("cafe");
    });

    it("should return string as-is", () => {
      expect((adapter as any).bytesLikeToHex("already-hex")).toBe(
        "already-hex",
      );
    });

    it("should return undefined for falsy input", () => {
      expect((adapter as any).bytesLikeToHex(null)).toBeUndefined();
      expect((adapter as any).bytesLikeToHex(undefined)).toBeUndefined();
    });
  });

  describe("i128ToDecimalString", () => {
    it("should convert BigInt to string", () => {
      expect((adapter as any).i128ToDecimalString(12345n)).toBe("12345");
    });
    it("should handle numbers", () => {
      expect((adapter as any).i128ToDecimalString(678.9)).toBe("678");
    });
    it('should fallback to "0" for invalid inputs', () => {
      expect((adapter as any).i128ToDecimalString(null)).toBe("0");
      expect((adapter as any).i128ToDecimalString({})).toBe("0");
    });
  });
});
