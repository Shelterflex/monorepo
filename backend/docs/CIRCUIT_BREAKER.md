# Soroban Circuit Breaker

## Overview

The Soroban Circuit Breaker is a resilience pattern implementation that protects the application from cascading failures when the Soroban RPC service experiences temporary unavailability or degraded performance. It wraps the `RealSorobanAdapter` and manages three distinct states: **Closed** (normal operation), **Open** (failing fast), and **Half-Open** (testing recovery).

## Architecture

### State Machine

The circuit breaker operates as a finite state machine with three states:

- **CLOSED**: Normal operation. All RPC calls proceed normally. Failures are counted.
- **OPEN**: Failing fast. All RPC calls are rejected immediately without contacting the RPC service.
- **HALF-OPEN**: Testing recovery. A limited number of test calls are allowed to verify if the service has recovered.

### State Transitions

1. **CLOSED → OPEN**: When consecutive failures reach the configured threshold
2. **OPEN → HALF-OPEN**: When the timeout period elapses
3. **HALF-OPEN → CLOSED**: When a test call succeeds
4. **HALF-OPEN → OPEN**: When a test call fails
5. **CLOSED → CLOSED**: When a call succeeds (failure counter resets)

## Configuration

The circuit breaker is configured via environment variables with sensible defaults:

```bash
# Enable/disable circuit breaker (default: true)
SOROBAN_CIRCUIT_BREAKER_ENABLED=true

# Number of consecutive failures to trigger circuit opening (default: 5)
SOROBAN_CIRCUIT_BREAKER_FAILURE_THRESHOLD=5

# Duration circuit remains open before attempting recovery in milliseconds (default: 30000)
SOROBAN_CIRCUIT_BREAKER_TIMEOUT_PERIOD=30000

# Number of test requests allowed in Half-Open state (default: 1)
SOROBAN_CIRCUIT_BREAKER_HALF_OPEN_REQUESTS=1
```

### Configuration Examples

**Aggressive circuit breaker** (opens quickly, recovers quickly):
```bash
SOROBAN_CIRCUIT_BREAKER_FAILURE_THRESHOLD=2
SOROBAN_CIRCUIT_BREAKER_TIMEOUT_PERIOD=10000
```

**Conservative circuit breaker** (tolerates more failures, longer recovery):
```bash
SOROBAN_CIRCUIT_BREAKER_FAILURE_THRESHOLD=10
SOROBAN_CIRCUIT_BREAKER_TIMEOUT_PERIOD=60000
```

**Disabled circuit breaker** (for testing or development):
```bash
SOROBAN_CIRCUIT_BREAKER_ENABLED=false
```

## Error Handling

### Error Classification

The circuit breaker classifies errors into two categories:

**Transient Errors** (increment failure counter):
- HTTP 429 (Too Many Requests)
- HTTP 503 (Service Unavailable)
- HTTP 504 (Gateway Timeout)
- Network timeouts
- Connection refused errors
- Unknown errors (fail-safe default)

**Permanent Errors** (do not increment counter):
- HTTP 400 (Bad Request)
- HTTP 401 (Unauthorized)
- HTTP 404 (Not Found)
- Invalid contract errors
- Authentication failures

### Error Propagation

When the circuit breaker rejects a call because it is open, it throws a `CircuitBreakerOpenError` with:
- Current circuit breaker state and metrics
- Method name that was attempted
- Reason for rejection

Example error:
```
CircuitBreakerOpenError: Circuit breaker OPEN for getBalance: Circuit breaker is OPEN. 
State: OPEN, Failures: 5
```

## Monitoring and Observability

### Health Check Endpoint

The circuit breaker exposes its health status via the `/health/soroban` endpoint:

```bash
GET /health/soroban
```

Response when circuit is CLOSED (healthy):
```json
{
  "status": "healthy",
  "metrics": {
    "state": "CLOSED",
    "consecutiveFailures": 0,
    "totalAttempts": 1000,
    "totalSuccesses": 995,
    "totalFailures": 5,
    "lastStateTransitionTime": "2024-01-15T10:30:00Z",
    "openedAt": null,
    "halfOpenTestRequestsRemaining": 1
  }
}
```

Response when circuit is OPEN (degraded):
```json
{
  "status": "degraded",
  "metrics": {
    "state": "OPEN",
    "consecutiveFailures": 5,
    "totalAttempts": 1005,
    "totalSuccesses": 995,
    "totalFailures": 10,
    "lastStateTransitionTime": "2024-01-15T10:35:00Z",
    "openedAt": "2024-01-15T10:35:00Z",
    "halfOpenTestRequestsRemaining": 1
  }
}
```

### Metrics

The circuit breaker tracks the following metrics:

- **state**: Current state (CLOSED, OPEN, HALF_OPEN)
- **consecutiveFailures**: Number of consecutive failures in CLOSED state
- **totalAttempts**: Total number of RPC calls attempted
- **totalSuccesses**: Total number of successful RPC calls
- **totalFailures**: Total number of failed RPC calls
- **lastStateTransitionTime**: Timestamp of the last state transition
- **openedAt**: Timestamp when the circuit opened (null if not open)
- **halfOpenTestRequestsRemaining**: Number of test requests remaining in HALF_OPEN state

