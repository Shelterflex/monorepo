import { rpc, xdr, BASE_FEE } from '@stellar/stellar-sdk'
import { logger } from '../utils/logger.js'

export interface GasMetrics {
  functionName: string
  cpuInstructions: number
  memoryBytes: number
  ledgerReadBytes: number
  ledgerWriteBytes: number
  totalFee: string
  timestamp: number
}

export interface GasOptimizationRecommendation {
  functionName: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  issue: string
  recommendation: string
  potentialSavings: string
}

export interface GasBenchmark {
  functionName: string
  avgCpuInstructions: number
  avgMemoryBytes: number
  avgTotalFee: string
  sampleCount: number
  p50Fee: string
  p95Fee: string
  p99Fee: string
}

const GAS_THRESHOLDS = {
  cpuInstructions: {
    low: 1_000_000,
    medium: 5_000_000,
    high: 10_000_000,
    critical: 20_000_000,
  },
  memoryBytes: {
    low: 10_000,
    medium: 50_000,
    high: 100_000,
    critical: 200_000,
  },
  totalFee: {
    low: 1_000_000, // 0.1 XLM
    medium: 5_000_000, // 0.5 XLM
    high: 10_000_000, // 1 XLM
    critical: 50_000_000, // 5 XLM
  },
}

export class GasAnalyzer {
  private metrics: Map<string, GasMetrics[]> = new Map()
  private benchmarks: Map<string, GasBenchmark> = new Map()

  recordMetrics(metrics: GasMetrics): void {
    const existing = this.metrics.get(metrics.functionName) || []
    existing.push(metrics)
    
    // Keep only last 1000 samples per function
    if (existing.length > 1000) {
      existing.shift()
    }
    
    this.metrics.set(metrics.functionName, existing)
    this.updateBenchmark(metrics.functionName)
  }

  private updateBenchmark(functionName: string): void {
    const samples = this.metrics.get(functionName)
    if (!samples || samples.length === 0) return

    const cpuInstructions = samples.map(m => m.cpuInstructions)
    const memoryBytes = samples.map(m => m.memoryBytes)
    const fees = samples.map(m => BigInt(m.totalFee))

    const avgCpu = cpuInstructions.reduce((a, b) => a + b, 0) / samples.length
    const avgMem = memoryBytes.reduce((a, b) => a + b, 0) / samples.length
    const avgFee = fees.reduce((a, b) => a + b, 0n) / BigInt(samples.length)

    const sortedFees = [...fees].sort((a, b) => Number(a - b))
    const p50 = sortedFees[Math.floor(samples.length * 0.5)]
    const p95 = sortedFees[Math.floor(samples.length * 0.95)]
    const p99 = sortedFees[Math.floor(samples.length * 0.99)]

    this.benchmarks.set(functionName, {
      functionName,
      avgCpuInstructions: Math.round(avgCpu),
      avgMemoryBytes: Math.round(avgMem),
      avgTotalFee: avgFee.toString(),
      sampleCount: samples.length,
      p50Fee: p50.toString(),
      p95Fee: p95.toString(),
      p99Fee: p99.toString(),
    })
  }

  getBenchmark(functionName: string): GasBenchmark | undefined {
    return this.benchmarks.get(functionName)
  }

  getAllBenchmarks(): GasBenchmark[] {
    return Array.from(this.benchmarks.values())
  }

