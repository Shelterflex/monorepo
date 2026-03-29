/**
 * Secret Rotation Middleware
 * 
 * Integrates secret rotation service with Express application
 * Provides endpoints for managing secret rotation
 */

import { Request, Response, NextFunction, Router } from 'express';
import { logger } from '../utils/logger.js';
import { getSecretRotationService, SecretConfig } from '../services/secretRotationService.js';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/errorCodes.js';


/**
 * Middleware to attach secret rotation service to request
 */
export function secretRotationMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.secretRotation = getSecretRotationService();
  next();
}

/**
 * Create admin router for secret rotation management
 */
export function createSecretRotationRouter(): Router {
  const router = Router();
  const service = getSecretRotationService();

  /**
   * GET /api/admin/secrets/status
   * Get status of all managed secrets
   */
  router.get('/status', (req: Request, res: Response) => {
    const status = service.getStatus();
    res.json({
      success: true,
      data: status,
    });
  });

  /**
   * GET /api/admin/secrets/history
   * Get rotation history
   */
  router.get('/history', (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string) || 100;
    const history = service.getRotationHistory(limit);
    res.json({
      success: true,
      data: history,
    });
  });

  /**
   * POST /api/admin/secrets/rotate
   * Manually trigger secret rotation
   */
  router.post('/rotate', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { secretName, newValue, gracePeriodMs } = req.body;

      if (!secretName || !newValue) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          400,
          'secretName and newValue are required'
        );
      }

      const success = await service.rotateSecret(secretName, newValue, { gracePeriodMs });

      if (!success) {
        throw new AppError(
          ErrorCode.INTERNAL_ERROR,
          500,
          `Failed to rotate secret: ${secretName}`
        );
      }

      res.json({
        success: true,
        message: `Secret ${secretName} rotated successfully`,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/admin/secrets/reload
   * Force reload secrets from environment
   */
  router.post('/reload', async (req: Request, res: Response, next: NextFunction) => {
    try {
      await service.reloadFromEnvironment();
      res.json({
        success: true,
        message: 'Secrets reloaded from environment',
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

/**
 * Initialize secret rotation for the application
 */
export function initializeAppSecretRotation(): void {
  const service = getSecretRotationService();

  // Register all application secrets
  const secretConfigs: SecretConfig[] = [
    {
      name: 'webhook_secret',
      envVar: 'WEBHOOK_SECRET',
      required: process.env.NODE_ENV === 'production',
      validator: (value) => value.length >= 32,
      gracePeriodMs: 300000, // 5 minutes
    },
    {
      name: 'paystack_secret',
      envVar: 'PAYSTACK_SECRET',
      required: process.env.NODE_ENV === 'production',
      validator: (value) => value.startsWith('sk_'),
      gracePeriodMs: 600000, // 10 minutes
    },
    {
      name: 'flutterwave_secret',
      envVar: 'FLUTTERWAVE_SECRET',
      required: process.env.NODE_ENV === 'production',
      gracePeriodMs: 600000, // 10 minutes
    },
    {
      name: 'manual_admin_secret',
      envVar: 'MANUAL_ADMIN_SECRET',
      required: process.env.NODE_ENV === 'production',
      validator: (value) => value.length >= 32,
      gracePeriodMs: 300000, // 5 minutes
    },
    {
      name: 'resend_api_key',
      envVar: 'RESEND_API_KEY',
      required: process.env.OTP_DELIVERY_PROVIDER === 'email',
      validator: (value) => value.startsWith('re_'),
      gracePeriodMs: 300000, // 5 minutes
    },
    {
      name: 'encryption_key',
      envVar: 'ENCRYPTION_KEY',
      required: true,
      validator: (value) => value.length >= 32,
      gracePeriodMs: 900000, // 15 minutes - longer for encryption keys
    },
    {
      name: 'custodial_wallet_master_key_v1',
      envVar: 'CUSTODIAL_WALLET_MASTER_KEY_V1',
      required: process.env.NODE_ENV === 'production',
      validator: (value) => {
        try {
          const decoded = Buffer.from(value, 'base64');
          return decoded.length === 32; // Must be 32 bytes for AES-256
        } catch {
          return false;
        }
      },
      gracePeriodMs: 1800000, // 30 minutes - very long for wallet keys
    },
    {
      name: 'custodial_wallet_master_key_v2',
      envVar: 'CUSTODIAL_WALLET_MASTER_KEY_V2',
      required: false,
      validator: (value) => {
        try {
          const decoded = Buffer.from(value, 'base64');
          return decoded.length === 32;
        } catch {
          return false;
        }
      },
      gracePeriodMs: 1800000, // 30 minutes
    },
    {
      name: 'soroban_admin_secret',
      envVar: 'SOROBAN_ADMIN_SECRET',
      required: process.env.SOROBAN_ADMIN_SIGNING_ENABLED === 'true',
      validator: (value) => value.startsWith('S') && value.length === 56, // Stellar secret key format
      gracePeriodMs: 600000, // 10 minutes
    },
  ];

  // Register all secrets
  secretConfigs.forEach(config => service.registerSecret(config));

  // Start watching for changes
  service.startWatching();

  // Log rotation events
  service.on('secretRotated', (event) => {
    logger.info('Secret rotated', {
      secretName: event.secretName,
      oldVersion: event.oldVersion,
      newVersion: event.newVersion,
      gracePeriodMs: event.gracePeriodMs,
    });
  });

  logger.info('Secret rotation service initialized');
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      secretRotation?: ReturnType<typeof getSecretRotationService>;
    }
  }
}
