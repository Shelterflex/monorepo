/**
 * Comprehensive OpenTelemetry Metrics Collection
 * 
 * Provides:
 * - HTTP request metrics (count, latency, status codes)
 * - Database connection pool metrics
 * - Soroban RPC call metrics
 * - Business metrics (staking volume, receipt counts, etc.)
 * - Prometheus-compatible export format
 * 
 * Note: Metrics are disabled in test environment (NODE_ENV=test)
 */

import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { metrics } from '@opentelemetry/api';

// Skip metrics in test environment
const isTestEnv = process.env.NODE_ENV === 'test';

// ── Initialization ────────────────────────────────────────────────────────────

if (!isTestEnv) {
  try {
    const { env } = require('../schemas/env.js');
    const { Resource } = require('@opentelemetry/resources');
    
    const prometheusPort = parseInt(process.env.PROMETHEUS_PORT ?? '9464', 10);
    const prometheusExporter = new PrometheusExporter(
      {
        port: prometheusPort,
        endpoint: '/metrics',
      },
      () => {
        console.log(`[metrics] Prometheus exporter listening on port ${prometheusPort}`);
      }
    );

    const resource = new Resource({
      [SEMRESATTRS_SERVICE_NAME]: env.OTEL_SERVICE_NAME || 'shelterflex-backend',
      [SEMRESATTRS_SERVICE_VERSION]: env.VERSION || '0.1.0',
    });

    const meterProvider = new MeterProvider({
      resource,
      readers: [prometheusExporter as any], // PrometheusExporter is a MetricReader
    });

    metrics.setGlobalMeterProvider(meterProvider);
  } catch (error) {
    console.error('[metrics] Failed to initialize metrics:', error);
  }
}

const meter = metrics.getMeter('shelterflex-backend');

// ── Database Metrics Callbacks ────────────────────────────────────────────────

let dbPoolMetricsCallback: (() => {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  activeCount: number;
}) | null = null;

export function setDbPoolMetricsCallback(
  callback: () => {
    totalCount: number;
    idleCount: number;
    waitingCount: number;
    activeCount: number;
  }
) {
  dbPoolMetricsCallback = callback;
}

let sorobanCircuitBreakerStateCallback: (() => string) | null = null;

export function setSorobanCircuitBreakerCallback(callback: () => string) {
  sorobanCircuitBreakerStateCallback = callback;
}

// ── Helper Functions ──────────────────────────────────────────────────────────

/**
 * Record an HTTP request with all relevant metrics
 */
export function recordHttpRequest(
  method: string,
  route: string,
  statusCode: number,
  durationMs: number
) {
  if (isTestEnv) return;
  
  const attributes = {
    method,
    route,
    status_code: statusCode.toString(),
  };

  meter.createCounter('http_requests_total', {
    description: 'Total number of HTTP requests',
  }).add(1, attributes);

  meter.createHistogram('http_request_duration_ms', {
    description: 'HTTP request latency in milliseconds',
  }).record(durationMs, attributes);

  if (statusCode >= 400) {
    meter.createCounter('http_errors_total', {
      description: 'Total number of HTTP errors',
    }).add(1, {
      ...attributes,
      error_type: statusCode >= 500 ? 'server_error' : 'client_error',
    });
  }
}

/**
 * Track in-flight HTTP requests
 */
export const httpRequestsInFlight = {
  add: (value: number, attributes: Record<string, string>) => {
    if (isTestEnv) return;
    meter.createUpDownCounter('http_requests_in_flight', {
      description: 'Number of HTTP requests currently being processed',
    }).add(value, attributes);
  }
};

/**
 * Record a database query with metrics
 */
export function recordDbQuery(
  operation: string,
  durationMs: number,
  success: boolean,
  isSlow: boolean = false
) {
  if (isTestEnv) return;
  
  const attributes = {
    operation,
    success: success.toString(),
  };

  meter.createCounter('db_queries_total', {
    description: 'Total number of database queries executed',
  }).add(1, attributes);

  meter.createHistogram('db_query_duration_ms', {
    description: 'Database query execution time in milliseconds',
  }).record(durationMs, attributes);

  if (!success) {
    meter.createCounter('db_query_errors_total', {
      description: 'Total number of database query errors',
    }).add(1, attributes);
  }

  if (isSlow) {
    meter.createCounter('db_slow_queries_total', {
      description: 'Total number of slow database queries',
    }).add(1, attributes);
  }
}

/**
 * Record a Soroban RPC call
 */
export function recordSorobanRpcCall(
  method: string,
  durationMs: number,
  success: boolean,
  errorType?: string
) {
  if (isTestEnv) return;
  
  const attributes = {
    method,
    success: success.toString(),
    ...(errorType && { error_type: errorType }),
  };

  meter.createCounter('soroban_rpc_calls_total', {
    description: 'Total number of Soroban RPC calls',
  }).add(1, attributes);

  meter.createHistogram('soroban_rpc_call_duration_ms', {
    description: 'Soroban RPC call latency in milliseconds',
  }).record(durationMs, attributes);

  if (!success) {
    meter.createCounter('soroban_rpc_errors_total', {
      description: 'Total number of Soroban RPC errors',
    }).add(1, attributes);
  }
}

