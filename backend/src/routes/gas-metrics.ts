import { Router, type Request, type Response } from 'express'
import { gasAnalyzer } from '../soroban/gas-analyzer.js'
import { authenticateToken } from '../middleware/auth.js'
import { logger } from '../utils/logger.js'

export function createGasMetricsRouter(): Router {
  const router = Router()

  /**
   * GET /api/gas-metrics/benchmarks
   * Returns gas benchmarks for all contract functions
   */
  router.get('/benchmarks', authenticateToken, async (req: Request, res: Response) => {
    try {
      const benchmarks = gasAnalyzer.getAllBenchmarks()
      
      res.json({
        success: true,
        benchmarks,
        count: benchmarks.length,
      })
    } catch (error) {
      logger.error('Failed to fetch gas benchmarks', { error })
      res.status(500).json({
        success: false,
        error: 'Failed to fetch gas benchmarks',
      })
    }
  })

  /**
   * GET /api/gas-metrics/recommendations
   * Returns optimization recommendations for all functions
   */
  router.get('/recommendations', authenticateToken, async (req: Request, res: Response) => {
    try {
      const benchmarks = gasAnalyzer.getAllBenchmarks()
      const recommendations = benchmarks.flatMap(b => 
        gasAnalyzer.analyzeAndRecommend(b.functionName)
      )

      // Group by severity
      const grouped = {
        critical: recommendations.filter(r => r.severity === 'critical'),
        high: recommendations.filter(r => r.severity === 'high'),
        medium: recommendations.filter(r => r.severity === 'medium'),
        low: recommendations.filter(r => r.severity === 'low'),
      }

      res.json({
        success: true,
        recommendations: grouped,
        totalCount: recommendations.length,
      })
    } catch (error) {
      logger.error('Failed to fetch gas recommendations', { error })
      res.status(500).json({
        success: false,
        error: 'Failed to fetch gas recommendations',
      })
    }
  })

  /**
   * GET /api/gas-metrics/estimate/:functionName
   * Estimates gas cost for a specific function
   */
  router.get('/estimate/:functionName', async (req: Request, res: Response) => {
    try {
      const { functionName } = req.params
      const complexity = (req.query.complexity as 'simple' | 'moderate' | 'complex') || 'moderate'

      const estimate = gasAnalyzer.estimateGasForOperation(functionName, complexity)
      const benchmark = gasAnalyzer.getBenchmark(functionName)

      res.json({
        success: true,
        functionName,
        estimate,
        benchmark: benchmark || null,
      })
    } catch (error) {
      logger.error('Failed to estimate gas', { error, functionName: req.params.functionName })
      res.status(500).json({
        success: false,
        error: 'Failed to estimate gas',
      })
    }
  })

  /**
   * GET /api/gas-metrics/export
   * Exports all metrics as JSON
   */
  router.get('/export', authenticateToken, async (req: Request, res: Response) => {
    try {
      const metrics = gasAnalyzer.exportMetrics()
      
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Content-Disposition', `attachment; filename="gas-metrics-${Date.now()}.json"`)
      res.send(metrics)
    } catch (error) {
      logger.error('Failed to export gas metrics', { error })
      res.status(500).json({
        success: false,
        error: 'Failed to export gas metrics',
      })
    }
  })

  return router
}
