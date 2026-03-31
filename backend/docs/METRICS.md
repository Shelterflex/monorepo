# Comprehensive Metrics Collection

This document describes the metrics collection system implemented for production monitoring.

## Overview

The application collects metrics using OpenTelemetry standards and exposes them in Prometheus format for scraping. Metrics cover HTTP requests, database operations, Soroban RPC calls, and business KPIs.

## Architecture

### Components

1. **OpenTelemetry SDK** - Core metrics collection framework
2. **Prometheus Exporter** - Exposes metrics in Prometheus format
3. **Metrics Middleware** - Automatically tracks HTTP requests
4. **Metrics Adapters** - Wrap services to track operations
5. **Business Metrics** - Track domain-specific KPIs

### Metrics Flow

```
Application → OpenTelemetry Meter → Prometheus Exporter → Prometheus Server
```

## Metrics Categories

### 1. HTTP Request Metrics

**Metrics:**

- `http_requests_total` - Total number of HTTP requests (counter)
- `http_request_duration_ms` - Request latency histogram (ms)
- `http_requests_in_flight` - Current in-flight requests (gauge)
- `http_errors_total` - Total HTTP errors (counter)

**Labels:**

- `method` - HTTP method (GET, POST, etc.)
- `route` - Route path
- `status_code` - HTTP status code
- `error_type` - client_error or server_error

**Example:**

```
http_requests_total{method="GET",route="/api/health",status_code="200"} 1523
http_request_duration_ms{method="POST",route="/api/payments",status_code="200"} 45.2
```

### 2. Database Metrics

**Metrics:**

- `db_pool_connections_total` - Total pool connections (gauge)
- `db_pool_connections_idle` - Idle connections (gauge)
- `db_pool_connections_active` - Active connections (gauge)
- `db_pool_connections_waiting` - Waiting clients (gauge)
- `db_queries_total` - Total queries executed (counter)
- `db_query_duration_ms` - Query execution time (histogram)
- `db_query_errors_total` - Query errors (counter)
- `db_slow_queries_total` - Slow queries (counter)

**Labels:**

- `operation` - SQL operation (SELECT, INSERT, UPDATE, DELETE)
- `success` - true/false

**Example:**

```
db_pool_connections_active 5
db_queries_total{operation="SELECT",success="true"} 8234
db_query_duration_ms{operation="INSERT",success="true"} 12.5
```

### 3. Soroban RPC Metrics

**Metrics:**

- `soroban_rpc_calls_total` - Total RPC calls (counter)
- `soroban_rpc_call_duration_ms` - RPC call latency (histogram)
- `soroban_rpc_errors_total` - RPC errors (counter)
- `soroban_circuit_breaker_state` - Circuit breaker state (gauge)
  - 0 = CLOSED (healthy)
  - 1 = HALF_OPEN (recovering)
  - 2 = OPEN (failing)

**Labels:**

- `method` - RPC method name
- `success` - true/false
- `error_type` - Error class name

**Example:**

```
soroban_rpc_calls_total{method="getBalance",success="true"} 3421
soroban_rpc_call_duration_ms{method="transfer",success="true"} 125.3
soroban_circuit_breaker_state 0
```

### 4. Business Metrics

**Staking:**

- `staking_operations_total` - Total staking operations (counter)
- `staking_volume_total` - Total staking volume in USDC (counter)

**Payments:**

- `payments_total` - Total payments (counter)
- `payment_volume_total` - Total payment volume in NGN (counter)

**Receipts:**

- `receipts_total` - Total receipts recorded (counter)

**Deals:**

- `deals_total` - Total deals (counter)

**Wallets:**

- `wallet_operations_total` - Total wallet operations (counter)

**Conversions:**

- `conversions_total` - Total currency conversions (counter)
- `conversion_volume_total` - Total conversion volume (counter)

**Labels:**

- `operation` - Operation type (stake, unstake, credit, debit, etc.)
- `status` - Operation status (initiated, completed, failed, etc.)
- `success` - true/false
- `type` - Entity type

**Example:**

```
staking_operations_total{operation="stake",success="true"} 234
staking_volume_total{operation="stake",success="true"} 15000000000
payments_total{status="completed"} 1523
payment_volume_total{status="completed"} 75000000
```

### 5. System Metrics

**Metrics:**

- `process_uptime_seconds` - Process uptime (gauge)
- `process_memory_heap_used_bytes` - Heap memory used (gauge)
- `process_memory_heap_total_bytes` - Total heap memory (gauge)
- `process_memory_rss_bytes` - Resident set size (gauge)

**Example:**

```
process_uptime_seconds 3600
process_memory_heap_used_bytes 125829120
process_memory_rss_bytes 256901120
```

## Endpoints

### JSON Metrics (Legacy)

