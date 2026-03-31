# Metrics Quick Start Guide

Get up and running with comprehensive metrics collection in 5 minutes.

## Prerequisites

- Node.js 18+
- Running backend application
- (Optional) Prometheus server for scraping

## Step 1: Configuration

The metrics system is enabled by default. Configure via environment variables:

```bash
# .env
PROMETHEUS_PORT=9464
OTEL_SERVICE_NAME=shelterflex-backend
VERSION=0.1.0
```

## Step 2: Start the Application

```bash
npm run dev
```

You should see:

```
[metrics] Prometheus exporter listening on port 9464
```

## Step 3: Verify Metrics

### Check Prometheus Endpoint

```bash
curl http://localhost:9464/metrics
```

Expected output:

```
# HELP http_requests_total Total number of HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",route="/health",status_code="200"} 5

# HELP http_request_duration_ms HTTP request latency in milliseconds
# TYPE http_request_duration_ms histogram
http_request_duration_ms_bucket{method="GET",route="/health",status_code="200",le="10"} 3
...
```

### Check JSON Endpoint

```bash
curl http://localhost:4000/health/metrics
```

Expected output:

```json
{
  "uptimeSeconds": 120,
  "collectedAt": "2024-03-30T10:00:00.000Z",
  "routes": [
    {
      "route": "GET /health",
      "requestCount": 5,
      "errorCount": 0,
      "errorRatePct": 0,
      "latency": {
        "p50": 5,
        "p95": 8,
        "p99": 10
      }
    }
  ],
  "kpis": {
    "paymentsInitiated": 0,
    "paymentsCompleted": 0,
    "paymentsFailed": 0,
    "stakingDeposits": 0
  }
}
```

## Step 4: Generate Test Traffic

```bash
# Make some requests
for i in {1..10}; do
  curl http://localhost:4000/health
  curl http://localhost:4000/health/details
done
```

## Step 5: View Metrics

```bash
curl http://localhost:9464/metrics | grep http_requests_total
```

Output:

```
http_requests_total{method="GET",route="/health",status_code="200"} 10
http_requests_total{method="GET",route="/health/details",status_code="200"} 10
```

## Step 6: Set Up Prometheus (Optional)

### Install Prometheus

**macOS:**

```bash
brew install prometheus
```

**Linux:**

```bash
wget https://github.com/prometheus/prometheus/releases/download/v2.45.0/prometheus-2.45.0.linux-amd64.tar.gz
tar xvfz prometheus-*.tar.gz
cd prometheus-*
```

### Configure Prometheus

Create `prometheus.yml`:

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: "shelterflex-backend"
    static_configs:
      - targets: ["localhost:9464"]
```

### Start Prometheus

```bash
prometheus --config.file=prometheus.yml
```

### View in Prometheus UI

Open http://localhost:9090 and query:

```promql
rate(http_requests_total[5m])
```

## Available Metrics

### HTTP Metrics

- `http_requests_total` - Total requests
- `http_request_duration_ms` - Request latency
- `http_requests_in_flight` - Current requests
- `http_errors_total` - Total errors

### Database Metrics

- `db_pool_connections_*` - Connection pool stats
- `db_queries_total` - Total queries
- `db_query_duration_ms` - Query latency
- `db_slow_queries_total` - Slow queries

### Soroban RPC Metrics

- `soroban_rpc_calls_total` - Total RPC calls
- `soroban_rpc_call_duration_ms` - RPC latency
- `soroban_rpc_errors_total` - RPC errors
- `soroban_circuit_breaker_state` - Circuit breaker state

### Business Metrics

- `staking_operations_total` - Staking operations
- `staking_volume_total` - Staking volume
- `payments_total` - Payments
- `payment_volume_total` - Payment volume
- `receipts_total` - Receipts
- `deals_total` - Deals
- `wallet_operations_total` - Wallet operations
- `conversions_total` - Conversions

### System Metrics

- `process_uptime_seconds` - Process uptime
- `process_memory_*` - Memory usage

## Useful Queries

### Request Rate (per second)

```promql
rate(http_requests_total[5m])
```

### Error Rate (percentage)

```promql
rate(http_errors_total[5m]) / rate(http_requests_total[5m]) * 100
```

### P95 Latency

```promql
histogram_quantile(0.95, rate(http_request_duration_ms_bucket[5m]))
```

### Active Database Connections

```promql
db_pool_connections_active
```

### Staking Volume (last hour)

```promql
increase(staking_volume_total[1h])
```

## Troubleshooting

### Metrics endpoint returns 404

Check that the application started successfully:

```bash
curl http://localhost:4000/health
```

### No metrics appearing

1. Verify Prometheus port is correct:

   ```bash
   echo $PROMETHEUS_PORT
   ```

2. Check application logs for errors

3. Ensure NODE_ENV is not 'test' (metrics are disabled in test mode)

### Prometheus can't scrape

1. Check firewall rules
2. Verify Prometheus config targets the correct port
3. Check Prometheus logs: `tail -f /path/to/prometheus.log`

## Next Steps

- [Full Metrics Documentation](./METRICS.md)
- Set up Grafana dashboards
- Configure alerting rules
- Integrate with your monitoring stack

## Support

For issues or questions:

1. Check the [full documentation](./METRICS.md)
2. Review application logs
3. Open an issue on GitHub