### Logging

The circuit breaker logs all significant events:

**State Transitions**:
```
Circuit breaker state transition: from=CLOSED to=OPEN reason="Failure threshold reached"
```

**Circuit Opening**:
```
Circuit breaker opened: consecutiveFailures=5 failureThreshold=5
```

**Circuit Recovery**:
```
Circuit breaker recovered: downtime=30000ms
```

**Failures**:
```
RPC call failed: method=getBalance error="timeout" state=CLOSED consecutiveFailures=2
```

**Permanent Errors**:
```
Permanent error (circuit breaker not triggered): method=getBalance error="HTTP 400"
```

## Integration

### Adapter Factory

The circuit breaker is automatically integrated into the adapter factory:

```typescript
import { createSorobanAdapter } from './soroban/index.js'
import { getSorobanConfigFromEnv } from './soroban/client.js'

const sorobanConfig = getSorobanConfigFromEnv(process.env)
const adapter = createSorobanAdapter(sorobanConfig)
// adapter is now a CircuitBreakerAdapter wrapping RealSorobanAdapter
```

### Transparent Wrapping

The circuit breaker implements the `SorobanAdapter` interface, so it's transparent to calling code:

```typescript
// All these methods are protected by the circuit breaker
const balance = await adapter.getBalance(account)
await adapter.credit(account, amount)
await adapter.debit(account, amount)
const receipt = await adapter.recordReceipt(params)
```

## Troubleshooting

### Circuit Breaker Stays Open

**Symptoms**: All RPC calls fail with `CircuitBreakerOpenError`

**Causes**:
1. Soroban RPC service is down or unreachable
2. Network connectivity issues
3. Failure threshold is too low

**Solutions**:
1. Check Soroban RPC service status
2. Verify network connectivity
3. Increase `SOROBAN_CIRCUIT_BREAKER_FAILURE_THRESHOLD` if transient failures are expected
4. Increase `SOROBAN_CIRCUIT_BREAKER_TIMEOUT_PERIOD` to allow more recovery time

### Circuit Breaker Opens Too Frequently

**Symptoms**: Circuit opens and closes repeatedly

**Causes**:
1. Failure threshold is too low
2. Timeout period is too short
3. RPC service has intermittent issues

**Solutions**:
1. Increase `SOROBAN_CIRCUIT_BREAKER_FAILURE_THRESHOLD`
2. Increase `SOROBAN_CIRCUIT_BREAKER_TIMEOUT_PERIOD`
3. Investigate and fix underlying RPC service issues

### Permanent Errors Not Triggering Circuit Opening

**Symptoms**: Permanent errors (HTTP 400, 401, 404) don't increment failure counter

**Expected Behavior**: This is correct. Permanent errors indicate client-side issues that won't be resolved by waiting. The circuit breaker only opens for transient errors.

**Solutions**:
1. Fix the client-side issue (invalid contract, authentication, etc.)
2. Check application logs for permanent error details

## Performance Considerations

- **Lock Contention**: The circuit breaker uses a mutex to protect state transitions. Under high concurrency, this may cause minimal latency overhead.
- **Memory**: Metrics are bounded and don't grow unbounded.
- **Latency**: When the circuit is CLOSED, the overhead is minimal (just a state check).
- **Throughput**: When the circuit is OPEN, throughput is maximized (calls fail immediately without network overhead).

## Testing

### Unit Tests

Comprehensive unit tests verify:
- State transitions (CLOSED → OPEN → HALF-OPEN → CLOSED)
- Failure detection and counter increment
- Success counter reset
- Timeout-based recovery
- Permanent error handling
- Concurrent call handling
- Metrics collection

Run tests:
```bash
npm test -- circuit-breaker --run
```

### Integration Tests

Integration tests verify:
- Circuit breaker wrapping RealSorobanAdapter
- Mocked RPC failures triggering state transitions
- Recovery scenarios
- Error propagation
- Metrics accuracy

### Manual Testing

To manually test the circuit breaker:

1. Start the application with circuit breaker enabled
2. Monitor the `/health/soroban` endpoint
3. Simulate RPC failures (e.g., stop the RPC service)
4. Observe circuit opening and recovery

## Best Practices

1. **Monitor the health endpoint**: Set up alerts for when the circuit is OPEN
2. **Tune configuration**: Adjust thresholds based on your RPC service characteristics
3. **Log analysis**: Review logs for patterns of failures
4. **Gradual rollout**: Enable circuit breaker gradually and monitor impact
5. **Test recovery**: Regularly test recovery scenarios in staging environment

## References

- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)
- [Release It! Design and Deploy Production-Ready Software](https://pragprog.com/titles/mnee2/release-it-second-edition/)
- [Soroban RPC Documentation](https://developers.stellar.org/docs/learn/soroban)
