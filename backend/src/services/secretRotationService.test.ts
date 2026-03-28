import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SecretRotationService } from './secretRotationService.js';

// Mock the logger
vi.mock('../middleware/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('SecretRotationService', () => {
  let service: SecretRotationService;

  beforeEach(() => {
    service = new SecretRotationService(1000); // 1 second watch interval for tests
  });

  afterEach(() => {
    service.stopWatching();
  });

  describe('registerSecret', () => {
    it('should register a secret from environment', () => {
      process.env.TEST_SECRET = 'test-value-123';
      
      service.registerSecret({
        name: 'test_secret',
        envVar: 'TEST_SECRET',
        required: true,
      });

      expect(service.getSecret('test_secret')).toBe('test-value-123');
      delete process.env.TEST_SECRET;
    });

    it('should handle missing required secret', () => {
      service.registerSecret({
        name: 'missing_secret',
        envVar: 'MISSING_SECRET',
        required: true,
      });

      expect(service.getSecret('missing_secret')).toBeUndefined();
    });
  });

  describe('rotateSecret', () => {
    beforeEach(() => {
      process.env.TEST_SECRET = 'old-value';
      service.registerSecret({
        name: 'test_secret',
        envVar: 'TEST_SECRET',
        required: true,
      });
    });

    afterEach(() => {
      delete process.env.TEST_SECRET;
    });

    it('should rotate secret successfully', async () => {
      const success = await service.rotateSecret('test_secret', 'new-value');
      
      expect(success).toBe(true);
      expect(service.getSecret('test_secret')).toBe('new-value');
    });

    it('should keep old version during grace period', async () => {
      await service.rotateSecret('test_secret', 'new-value', { gracePeriodMs: 5000 });
      
      const validVersions = service.getValidSecretVersions('test_secret');
      expect(validVersions).toHaveLength(2);
      expect(validVersions).toContain('old-value');
      expect(validVersions).toContain('new-value');
    });

    it('should fail rotation with invalid secret', async () => {
      service.registerSecret({
        name: 'validated_secret',
        envVar: 'VALIDATED_SECRET',
        required: true,
        validator: (value) => value.length >= 10,
      });

      const success = await service.rotateSecret('validated_secret', 'short');
      expect(success).toBe(false);
    });

    it('should emit rotation event', async () => {
      const rotationPromise = new Promise((resolve) => {
        service.once('secretRotated', resolve);
      });

      await service.rotateSecret('test_secret', 'new-value');
      const event = await rotationPromise;

      expect(event).toMatchObject({
        secretName: 'test_secret',
        oldVersion: 'v1',
      });
    });
  });

  describe('tryWithSecret', () => {
    beforeEach(() => {
      process.env.TEST_SECRET = 'secret-123';
      service.registerSecret({
        name: 'test_secret',
        envVar: 'TEST_SECRET',
        required: true,
      });
    });

    afterEach(() => {
      delete process.env.TEST_SECRET;
    });

    it('should succeed with active secret', async () => {
      const result = await service.tryWithSecret('test_secret', async (secret) => {
        expect(secret).toBe('secret-123');
        return 'success';
      });

      expect(result).toBe('success');
    });

    it('should fallback to old secret on failure', async () => {
      // Rotate to new secret
      await service.rotateSecret('test_secret', 'new-secret', { gracePeriodMs: 5000 });

      let attemptCount = 0;
      const result = await service.tryWithSecret('test_secret', async (secret) => {
        attemptCount++;
        if (secret === 'new-secret') {
          throw new Error('New secret fails');
        }
        return `success with ${secret}`;
      });

      expect(attemptCount).toBe(2); // Tried new, then old
      expect(result).toBe('success with secret-123');
    });

    it('should throw if all versions fail', async () => {
      await expect(
        service.tryWithSecret('test_secret', async () => {
          throw new Error('Always fails');
        })
      ).rejects.toThrow('All secret versions failed');
    });
  });

  describe('getStatus', () => {
    it('should return status of all secrets', () => {
      process.env.SECRET1 = 'value1';
      process.env.SECRET2 = 'value2';

      service.registerSecret({ name: 'secret1', envVar: 'SECRET1', required: true });
      service.registerSecret({ name: 'secret2', envVar: 'SECRET2', required: true });

      const status = service.getStatus();

      expect(status).toHaveProperty('secret1');
      expect(status).toHaveProperty('secret2');
      expect(status.secret1.activeVersion).toBe('v1');
      expect(status.secret1.validVersionCount).toBe(1);

      delete process.env.SECRET1;
      delete process.env.SECRET2;
    });
  });

  describe('getRotationHistory', () => {
    beforeEach(() => {
      process.env.TEST_SECRET = 'value';
      service.registerSecret({ name: 'test_secret', envVar: 'TEST_SECRET', required: true });
    });

    afterEach(() => {
      delete process.env.TEST_SECRET;
    });

    it('should track rotation history', async () => {
      await service.rotateSecret('test_secret', 'new-value-1');
      await service.rotateSecret('test_secret', 'new-value-2');

      const history = service.getRotationHistory();
      expect(history.length).toBeGreaterThanOrEqual(2);
      expect(history[history.length - 1].secretName).toBe('test_secret');
      expect(history[history.length - 1].success).toBe(true);
    });

    it('should limit history size', async () => {
      const history = service.getRotationHistory(1);
      expect(history.length).toBeLessThanOrEqual(1);
    });
  });

  describe('hot-reload', () => {
    it('should detect environment changes', async () => {
      process.env.HOT_RELOAD_SECRET = 'initial-value';
      
      service.registerSecret({
        name: 'hot_reload_secret',
        envVar: 'HOT_RELOAD_SECRET',
        required: true,
      });

      expect(service.getSecret('hot_reload_secret')).toBe('initial-value');

      // Simulate environment change
      process.env.HOT_RELOAD_SECRET = 'updated-value';
      
      // Trigger reload
      await service.reloadFromEnvironment();

      expect(service.getSecret('hot_reload_secret')).toBe('updated-value');

      delete process.env.HOT_RELOAD_SECRET;
    });
  });
});
