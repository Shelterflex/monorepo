/**
 * Secret Rotation Service
 * 
 * Provides zero-downtime secret rotation with:
 * - Hot-reloading from environment or secret store
 * - Graceful transition between old and new secrets
 * - Audit logging of rotation events
 * - Automatic fallback on failure
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';

export interface SecretVersion {
  value: string;
  version: string;
  activatedAt: Date;
  expiresAt?: Date;
}

export interface SecretRotationEvent {
  secretName: string;
  oldVersion: string;
  newVersion: string;
  timestamp: Date;
  success: boolean;
  error?: string;
  actor?: string;
  scope?: string;
  transitionWindowMs?: number;
}

export interface SecretConfig {
  name: string;
  envVar: string;
  required: boolean;
  validator?: (value: string) => boolean;
  gracePeriodMs?: number; // Time to keep old secret active after rotation
  rotationIntervalMs?: number; // How often to automatically rotate
  generator?: () => string; // Function to generate a new secret
}

/**
 * Secret Rotation Service
 * Manages hot-reloading and rotation of secrets with zero downtime
 */
export class SecretRotationService extends EventEmitter {
  private scheduledRotations: Map<string, NodeJS.Timeout> = new Map();
  private secrets: Map<string, SecretVersion[]> = new Map();
  private activeVersions: Map<string, string> = new Map();
  private rotationHistory: SecretRotationEvent[] = [];
  private watchIntervalMs: number;
  private watchInterval?: NodeJS.Timeout;
  private secretConfigs: Map<string, SecretConfig> = new Map();

  constructor(watchIntervalMs: number = 30000) {
    super();
    this.watchIntervalMs = watchIntervalMs;
  }

  /**
   * Register a secret for rotation management
   */
  registerSecret(config: SecretConfig): void {
    this.secretConfigs.set(config.name, config);

    // Initialize with current environment value
    const currentValue = process.env[config.envVar];
    if (currentValue) {
      this.secrets.set(config.name, [{
        value: currentValue,
        version: 'v1',
        activatedAt: new Date(),
      }]);
      this.activeVersions.set(config.name, 'v1');
      logger.info(`Registered secret: ${config.name}`);
    } else if (config.required) {
      logger.warn(`Required secret ${config.name} not found in environment`);
    }

    // Schedule automated rotation if interval and generator are present
    if (config.rotationIntervalMs && config.generator) {
      this.scheduleAutoRotation(config.name);
    }
  }

  /**
   * Get the currently active secret value
   */
  getSecret(name: string): string | undefined {
    const activeVersion = this.activeVersions.get(name);
    if (!activeVersion) return undefined;

    const versions = this.secrets.get(name);
    if (!versions) return undefined;

    const active = versions.find(v => v.version === activeVersion);
    return active?.value;
  }

  /**
   * Get all valid versions of a secret (active + grace period)
   */
  getValidSecretVersions(name: string): string[] {
    const versions = this.secrets.get(name);
    if (!versions) return [];

    const now = new Date();
    return versions
      .filter(v => !v.expiresAt || v.expiresAt > now)
      .map(v => v.value);
  }

