import { apiClient } from "./api-client";

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

export async function estimateGas(
  functionName: string,
  complexity: "simple" | "moderate" | "complex" = "moderate"
): Promise<GasEstimate & { benchmark: GasBenchmark | null }> {
  try {
    const response = await apiClient.get<{
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
    // Return conservative estimate on error
    return {
      estimatedFee: "1000000",
      confidence: "low",
      benchmark: null,
    };
  }
}

export function formatFee(stroops: string): string {
  const xlm = Number(stroops) / 10_000_000;
  return `${xlm.toFixed(4)} XLM`;
}
