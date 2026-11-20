import { Router, Request, Response } from 'express'
import { authenticateToken } from '../middleware/auth.js'
import { requireFlag } from '../middleware/requireFlag.js'
import { getGovernanceStore } from '../models/governanceStore.js'
import { linkedAddressStore } from '../models/linkedAddressStore.js'
import {
  listProposalsSchema,
  createProposalSchema,
  voteSchema,
} from '../schemas/governance.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'

const router = Router()
const store = getGovernanceStore()

/**
 * GET /api/v1/governance/proposals
 * List governance proposals
 *
 * @authenticated
 * @requireFlag GOVERNANCE_ENABLED
 */
router.get(
  '/proposals',
  authenticateToken,
  requireFlag('GOVERNANCE_ENABLED'),
  async (req: Request, res: Response, next) => {
    try {
      const { status, page = 1, limit = 20 } = req.query

      const validatedData = listProposalsSchema.parse({
        status: status as string | undefined,
        page: parseInt(page as string, 10),
        limit: parseInt(limit as string, 10),
      })

      const { proposals, total } = await store.listProposals(
        validatedData.status,
        validatedData.page,
        validatedData.limit,
      )

      res.json({
        success: true,
        data: {
          proposals,
          pagination: {
            page: validatedData.page,
            limit: validatedData.limit,
            total,
            pages: Math.ceil(total / validatedData.limit),
          },
        },
      })
    } catch (error) {
      next(error)
    }
  },
)

/**
 * GET /api/v1/governance/proposals/:id
 * Get a specific proposal
 *
 * @authenticated
 * @requireFlag GOVERNANCE_ENABLED
 */
router.get(
  '/proposals/:id',
  authenticateToken,
  requireFlag('GOVERNANCE_ENABLED'),
  async (req: Request, res: Response, next) => {
    try {
      const { id } = req.params
      const proposal = await store.getProposal(id)

      if (!proposal) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, 'Proposal not found')
      }

      res.json({
        success: true,
        data: proposal,
      })
    } catch (error) {
      next(error)
    }
  },
)

/**
 * POST /api/v1/governance/proposals/prepare
 * Prepare an unsigned proposal creation transaction
 *
 * @authenticated - user with linked wallet
 * @requireFlag GOVERNANCE_ENABLED
 */
router.post(
  '/proposals/prepare',
  authenticateToken,
  requireFlag('GOVERNANCE_ENABLED'),
  async (req: Request, res: Response, next) => {
    try {
      const userId = (req as any).user?.userId
      if (!userId) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'User not authenticated')
      }

      const userWallet = await linkedAddressStore.getLinkedAddress(userId)
      if (!userWallet) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          403,
          'User must link a wallet to create proposals',
        )
      }

      const validatedData = createProposalSchema.parse(req.body)
      const { xdr } = await store.createProposalTransaction(userId, validatedData)

      res.json({
        success: true,
        data: { xdr },
      })
    } catch (error) {
      next(error)
    }
  },
)

/**
 * POST /api/v1/governance/proposals/submit
 * Submit a signed proposal creation transaction
 *
 * @authenticated
 * @requireFlag GOVERNANCE_ENABLED
 */
router.post(
  '/proposals/submit',
  authenticateToken,
  requireFlag('GOVERNANCE_ENABLED'),
  async (req: Request, res: Response, next) => {
    try {
      const userId = (req as any).user?.userId
      if (!userId) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'User not authenticated')
      }

      const { signedXdr } = req.body
      if (!signedXdr) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          400,
          'signedXdr is required',
        )
      }

      const result = await store.submitProposalTransaction(userId, signedXdr)

      res.status(201).json({
        success: true,
        data: result,
      })
    } catch (error) {
      next(error)
    }
  },
)

/**
 * POST /api/v1/governance/proposals/:id/vote/prepare
 * Prepare an unsigned vote transaction
 *
 * @authenticated - user with linked wallet
 * @requireFlag GOVERNANCE_ENABLED
 */
router.post(
  '/proposals/:id/vote/prepare',
  authenticateToken,
  requireFlag('GOVERNANCE_ENABLED'),
  async (req: Request, res: Response, next) => {
    try {
      const userId = (req as any).user?.userId
      const { id: proposalId } = req.params

      if (!userId) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'User not authenticated')
      }

      const userWallet = await linkedAddressStore.getLinkedAddress(userId)
      if (!userWallet) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          403,
          'User must link a wallet to vote',
        )
      }

      const validatedData = voteSchema.parse(req.body)
      const { xdr } = await store.createVoteTransaction(
        userId,
        proposalId,
        validatedData.support,
      )

      res.json({
        success: true,
        data: { xdr },
      })
    } catch (error) {
      next(error)
    }
  },
)

/**
 * POST /api/v1/governance/proposals/:id/vote/submit
 * Submit a signed vote transaction
 *
 * @authenticated
 * @requireFlag GOVERNANCE_ENABLED
 */
router.post(
  '/proposals/:id/vote/submit',
  authenticateToken,
  requireFlag('GOVERNANCE_ENABLED'),
  async (req: Request, res: Response, next) => {
    try {
      const userId = (req as any).user?.userId
      const { id: proposalId } = req.params

      if (!userId) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'User not authenticated')
      }

      const { signedXdr } = req.body
      if (!signedXdr) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          400,
          'signedXdr is required',
        )
      }

      await store.submitVoteTransaction(userId, signedXdr)

      res.json({
        success: true,
        message: 'Vote submitted',
      })
    } catch (error) {
      next(error)
    }
  },
)

/**
 * POST /api/v1/governance/proposals/:id/finalize
 * Finalize proposal voting
 *
 * @authenticated - admin
 * @requireFlag GOVERNANCE_ENABLED
 */
router.post(
  '/proposals/:id/finalize',
  authenticateToken,
  requireFlag('GOVERNANCE_ENABLED'),
  async (req: Request, res: Response, next) => {
    try {
      const { id: proposalId } = req.params
      await store.finalizeProposal(proposalId)

      res.json({
        success: true,
        message: 'Proposal finalized',
      })
    } catch (error) {
      next(error)
    }
  },
)

/**
 * POST /api/v1/governance/proposals/:id/execute
 * Execute an approved proposal
 *
 * @authenticated - admin
 * @requireFlag GOVERNANCE_ENABLED
 */
router.post(
  '/proposals/:id/execute',
  authenticateToken,
  requireFlag('GOVERNANCE_ENABLED'),
  async (req: Request, res: Response, next) => {
    try {
      const { id: proposalId } = req.params
      await store.executeProposal(proposalId)

      res.json({
        success: true,
        message: 'Proposal executed',
      })
    } catch (error) {
      next(error)
    }
  },
)

export function createGovernanceRouter() {
  return router
}
