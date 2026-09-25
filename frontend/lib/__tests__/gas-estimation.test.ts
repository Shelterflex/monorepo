import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeBuffer,
  stroopsToXlm,
  formatFee,
  estimateNgnEquivalent,
  estimateGas,
  getFeeDisplay,
} from "../gas-estimation";

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock("../apiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../apiClient")>();
  return {
    ...actual,
    apiGet: vi.fn(),
  };
});

import { apiGet } from "../apiClient";

describe("computeBuffer", () => {
  it("adds a 3x buffer for low confidence", () => {
    expect(computeBuffer("1000000", "low")).toBe("3000000");
  });

  it("adds a 2x buffer for medium confidence", () => {
    expect(computeBuffer("1000000", "medium")).toBe("2000000");
  });

  it("adds a 1.3x buffer for high confidence", () => {
    expect(computeBuffer("1000000", "high")).toBe("1300000");
  });

  it("rounds up the buffered value", () => {
    expect(computeBuffer("3", "high")).toBe("4");
  });

  it("handles zero stroops", () => {
    expect(computeBuffer("0", "low")).toBe("0");
  });

  it("uses 1.5x for unknown confidence", () => {
    expect(computeBuffer("1000", "unknown" as any)).toBe("1500");
  });
});

describe("stroopsToXlm", () => {
  it("converts stroops to XLM", () => {
    expect(stroopsToXlm("10000000")).toBe(1);
    expect(stroopsToXlm("5000000")).toBe(0.5);
    expect(stroopsToXlm("0")).toBe(0);
  });

  it("handles very small amounts", () => {
    expect(stroopsToXlm("1")).toBe(0.0000001);
  });
});

describe("formatFee", () => {
  it("formats XLM with 4 decimal places", () => {
    expect(formatFee("10000000")).toBe("1.0000 XLM");
    expect(formatFee("1")).toBe("0.0000 XLM");
  });

  it("formats zero correctly", () => {
    expect(formatFee("0")).toBe("0.0000 XLM");
  });
});

describe("estimateNgnEquivalent", () => {
  it("converts XLM to NGN at default rate", () => {
    const result = estimateNgnEquivalent(1);
    expect(result).toContain("₦");
    expect(result).toContain("850");
  });

  it("accepts custom XLM price", () => {
    const result = estimateNgnEquivalent(2, 1000);
    expect(result).toContain("₦");
    expect(result).toContain("2,000");
  });

  it("handles zero XLM", () => {
    const result = estimateNgnEquivalent(0);
    expect(result).toContain("₦");
    expect(result).toContain("0");
  });
});

describe("estimateGas", () => {
  it("returns estimate and benchmark on success", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      success: true,
      functionName: "invoke_contract",
      estimate: { estimatedFee: "500000", confidence: "high" },
      benchmark: { functionName: "invoke_contract", avgCpuInstructions: 100, avgMemoryBytes: 256, avgTotalFee: "500000", sampleCount: 50, p50Fee: "480000", p95Fee: "520000", p99Fee: "600000" },
    });

    const result = await estimateGas("invoke_contract", "simple");

    expect(apiGet).toHaveBeenCalledWith(
      "/api/gas-metrics/estimate/invoke_contract?complexity=simple",
    );
    expect(result.estimatedFee).toBe("500000");
    expect(result.confidence).toBe("high");
    expect(result.benchmark).not.toBeNull();
  });

  it("returns fallback on network error", async () => {
    vi.mocked(apiGet).mockRejectedValue(new Error("Network error"));

    const result = await estimateGas("invoke_contract");

    expect(result.estimatedFee).toBe("1000000");
    expect(result.confidence).toBe("low");
    expect(result.benchmark).toBeNull();
  });

  it("defaults complexity to moderate", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      success: true,
      functionName: "invoke_contract",
      estimate: { estimatedFee: "500000", confidence: "medium" },
      benchmark: null,
    });

    await estimateGas("invoke_contract");

    expect(apiGet).toHaveBeenCalledWith(
      "/api/gas-metrics/estimate/invoke_contract?complexity=moderate",
    );
  });

  it("returns fallback on API error response", async () => {
    vi.mocked(apiGet).mockRejectedValue(new Error("API Error: 500"));

    const result = await estimateGas("invoke_contract", "complex");

    expect(result.estimatedFee).toBe("1000000");
    expect(result.confidence).toBe("low");
    expect(result.benchmark).toBeNull();
  });
});

describe("getFeeDisplay", () => {
  it("returns formatted fee display on success", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      success: true,
      functionName: "invoke_contract",
      estimate: { estimatedFee: "10000000", confidence: "high" },
      benchmark: { functionName: "invoke_contract", avgCpuInstructions: 100, avgMemoryBytes: 256, avgTotalFee: "10000000", sampleCount: 50, p50Fee: "9800000", p95Fee: "10200000", p99Fee: "11000000" },
    });

    const result = await getFeeDisplay("invoke_contract", "simple", 1000);

    expect(result.estimatedFeeXlm).toBe("1.0000 XLM");
    expect(result.maxFeeXlm).toBe("1.3000 XLM");
    expect(result.estimatedFeeNgn).toContain("₦");
    expect(result.confidence).toBe("high");
    expect(result.isFallback).toBe(false);
  });

  it("marks as fallback when benchmark is null and confidence is low", async () => {
    vi.mocked(apiGet).mockRejectedValue(new Error("fail"));

    const result = await getFeeDisplay("invoke_contract");

    expect(result.isFallback).toBe(true);
    expect(result.confidence).toBe("low");
  });

  it("isFallback is false when benchmark exists even with low confidence", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      success: true,
      functionName: "invoke_contract",
      estimate: { estimatedFee: "500000", confidence: "low" },
      benchmark: { functionName: "invoke_contract", avgCpuInstructions: 50, avgMemoryBytes: 128, avgTotalFee: "500000", sampleCount: 10, p50Fee: "480000", p95Fee: "600000", p99Fee: "700000" },
    });

    const result = await getFeeDisplay("invoke_contract");

    expect(result.isFallback).toBe(false);
  });

  it("computes max fee with correct buffer", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      success: true,
      functionName: "invoke_contract",
      estimate: { estimatedFee: "1000000", confidence: "medium" },
      benchmark: null,
    });

    const result = await getFeeDisplay("invoke_contract", "moderate", 850);

    // medium confidence → 2x buffer → 2000000 stroops → 0.2000 XLM
    expect(result.maxFeeXlm).toBe("0.2000 XLM");
    // isFallback is false because confidence is "medium", not "low"
    expect(result.isFallback).toBe(false);
  });
});
