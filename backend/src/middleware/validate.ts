import { ZodSchema } from 'zod'
import { Request, Response, NextFunction } from 'express'
import { ErrorCode, type ErrorResponse } from '../errors/index.js'
import { formatZodIssues } from '../errors/utils.js'
import { logger } from '../utils/logger.js'

type ValidateTarget = 'body' | 'query' | 'params'

export const validate =
  (schema: ZodSchema, target: ValidateTarget = 'body') =>
  (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[target])

    if (!result.success) {
      const requestId = (req as any).id || 'unknown'
      const issues = formatZodIssues(result.error.issues, target)

      // Log validation failures with structured context
      logger.warn(`Request validation failed`, {
        requestId,
        path: req.path,
        method: req.method,
        target,
        endpoint: `${req.method} ${req.path}`,
        validationErrors: issues,
      })

      const body: ErrorResponse = {
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Invalid request data',
          details: issues,
        },
      }
      return res.status(400).json(body)
    }

    // Assign the coerced/defaulted data back so handlers see clean types
    ;(req as unknown as Record<string, unknown>)[target] = result.data
    next()
  }