/**
 * Record a staking operation
 */
export function recordStakingOperation(
  operation: 'stake' | 'unstake',
  amountUsdc: bigint,
  success: boolean
) {
  if (isTestEnv) return;
  
  const attributes = {
    operation,
    success: success.toString(),
  };

  meter.createCounter('staking_operations_total', {
    description: 'Total number of staking operations',
  }).add(1, attributes);

  if (success) {
    meter.createCounter('staking_volume_total', {
      description: 'Total staking volume in USDC (smallest unit)',
    }).add(Number(amountUsdc), attributes);
  }
}

/**
 * Record a payment
 */
export function recordPayment(
  status: 'initiated' | 'completed' | 'failed',
  amountNgn: number
) {
  if (isTestEnv) return;
  
  const attributes = {
    status,
  };

  meter.createCounter('payments_total', {
    description: 'Total number of payments',
  }).add(1, attributes);

  if (status === 'completed') {
    meter.createCounter('payment_volume_total', {
      description: 'Total payment volume in NGN (smallest unit)',
    }).add(amountNgn, attributes);
  }
}

/**
 * Record a receipt
 */
export function recordReceipt(type: string) {
  if (isTestEnv) return;
  
  meter.createCounter('receipts_total', {
    description: 'Total number of receipts recorded',
  }).add(1, { type });
}

/**
 * Record a deal
 */
export function recordDeal(status: 'created' | 'accepted' | 'completed' | 'cancelled') {
  if (isTestEnv) return;
  
  meter.createCounter('deals_total', {
    description: 'Total number of deals',
  }).add(1, { status });
}

/**
 * Record a wallet operation
 */
export function recordWalletOperation(
  operation: 'create' | 'credit' | 'debit' | 'balance_check',
  success: boolean
) {
  if (isTestEnv) return;
  
  meter.createCounter('wallet_operations_total', {
    description: 'Total number of wallet operations',
  }).add(1, {
    operation,
    success: success.toString(),
  });
}

/**
 * Record a currency conversion
 */
export function recordConversion(
  fromCurrency: string,
  toCurrency: string,
  amount: number,
  success: boolean
) {
  if (isTestEnv) return;
  
  const attributes = {
    from_currency: fromCurrency,
    to_currency: toCurrency,
    success: success.toString(),
  };

  meter.createCounter('conversions_total', {
    description: 'Total number of currency conversions',
  }).add(1, attributes);

  if (success) {
    meter.createCounter('conversion_volume_total', {
      description: 'Total conversion volume',
    }).add(amount, attributes);
  }
}

// ── Observable Gauges (registered once) ───────────────────────────────────────

if (!isTestEnv) {
  // Database pool metrics
  meter.createObservableGauge('db_pool_connections_total').addCallback((result) => {
    if (dbPoolMetricsCallback) {
      const m = dbPoolMetricsCallback();
      result.observe(m.totalCount);
    }
  });

  meter.createObservableGauge('db_pool_connections_idle').addCallback((result) => {
    if (dbPoolMetricsCallback) {
      const m = dbPoolMetricsCallback();
      result.observe(m.idleCount);
    }
  });

  meter.createObservableGauge('db_pool_connections_active').addCallback((result) => {
    if (dbPoolMetricsCallback) {
      const m = dbPoolMetricsCallback();
      result.observe(m.activeCount);
    }
  });

  meter.createObservableGauge('db_pool_connections_waiting').addCallback((result) => {
    if (dbPoolMetricsCallback) {
      const m = dbPoolMetricsCallback();
      result.observe(m.waitingCount);
    }
  });

  // Soroban circuit breaker
  meter.createObservableGauge('soroban_circuit_breaker_state').addCallback((result) => {
    if (sorobanCircuitBreakerStateCallback) {
      const state = sorobanCircuitBreakerStateCallback();
      const stateValue = state === 'CLOSED' ? 0 : state === 'HALF_OPEN' ? 1 : 2;
      result.observe(stateValue);
    }
  });

  // System metrics
  meter.createObservableGauge('process_uptime_seconds').addCallback((result) => {
    result.observe(process.uptime());
  });

  meter.createObservableGauge('process_memory_heap_used_bytes').addCallback((result) => {
    result.observe(process.memoryUsage().heapUsed);
  });

  meter.createObservableGauge('process_memory_heap_total_bytes').addCallback((result) => {
    result.observe(process.memoryUsage().heapTotal);
  });

  meter.createObservableGauge('process_memory_rss_bytes').addCallback((result) => {
    result.observe(process.memoryUsage().rss);
  });
}

// ── Graceful Shutdown ─────────────────────────────────────────────────────────

export async function shutdownMetrics(): Promise<void> {
  if (isTestEnv) return;
  
  try {
    const meterProvider = metrics.getMeterProvider() as any;
    if (meterProvider && typeof meterProvider.shutdown === 'function') {
      await meterProvider.shutdown();
      console.log('[metrics] Metrics provider shut down successfully');
    }
  } catch (error) {
    console.error('[metrics] Error shutting down metrics provider:', error);
  }
}

// ── Export meter for custom metrics ───────────────────────────────────────────

export { meter };
