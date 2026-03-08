import { Router, type Request, type Response, type NextFunction } from 'express'
import { validate } from '../middleware/validate.js'
import { WalletService } from '../services/walletService.js'
import { 
  walletAddressResponseSchema,
  walletCreationResponseSchema,
  signMessageRequestSchema,
  signMessageResponseSchema,
  signTransactionRequestSchema,
  signTransactionResponseSchema
} from '../schemas/wallet.js'
import { logger } from '../utils/logger.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.js'
import { requireCustodialMode, requireSigningEnabled } from '../middleware/custodial.js'

export function createWalletRouter(walletService: WalletService): Router {
  const router = Router()

  /**
   * GET /api/wallet/address
   * Returns the public wallet address for the authenticated user
   */
  router.get('/address', authenticateToken, requireCustodialMode, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id
      
      logger.info('Getting wallet address', { userId, requestId: req.requestId })
      
      const address = await walletService.getPublicAddress(userId)
      
      const response = {
        success: true,
        address,
      }
      
      logger.info('Wallet address retrieved', { userId, address, requestId: req.requestId })
      res.json(walletAddressResponseSchema.parse(response))
    } catch (error) {
      if (error instanceof Error && error.message.includes('Wallet not found')) {
        throw new AppError(
          ErrorCode.UNAUTHORIZED,
          401,
          'User wallet not found'
        )
      }
      next(error)
    }
  })

  /**
   * POST /api/wallet/create
   * Creates a new wallet for the user (if one doesn't exist)
   * This would typically be called after first successful OTP login
   */
  router.post('/create', authenticateToken, requireCustodialMode, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id

      logger.info('Creating wallet for user', { userId, requestId: req.requestId })
      
      const { publicKey } = await walletService.createWalletForUser(userId)
      
      const response = {
        success: true,
        address: publicKey,
      }
      
      logger.info('Wallet created successfully', { userId, address: publicKey, requestId: req.requestId })
      res.status(201).json(walletCreationResponseSchema.parse(response))
    } catch (error) {
      next(error)
    }
  })

  /**
   * POST /api/wallet/sign-message
   * Signs a message with the user's private key
   */
  router.post(
    '/sign-message',
    authenticateToken,
    requireCustodialMode,
    requireSigningEnabled,
    validate(signMessageRequestSchema, 'body'),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const userId = req.user!.id
        const { message } = req.body
        
        logger.info('Signing message', { userId, messageLength: message.length, requestId: req.requestId })
        
        const result = await walletService.signMessage(userId, message)
        
        const response = {
          success: true,
          signature: result.signature,
          publicKey: result.publicKey,
        }
        
        logger.info('Message signed successfully', { userId, requestId: req.requestId })
        res.json(signMessageResponseSchema.parse(response))
      } catch (error) {
        next(error)
      }
    }
  )

  /**
   * POST /api/wallet/sign-transaction
   * Signs a Soroban transaction with the user's private key
   */
  router.post(
    '/sign-transaction',
    authenticateToken,
    requireCustodialMode,
    requireSigningEnabled,
    validate(signTransactionRequestSchema, 'body'),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const userId = req.user!.id
        const { xdr } = req.body
        
        logger.info('Signing transaction', { userId, xdrLength: xdr.length, requestId: req.requestId })
        
        const result = await walletService.signSorobanTransaction(userId, xdr)
        
        const response = {
          success: true,
          signature: result.signature,
          publicKey: result.publicKey,
        }
        
        logger.info('Transaction signed successfully', { userId, requestId: req.requestId })
        res.json(signTransactionResponseSchema.parse(response))
      } catch (error) {
        next(error)
      }
    }
  )

  return router
}
