import type { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import { AppError } from '../errors/AppError.js'
import { ErrorCode, classifyError, type ErrorResponse } from '../errors/errorCodes.js'
import { formatZodIssues } from '../errors/utils.js'

const isProduction = process.env.NODE_ENV === 'production'

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = req.requestId

  /**
   * Centralized response sender
   */
  const send = (status: number, body: ErrorResponse) => {
    const classification = classifyError(body.error.code)
    const retryable = classification === 'transient'

    // Add Retry-After header for transient/rate-limit errors
    if (retryable && !res.getHeader('retry-after')) {
      res.setHeader('Retry-After', '5')
    }

    res
      .status(status)
      .setHeader('x-request-id', requestId)
      .json({
        ...body,
        error: {
          ...body.error,
          classification,
          retryable,
        },
      })
  }

  /**
   * 1️⃣ Controlled domain error
   */
  if (err instanceof AppError) {
    send(err.status, {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    })
    return
  }

  /**
   * 2️⃣ Zod validation error
   */
  if (err instanceof ZodError) {
    send(400, {
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Invalid request data',
        details: formatZodIssues(err.issues),
      },
    })
    return
  }

  /**
   * 3️⃣ Malformed JSON body
   */
  if (err instanceof SyntaxError && 'body' in err) {
    send(400, {
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Malformed JSON in request body',
      },
    })
    return
  }

  /**
   * 4️⃣ Unknown / Unhandled Error
   */
  const safeMessage = 'An unexpected error occurred'

  // Structured logging (never log secrets)
  console.error(
    JSON.stringify({
      level: 'error',
      requestId,
      message: 'Unhandled error',
      errorName: err instanceof Error ? err.name : 'Unknown',
      errorMessage: err instanceof Error ? err.message : String(err),
      stack: !isProduction && err instanceof Error ? err.stack : undefined,
      path: req.originalUrl,
      method: req.method,
      timestamp: new Date().toISOString(),
    }),
  )

  send(500, {
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: isProduction
        ? safeMessage
        : err instanceof Error
        ? err.message
        : safeMessage,
    },
  })
}