  analyzeAndRecommend(functionName: string): GasOptimizationRecommendation[] {
    const benchmark = this.benchmarks.get(functionName)
    if (!benchmark) return []

    const recommendations: GasOptimizationRecommendation[] = []

    // CPU instruction analysis
    if (benchmark.avgCpuInstructions > GAS_THRESHOLDS.cpuInstructions.critical) {
      recommendations.push({
        functionName,
        severity: 'critical',
        issue: `Extremely high CPU usage: ${benchmark.avgCpuInstructions.toLocaleString()} instructions`,
        recommendation: 'Consider algorithmic optimization, reduce loops, or split into multiple transactions',
        potentialSavings: '60-80%',
      })
    } else if (benchmark.avgCpuInstructions > GAS_THRESHOLDS.cpuInstructions.high) {
      recommendations.push({
        functionName,
        severity: 'high',
        issue: `High CPU usage: ${benchmark.avgCpuInstructions.toLocaleString()} instructions`,
        recommendation: 'Optimize loops, use more efficient data structures, cache repeated calculations',
        potentialSavings: '30-50%',
      })
    } else if (benchmark.avgCpuInstructions > GAS_THRESHOLDS.cpuInstructions.medium) {
      recommendations.push({
        functionName,
        severity: 'medium',
        issue: `Moderate CPU usage: ${benchmark.avgCpuInstructions.toLocaleString()} instructions`,
        recommendation: 'Review algorithm efficiency, consider batch operations',
        potentialSavings: '15-30%',
      })
    }

    // Memory analysis
    if (benchmark.avgMemoryBytes > GAS_THRESHOLDS.memoryBytes.critical) {
      recommendations.push({
        functionName,
        severity: 'critical',
        issue: `Extremely high memory usage: ${(benchmark.avgMemoryBytes / 1024).toFixed(2)} KB`,
        recommendation: 'Reduce data structure size, use references instead of copies, paginate large datasets',
        potentialSavings: '50-70%',
      })
    } else if (benchmark.avgMemoryBytes > GAS_THRESHOLDS.memoryBytes.high) {
      recommendations.push({
        functionName,
        severity: 'high',
        issue: `High memory usage: ${(benchmark.avgMemoryBytes / 1024).toFixed(2)} KB`,
        recommendation: 'Optimize data structures, avoid unnecessary cloning',
        potentialSavings: '25-40%',
      })
    }

    // Fee analysis
    const avgFee = BigInt(benchmark.avgTotalFee)
    if (avgFee > GAS_THRESHOLDS.totalFee.critical) {
      recommendations.push({
        functionName,
        severity: 'critical',
        issue: `Prohibitively expensive: ${(Number(avgFee) / 10_000_000).toFixed(2)} XLM average`,
        recommendation: 'Major refactoring needed - consider off-chain computation or multi-step process',
        potentialSavings: '70-90%',
      })
    } else if (avgFee > GAS_THRESHOLDS.totalFee.high) {
      recommendations.push({
        functionName,
        severity: 'high',
        issue: `Very expensive: ${(Number(avgFee) / 10_000_000).toFixed(2)} XLM average`,
        recommendation: 'Implement batch operations, reduce storage operations',
        potentialSavings: '40-60%',
      })
    }

    return recommendations
  }

  estimateGasForOperation(
    functionName: string,
    complexity: 'simple' | 'moderate' | 'complex' = 'moderate'
  ): { estimatedFee: string; confidence: 'low' | 'medium' | 'high' } {
    const benchmark = this.benchmarks.get(functionName)
    
    if (!benchmark || benchmark.sampleCount < 10) {
      // No data, use conservative estimates
      const baseEstimates = {
        simple: 100_000n,
        moderate: 500_000n,
        complex: 2_000_000n,
      }
      return {
        estimatedFee: baseEstimates[complexity].toString(),
        confidence: 'low',
      }
    }

    // Use P95 for estimation to be conservative
    const confidence = benchmark.sampleCount > 100 ? 'high' : 'medium'
    
    return {
      estimatedFee: benchmark.p95Fee,
      confidence,
    }
  }

  exportMetrics(): string {
    const data = {
      benchmarks: Array.from(this.benchmarks.values()),
      recommendations: Array.from(this.benchmarks.keys())
        .flatMap(fn => this.analyzeAndRecommend(fn)),
      timestamp: new Date().toISOString(),
    }
    return JSON.stringify(data, null, 2)
  }

  clearMetrics(): void {
    this.metrics.clear()
    this.benchmarks.clear()
  }
}

export const gasAnalyzer = new GasAnalyzer()