  /**
   * Rotate a secret to a new value
   */
  async rotateSecret(
    name: string,
    newValue: string,
    options: { gracePeriodMs?: number; version?: string; actor?: string; scope?: string } = {}
  ): Promise<boolean> {
    const config = this.secretConfigs.get(name);
    if (!config) {
      logger.error(`Cannot rotate unregistered secret: ${name}`);
      return false;
    }

    // Validate new secret
    if (config.validator && !config.validator(newValue)) {
      const error = `New secret value for ${name} failed validation`;
      logger.error(error);
      logger.error(`ALERT: Secret validation failed for slot ${name}. Halting transition.`);
      this.logRotationEvent(name, 'unknown', 'unknown', false, error, options.actor, options.scope, config.gracePeriodMs);
      return false;
    }

    const oldVersion = this.activeVersions.get(name) || 'none';
    const newVersion = options.version || `v${Date.now()}`;
    const gracePeriodMs = options.gracePeriodMs ?? config.gracePeriodMs ?? 300000; // 5 min default

    try {
      // Get existing versions
      const versions = this.secrets.get(name) || [];

      // Mark old versions for expiration
      const now = new Date();
      const expiresAt = new Date(now.getTime() + gracePeriodMs);
      versions.forEach(v => {
        if (!v.expiresAt) {
          v.expiresAt = expiresAt;
        }
      });

      // Add new version
      versions.push({
        value: newValue,
        version: newVersion,
        activatedAt: now,
      });

      // Update active version
      this.secrets.set(name, versions);
      this.activeVersions.set(name, newVersion);

      // Emit rotation event
      this.emit('secretRotated', {
        secretName: name,
        oldVersion,
        newVersion,
        gracePeriodMs,
      });

      logger.info(`Secret rotated successfully: ${name} (${oldVersion} → ${newVersion})`);
      this.logRotationEvent(name, oldVersion, newVersion, true, undefined, options.actor, options.scope, gracePeriodMs);

      // Schedule cleanup of expired versions
      setTimeout(() => this.cleanupExpiredVersions(name), gracePeriodMs + 1000);

      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to rotate secret ${name}:`, {}, error);
      logger.error(`ALERT: Secret rotation failed for slot ${name}. Halting transition.`);
      this.logRotationEvent(name, oldVersion, newVersion, false, errorMsg, options.actor, options.scope, gracePeriodMs);
      return false;
    }
  }

  /**
   * Attempt to use a secret, with automatic fallback
   */
  async tryWithSecret<T>(
    name: string,
    operation: (secret: string) => Promise<T>
  ): Promise<T> {
    const validVersions = this.getValidSecretVersions(name);

    if (validVersions.length === 0) {
      throw new Error(`No valid versions available for secret: ${name}`);
    }

    // Try with active version first
    const activeSecret = this.getSecret(name);
    if (activeSecret) {
      try {
        return await operation(activeSecret);
      } catch (error) {
        logger.warn(`Operation failed with active secret ${name}, trying fallback versions`);
      }
    }

    // Try with other valid versions (fallback)
    for (const secretValue of validVersions) {
      if (secretValue === activeSecret) continue; // Already tried

      try {
        logger.info(`Attempting fallback with older version of ${name}`);
        const result = await operation(secretValue);
        logger.info(`Fallback successful for ${name}`);
        return result;
      } catch (error) {
        logger.warn(`Fallback attempt failed for ${name}`);
      }
    }

    throw new Error(`All secret versions failed for: ${name}`);
  }

  /**
   * Start watching for secret changes
   */
  startWatching(): void {
    if (this.watchInterval) {
      logger.warn('Secret watcher already running');
      return;
    }

    logger.info(`Starting secret watcher (interval: ${this.watchIntervalMs}ms)`);

    this.watchInterval = setInterval(() => {
      this.checkForSecretChanges();
    }, this.watchIntervalMs);

    // Initial check
    this.checkForSecretChanges();
  }

  /**
   * Stop watching for secret changes
   */
  stopWatching(): void {
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = undefined;
      logger.info('Secret watcher stopped');
    }
    for (const timeout of this.scheduledRotations.values()) {
      clearTimeout(timeout);
    }
    this.scheduledRotations.clear();
  }

  private scheduleAutoRotation(name: string): void {
    const config = this.secretConfigs.get(name);
    if (!config || !config.rotationIntervalMs || !config.generator) return;

    const existing = this.scheduledRotations.get(name);
    if (existing) clearTimeout(existing);

    const timeout = setTimeout(async () => {
      try {
        const newValue = config.generator!();
        await this.rotateSecret(name, newValue, {
          actor: 'system',
          scope: 'auto-rotation',
          gracePeriodMs: config.gracePeriodMs,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`Auto-rotation failed for ${name}:`, error);
        logger.error(`ALERT: Auto-rotation failure for secret slot ${name}`);
        this.emit('rotationFailure', { secretName: name, error: errorMsg });
      } finally {
        this.scheduleAutoRotation(name);
      }
    }, config.rotationIntervalMs);

    this.scheduledRotations.set(name, timeout);
  }

  /**
   * Check environment for secret changes
   */
  private checkForSecretChanges(): void {
    for (const [name, config] of this.secretConfigs.entries()) {
      const currentValue = this.getSecret(name);
      const envValue = process.env[config.envVar];

      if (envValue && envValue !== currentValue) {
        logger.info(`Detected change in secret: ${name}`);
        void this.rotateSecret(name, envValue);
      }
    }
  }

  /**
   * Clean up expired secret versions
   */
  private cleanupExpiredVersions(name: string): void {
    const versions = this.secrets.get(name);
    if (!versions) return;

    const now = new Date();
    const validVersions = versions.filter(v => !v.expiresAt || v.expiresAt > now);

    if (validVersions.length < versions.length) {
      this.secrets.set(name, validVersions);
      logger.info(`Cleaned up ${versions.length - validVersions.length} expired versions of ${name}`);
    }
  }

  /**
   * Log rotation event to audit trail
   */
  private logRotationEvent(
    secretName: string,
    oldVersion: string,
    newVersion: string,
    success: boolean,
    error?: string,
    actor: string = 'admin',
    scope: string = 'global',
    transitionWindowMs?: number
  ): void {
    const event: SecretRotationEvent = {
      secretName,
      oldVersion,
      newVersion,
      timestamp: new Date(),
      success,
      error,
      actor,
      scope,
      transitionWindowMs,
    };

    this.rotationHistory.push(event);

    // Keep only last 1000 events
    if (this.rotationHistory.length > 1000) {
      this.rotationHistory = this.rotationHistory.slice(-1000);
    }

    // Persist to file for audit
    this.persistAuditLog(event);
  }

  /**
   * Persist audit log to file
   */
  private persistAuditLog(event: SecretRotationEvent): void {
    try {
      const logDir = process.env.AUDIT_LOG_DIR || './logs';
      const logFile = path.join(logDir, 'secret-rotation-audit.log');

      // Ensure directory exists
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      const logEntry = JSON.stringify(event) + '\n';
      fs.appendFileSync(logFile, logEntry);
    } catch (error) {
      logger.error('Failed to persist audit log:', {}, error);
    }
  }

  /**
   * Get rotation history
   */
  getRotationHistory(limit: number = 100): SecretRotationEvent[] {
    return this.rotationHistory.slice(-limit);
  }

  /**
   * Get status of all managed secrets
   */
  getStatus(): Record<string, {
    activeVersion: string;
    validVersionCount: number;
    lastRotation?: Date;
  }> {
    const status: Record<string, any> = {};

    for (const [name, config] of this.secretConfigs.entries()) {
      const activeVersion = this.activeVersions.get(name) || 'none';
      const validVersions = this.getValidSecretVersions(name);
      const versions = this.secrets.get(name) || [];
      const lastRotation = versions.length > 0
        ? versions[versions.length - 1].activatedAt
        : undefined;

      status[name] = {
        activeVersion,
        validVersionCount: validVersions.length,
        lastRotation,
      };
    }

    return status;
  }

  /**
   * Force immediate reload from environment
   */
  async reloadFromEnvironment(): Promise<void> {
    logger.info('Force reloading secrets from environment');
    this.checkForSecretChanges();
  }
}

// Singleton instance
let instance: SecretRotationService | null = null;

export function getSecretRotationService(): SecretRotationService {
  if (!instance) {
    instance = new SecretRotationService();
  }
  return instance;
}

export function initializeSecretRotation(configs: SecretConfig[]): SecretRotationService {
  const service = getSecretRotationService();

  configs.forEach(config => service.registerSecret(config));
  service.startWatching();

  return service;
}
