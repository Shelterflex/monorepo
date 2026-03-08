import { Request, Response, NextFunction } from 'express'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { logger } from '../utils/logger.js'
import { sessionStore, userStore } from '../models/authStore.js'

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string
    email: string
    name: string
    role: 'tenant' | 'landlord' | 'agent'
  }
}

export function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    logger.warn('Unauthorized access attempt - missing token', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      requestId: req.requestId,
      path: req.path
    })
    throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Authentication token required')
  }

  const session = sessionStore.getByToken(token)
  if (!session) {
    logger.warn('Unauthorized access attempt - invalid token', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      requestId: req.requestId,
      path: req.path,
      token: token.substring(0, 8) + '...'
    })
    throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid or expired token')
  }

  const user = userStore.getByEmail(session.email)
  if (!user) {
    logger.warn('Unauthorized access attempt - user not found', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      requestId: req.requestId,
      path: req.path,
      email: session.email
    })
    throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'User not found')
  }

  req.user = user
  logger.info('User authenticated successfully', {
    userId: user.id,
    email: user.email,
    requestId: req.requestId,
    path: req.path
  })
  
  next()
}
