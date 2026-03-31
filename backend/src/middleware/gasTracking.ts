import { Request, Response, NextFunction } from 'express'
import { gasAnalyzer, GasMetrics } from '../soroban/gas-analyzer.js'
import { logger } from '../utils/logger.js'

export interface GasTrackingContext {
  functionName: string
  startTime: number
}

declare global {
  namespace Express {
    interface Request {
      gasTracking?: GasTrackingContext
    }
  }
}

export function startGasTracking(functionName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    req.gasTracking = {
      functionName,
      startTime: Date.now(),
    }
    next()
  }
}

export function recordGasMetrics(
  cpuInstructions: number,
  memoryBytes: number,
  ledgerReadBytes: number,
  ledgerWriteBytes: number,
  totalFee: string
) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.gasTracking) {
      logger.warn('Gas tracking not initialized for request')
      return next()
    }

    const metrics: GasMetrics = {
      functionName: req.gasTracking.functionName,
      cpuInstructions,
      memoryBytes,
      ledgerReadBytes,
      ledgerWriteBytes,
      totalFee,
      timestamp: Date.now(),
    }

    gasAnalyzer.recordMetrics(metrics)

    // Log high-cost operations
    if (cpuInstructions > 10_000_000 || BigInt(totalFee) > 10_000_000n) {
      logger.warn('High-cost operation detected', {
        functionName: metrics.functionName,
        cpuInstructions,
        totalFee,
        requestId: req.requestId,
      })
    }

    next()
  }
}
