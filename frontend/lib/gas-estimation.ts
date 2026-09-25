import { apiGet } from "./apiClient";
import { formatNgn } from "./currency";

export interface GasEstimate {
  estimatedFee: string;
  confidence: "low" | "medium" | "high";
}

export interface GasBenchmark {
  functionName: string;
  avgCpuInstructions: number;
  avgMemoryBytes: number;
  avgTotalFee: string;
  sampleCount: number;
  p50Fee: string;
  p95Fee: string;
  p99Fee: string;
}

export interface FeeDisplay {
  estimatedFeeXlm: string;
  maxFeeXlm: string;
  estimatedFeeNgn: string;
  maxFeeNgn: string;
  confidence: GasEstimate["confidence"];
  isFallback: boolean;
}

const BUFFER_MULTIPLIERS: Record<GasEstimate["confidence"], number> = {
  low: 3,
  medium: 2,
  high: 1.3,
};

const FALLBACK_XLM_PRICE_NGN = 850;

export function computeBuffer(stroops: string, confidence: GasEstimate["confidence"]): string {
  const fee = Number(stroops);
  const multiplier = BUFFER_MULTIPLIERS[confidence] || 1.5;
  return String(Math.ceil(fee * multiplier));
}

export function stroopsToXlm(stroops: string): number {
  return Number(stroops) / 10_000_000;
}

export function estimateNgnEquivalent(xlm: number, xlmPriceNgn: number = FALLBACK_XLM_PRICE_NGN): string {
  return formatNgn(xlm * xlmPriceNgn);
}

export function formatFee(stroops: string): string {
  return `${stroopsToXlm(stroops).toFixed(4)} XLM`;
}

export async function estimateGas(
  functionName: string,
  complexity: "simple" | "moderate" | "complex" = "moderate"
): Promise<GasEstimate & { benchmark: GasBenchmark | null }> {
  try {
    const response = await apiGet<{
      success: boolean;
      functionName: string;
      estimate: GasEstimate;
      benchmark: GasBenchmark | null;
    }>(`/api/gas-metrics/estimate/${functionName}?complexity=${complexity}`);

    return {
      ...response.estimate,
      benchmark: response.benchmark,
    };
  } catch (error) {
    console.error("Failed to estimate gas:", error);
    return {
      estimatedFee: "1000000",
      confidence: "low",
      benchmark: null,
    };
  }
}

export async function getFeeDisplay(
  functionName: string,
  complexity: "simple" | "moderate" | "complex" = "moderate",
  xlmPriceNgn?: number,
): Promise<FeeDisplay> {
  const result = await estimateGas(functionName, complexity);
  const fallback = result.benchmark === null && result.confidence === "low";
  const buffer = computeBuffer(result.estimatedFee, result.confidence);
  const feeXlm = stroopsToXlm(result.estimatedFee);
  const maxXlm = stroopsToXlm(buffer);

  return {
    estimatedFeeXlm: `${feeXlm.toFixed(4)} XLM`,
    maxFeeXlm: `${maxXlm.toFixed(4)} XLM`,
    estimatedFeeNgn: estimateNgnEquivalent(feeXlm, xlmPriceNgn),
    maxFeeNgn: estimateNgnEquivalent(maxXlm, xlmPriceNgn),
    confidence: result.confidence,
    isFallback: fallback,
  };
}
