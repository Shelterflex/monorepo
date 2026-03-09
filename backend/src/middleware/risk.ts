import { Response, NextFunction } from 'express'
import { AuthenticatedRequest } from './auth.js'
import { userRiskStateStore } from '../models/userRiskStateStore.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { logger } from '../utils/logger.js'

/**
 * Middleware to check if user account is frozen
 * Blocks risky operations (withdrawals, staking) for frozen accounts
 */
export async function requireNotFrozen(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user?.id
    if (!userId) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'User not authenticated')
    }

    const riskState = await userRiskStateStore.getByUserId(userId)
    
    if (riskState?.isFrozen) {
      let message = 'Account frozen. '
      
      if (riskState.freezeReason === 'NEGATIVE_BALANCE') {
        message += 'Negative balance detected. Please top up to continue.'
      } else if (riskState.freezeReason === 'MANUAL') {
        message += 'Manual freeze by admin. Contact support.'
      } else if (riskState.freezeReason === 'COMPLIANCE') {
        message += 'Compliance review required. Contact support.'
      }

      logger.warn('Frozen account attempted restricted operation', {
        userId,
        freezeReason: riskState.freezeReason,
        path: req.path,
        requestId: req.requestId,
      })

      throw new AppError(ErrorCode.ACCOUNT_FROZEN, 403, message)
    }

    next()
  } catch (error) {
    next(error)
  }
}
