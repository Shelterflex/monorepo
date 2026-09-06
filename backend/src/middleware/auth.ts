import { Request, Response, NextFunction } from 'express'
import * as Sentry from '@sentry/node'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { logger } from '../utils/logger.js'
import { sessionStore, userStore } from '../models/authStore.js'

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string
    email: string
    name: string
    role: 'tenant' | 'landlord' | 'agent' | 'admin' | 'inspector' | 'super_admin'
    walletAddress?: string
    displayCurrency?: 'NGN' | 'USDC'
  }
}

export async function authenticateToken(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      logger.warn('Unauthorized access attempt - missing token', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        requestId: req.requestId,
        path: req.path,
      })
      next(new AppError(ErrorCode.UNAUTHORIZED, 401, 'Authentication token required'))
      return
    }

    const tokenState = await sessionStore.getTokenState(token)
    if (tokenState === 'expired') {
      logger.warn('Unauthorized access attempt - expired token', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        requestId: req.requestId,
        path: req.path,
      })
      next(new AppError(ErrorCode.TOKEN_EXPIRED, 401, 'Access token expired'))
      return
    }

    const session = tokenState === 'active' ? await sessionStore.getByToken(token) : undefined
    if (!session) {
      logger.warn('Unauthorized access attempt - invalid or expired token', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        requestId: req.requestId,
        path: req.path,
        token: token.substring(0, 8) + '...',
      })
      next(new AppError(ErrorCode.INVALID_TOKEN, 401, 'Invalid token'))
      return
    }

    const user = await userStore.getByEmail(session.email)
    if (!user) {
      logger.warn('Unauthorized access attempt - user not found', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        requestId: req.requestId,
        path: req.path,
        email: session.email,
      })
      next(new AppError(ErrorCode.UNAUTHORIZED, 401, 'User not found'))
      return
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      walletAddress: user.walletAddress,
      displayCurrency: user.displayCurrency,
    }
    
    // Attach userId and role to Sentry scope for error tracking
    if (process.env.SENTRY_DSN_BACKEND && process.env.NODE_ENV !== "test") {
      Sentry.setUser({
        id: user.id,
        role: user.role,
      });
    }
    
    logger.info('User authenticated successfully', {
      userId: user.id,
      email: user.email,
      requestId: req.requestId,
      path: req.path,
    })

    next()
  } catch (error) {
    next(error)
  }
}
