/**
 * Contract Events Routes
 * Query routes for indexed Soroban contract events
 */

import { Router, type Request, type Response, type NextFunction } from 'express'
import { getPool } from '../db.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { assertAdminSecret } from '../middleware/adminSecret.js'
import { logger } from '../utils/logger.js'

const router = Router()

/**
 * GET /api/admin/contract-events
 * Paginated event list with filters: contract, event type, date range
 */
router.get('/admin/contract-events', async (req: Request, res: Response, next: NextFunction) => {
  try {
    assertAdminSecret(req)

    const { contract, eventType, startDate, endDate, page = '1', pageSize = '20' } = req.query

    const pool = await getPool()
    if (!pool) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, 500, 'Database not available')
    }

    const pageNum = parseInt(page as string, 10)
    const pageSizeNum = parseInt(pageSize as string, 10)
    const offset = (pageNum - 1) * pageSizeNum

    const whereConditions: string[] = []
    const values: unknown[] = []
    let paramIndex = 1

    if (contract) {
      whereConditions.push(`contract_id = $${paramIndex++}`)
      values.push(contract)
    }

    if (eventType) {
      whereConditions.push(`event_type = $${paramIndex++}`)
      values.push(eventType)
    }

    if (startDate) {
      whereConditions.push(`indexed_at >= $${paramIndex++}`)
      values.push(new Date(startDate as string))
    }

    if (endDate) {
      whereConditions.push(`indexed_at <= $${paramIndex++}`)
      values.push(new Date(endDate as string))
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : ''

    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*) as count FROM indexed_contract_events ${whereClause}`,
      values
    )
    const total = parseInt(countResult.rows[0].count, 10)

    // Get paginated events
    const dataResult = await pool.query(
      `SELECT * FROM indexed_contract_events 
       ${whereClause}
       ORDER BY indexed_at DESC, ledger_sequence DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...values, pageSizeNum, offset]
    )

    const totalPages = Math.ceil(total / pageSizeNum)

    res.json({
      success: true,
      data: {
        events: dataResult.rows.map((row: any) => ({
          id: row.id,
          contractId: row.contract_id,
          ledgerSequence: parseInt(row.ledger_sequence),
          transactionHash: row.transaction_hash,
          eventType: row.event_type,
          topic1: row.topic_1,
          topic2: row.topic_2,
          dataJson: row.data_json,
          indexedAt: row.indexed_at,
          createdAt: row.created_at,
        })),
        pagination: {
          total,
          page: pageNum,
          pageSize: pageSizeNum,
          totalPages,
        },
      },
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/deals/:dealId/on-chain-events
 * Events related to a specific deal (filter by topic_1 = dealId)
 */
router.get('/deals/:dealId/on-chain-events', async (req: Request, res: Response, next: NextFunction) => {
  try {
    assertAdminSecret(req)

    const { dealId } = req.params

    if (!dealId) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Deal ID is required')
    }

    const pool = await getPool()
    if (!pool) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, 500, 'Database not available')
    }

    // Fetch events where topic_1 matches dealId
    const result = await pool.query(
      `SELECT * FROM indexed_contract_events 
       WHERE topic_1 = $1 OR data_json->>'dealId' = $1
       ORDER BY indexed_at DESC, ledger_sequence DESC
       LIMIT 100`,
      [dealId]
    )

    res.json({
      success: true,
      data: {
        dealId,
        events: result.rows.map((row: any) => ({
          id: row.id,
          contractId: row.contract_id,
          ledgerSequence: parseInt(row.ledger_sequence),
          transactionHash: row.transaction_hash,
          eventType: row.event_type,
          topic1: row.topic_1,
          topic2: row.topic_2,
          dataJson: row.data_json,
          indexedAt: row.indexed_at,
          createdAt: row.created_at,
        })),
      },
    })
  } catch (error) {
    next(error)
  }
})

export function createContractEventsRouter(): Router {
  return router
}
