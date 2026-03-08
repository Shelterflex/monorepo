import { Request, Response, NextFunction } from 'express'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { logger } from '../utils/logger.js'
import { env } from '../schemas/env.js'

export function requireCustodialMode(req: Request, res: Response, next: NextFunction) {
  if (!env.CUSTODIAL_MODE_ENABLED) {
    logger.warn('Custodial mode disabled - access denied', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      requestId: req.requestId,
      path: req.path
    })
    throw new AppError(ErrorCode.FORBIDDEN, 403, 'Custodial mode is disabled')
  }
  
  next()
}

export function requireSigningEnabled(req: Request, res: Response, next: NextFunction) {
  if (env.CUSTODIAL_SIGNING_PAUSED) {
    logger.warn('Custodial signing paused - access denied', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      requestId: req.requestId,
      path: req.path
    })
    throw new AppError(ErrorCode.FORBIDDEN, 403, 'Custodial signing is temporarily paused')
  }
  
  next()
}