```
GET /health/metrics
```

Returns metrics in JSON format for backward compatibility.

### Prometheus Metrics

```
GET /health/metrics/prometheus
```

Returns metrics in Prometheus exposition format for scraping.

**Direct Prometheus Endpoint:**

```
GET http://localhost:9464/metrics
```

The Prometheus exporter runs on a separate port (default: 9464) and serves metrics directly.

## Configuration

### Environment Variables

```bash
# Prometheus exporter port
PROMETHEUS_PORT=9464

# OpenTelemetry service name
OTEL_SERVICE_NAME=shelterflex-backend

# Service version
VERSION=0.1.0
```

### Prometheus Scrape Configuration

Add to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: "shelterflex-backend"
    scrape_interval: 15s
    static_configs:
      - targets: ["localhost:9464"]
```

## Usage Examples

### Recording Custom Metrics

```typescript
import {
  recordHttpRequest,
  recordDbQuery,
  recordSorobanRpcCall,
  recordStakingOperation,
  recordPayment,
} from "./utils/metrics.js";

// Record HTTP request
recordHttpRequest("POST", "/api/payments", 200, 45.2);

// Record database query
recordDbQuery("SELECT", 12.5, true, false);

// Record Soroban RPC call
recordSorobanRpcCall("getBalance", 75.3, true);

// Record staking operation
recordStakingOperation("stake", BigInt(1000000), true);

// Record payment
recordPayment("completed", 50000);
```

### Automatic Tracking

Most metrics are tracked automatically:

1. **HTTP Requests** - Tracked by `metricsMiddleware`
2. **Database Queries** - Tracked by wrapped pool in `db.ts`
3. **Soroban RPC Calls** - Tracked by `MetricsSorobanAdapter`

## Monitoring & Alerting

### Recommended Alerts

**High Error Rate:**

```promql
rate(http_errors_total[5m]) > 0.05
```

**High Latency:**

```promql
histogram_quantile(0.99, rate(http_request_duration_ms_bucket[5m])) > 2000
```

**Database Connection Pool Exhaustion:**

```promql
db_pool_connections_waiting > 5
```

**Circuit Breaker Open:**

```promql
soroban_circuit_breaker_state == 2
```

**Slow Queries:**

```promql
rate(db_slow_queries_total[5m]) > 0.1
```

### Grafana Dashboards

Example queries for Grafana:

**Request Rate:**

```promql
rate(http_requests_total[5m])
```

**Error Rate:**

```promql
rate(http_errors_total[5m]) / rate(http_requests_total[5m])
```

**P95 Latency:**

```promql
histogram_quantile(0.95, rate(http_request_duration_ms_bucket[5m]))
```

**Active Database Connections:**

```promql
db_pool_connections_active
```

**Staking Volume (last hour):**

```promql
increase(staking_volume_total[1h])
```

## Testing

Run metrics tests:

```bash
npm test src/utils/metrics.test.ts
```

## Validation

### 1. Check Metrics Endpoint

```bash
curl http://localhost:4000/health/metrics/prometheus
```

### 2. Verify Prometheus Exporter

```bash
curl http://localhost:9464/metrics
```

### 3. Test Metric Recording

```bash
# Make some requests
curl http://localhost:4000/health
curl http://localhost:4000/api/balance/GXXX...

# Check metrics
curl http://localhost:9464/metrics | grep http_requests_total
```

## Performance Considerations

1. **Low Overhead** - Metrics collection adds minimal latency (<1ms per request)
2. **Memory Efficient** - Uses histograms with bounded buckets
3. **Non-Blocking** - Metrics are recorded asynchronously
4. **Sampling** - Can be configured via OTEL_SAMPLING_RATIO

## Troubleshooting

### Metrics Not Appearing

1. Check Prometheus exporter is running:

   ```bash
   curl http://localhost:9464/metrics
   ```

2. Verify environment variables are set
3. Check application logs for metrics initialization errors

### High Memory Usage

1. Reduce histogram bucket count
2. Increase export interval
3. Enable sampling for high-traffic routes

### Missing Business Metrics

1. Ensure operations are calling record functions
2. Check for errors in metric recording
3. Verify labels are correctly set

## Future Enhancements

- [ ] Add custom histogram buckets per metric type
- [ ] Implement metric aggregation for multi-instance deployments
- [ ] Add exemplars for trace correlation
- [ ] Create pre-built Grafana dashboards
- [ ] Add metric cardinality monitoring
- [ ] Implement metric retention policies

## References

- [OpenTelemetry Metrics](https://opentelemetry.io/docs/specs/otel/metrics/)
- [Prometheus Exposition Format](https://prometheus.io/docs/instrumenting/exposition_formats/)
- [Prometheus Best Practices](https://prometheus.io/docs/practices/naming/)
