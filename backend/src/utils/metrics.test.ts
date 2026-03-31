import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordHttpRequest,
  recordDbQuery,
  recordSorobanRpcCall,
  recordStakingOperation,
  recordPayment,
  recordReceipt,
  recordDeal,
  recordWalletOperation,
  recordConversion,
} from './metrics.js';

describe('Metrics Collection', () => {
  describe('HTTP Metrics', () => {
    it('should record HTTP request metrics', () => {
      expect(() => {
        recordHttpRequest('GET', '/api/health', 200, 50);
      }).not.toThrow();
    });

    it('should record HTTP error metrics', () => {
      expect(() => {
        recordHttpRequest('POST', '/api/payments', 500, 150);
      }).not.toThrow();
    });
  });

  describe('Database Metrics', () => {
    it('should record successful database query', () => {
      expect(() => {
        recordDbQuery('SELECT', 25, true, false);
      }).not.toThrow();
    });

    it('should record failed database query', () => {
      expect(() => {
        recordDbQuery('INSERT', 100, false, false);
      }).not.toThrow();
    });

    it('should record slow database query', () => {
      expect(() => {
        recordDbQuery('SELECT', 500, true, true);
      }).not.toThrow();
    });
  });

  describe('Soroban RPC Metrics', () => {
    it('should record successful RPC call', () => {
      expect(() => {
        recordSorobanRpcCall('getBalance', 75, true);
      }).not.toThrow();
    });

    it('should record failed RPC call with error type', () => {
      expect(() => {
        recordSorobanRpcCall('transfer', 200, false, 'NetworkError');
      }).not.toThrow();
    });
  });

  describe('Business Metrics', () => {
    it('should record staking operation', () => {
      expect(() => {
        recordStakingOperation('stake', BigInt(1000000), true);
      }).not.toThrow();
    });

    it('should record payment', () => {
      expect(() => {
        recordPayment('completed', 50000);
      }).not.toThrow();
    });

    it('should record receipt', () => {
      expect(() => {
        recordReceipt('payment');
      }).not.toThrow();
    });

    it('should record deal', () => {
      expect(() => {
        recordDeal('created');
      }).not.toThrow();
    });

    it('should record wallet operation', () => {
      expect(() => {
        recordWalletOperation('credit', true);
      }).not.toThrow();
    });

    it('should record conversion', () => {
      expect(() => {
        recordConversion('NGN', 'USDC', 100000, true);
      }).not.toThrow();
    });
  });
});
