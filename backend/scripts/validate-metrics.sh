#!/bin/bash

# Metrics Validation Script
# This script validates that metrics are being collected correctly

set -e

echo "🔍 Validating Metrics Implementation..."
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if server is running
echo "1. Checking if server is running..."
if curl -s http://localhost:4000/health > /dev/null; then
    echo -e "${GREEN}✓${NC} Server is running"
else
    echo -e "${RED}✗${NC} Server is not running. Please start with: npm run dev"
    exit 1
fi
echo ""

# Check Prometheus endpoint
echo "2. Checking Prometheus metrics endpoint..."
if curl -s http://localhost:9464/metrics > /dev/null; then
    echo -e "${GREEN}✓${NC} Prometheus exporter is running on port 9464"
else
    echo -e "${RED}✗${NC} Prometheus exporter is not accessible"
    exit 1
fi
echo ""

# Generate test traffic
echo "3. Generating test traffic..."
for i in {1..5}; do
    curl -s http://localhost:4000/health > /dev/null
    curl -s http://localhost:4000/health/details > /dev/null
done
echo -e "${GREEN}✓${NC} Generated 10 test requests"
echo ""

# Wait for metrics to be collected
echo "4. Waiting for metrics collection..."
sleep 2
echo -e "${GREEN}✓${NC} Metrics collected"
echo ""

# Validate HTTP metrics
echo "5. Validating HTTP metrics..."
HTTP_METRICS=$(curl -s http://localhost:9464/metrics | grep "http_requests_total")
if [ -n "$HTTP_METRICS" ]; then
    echo -e "${GREEN}✓${NC} HTTP request metrics found"
    echo "$HTTP_METRICS" | head -3
else
    echo -e "${RED}✗${NC} HTTP request metrics not found"
fi
echo ""

# Validate database metrics
echo "6. Validating database metrics..."
DB_METRICS=$(curl -s http://localhost:9464/metrics | grep "db_pool_connections")
if [ -n "$DB_METRICS" ]; then
    echo -e "${GREEN}✓${NC} Database pool metrics found"
    echo "$DB_METRICS" | head -3
else
    echo -e "${YELLOW}⚠${NC} Database pool metrics not found (may not be configured)"
fi
echo ""

# Validate system metrics
echo "7. Validating system metrics..."
SYSTEM_METRICS=$(curl -s http://localhost:9464/metrics | grep "process_uptime_seconds")
if [ -n "$SYSTEM_METRICS" ]; then
    echo -e "${GREEN}✓${NC} System metrics found"
    echo "$SYSTEM_METRICS"
else
    echo -e "${RED}✗${NC} System metrics not found"
fi
echo ""

# Check JSON endpoint
echo "8. Validating JSON metrics endpoint..."
JSON_METRICS=$(curl -s http://localhost:4000/health/metrics)
if echo "$JSON_METRICS" | grep -q "uptimeSeconds"; then
    echo -e "${GREEN}✓${NC} JSON metrics endpoint working"
    echo "$JSON_METRICS" | head -10
else
    echo -e "${RED}✗${NC} JSON metrics endpoint not working"
fi
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✓ Metrics validation complete!${NC}"
echo ""
echo "Available endpoints:"
echo "  • Prometheus: http://localhost:9464/metrics"
echo "  • JSON:       http://localhost:4000/health/metrics"
echo "  • Prometheus (via health): http://localhost:4000/health/metrics/prometheus"
echo ""
echo "Next steps:"
echo "  1. Set up Prometheus to scrape http://localhost:9464/metrics"
echo "  2. Create Grafana dashboards"
echo "  3. Configure alerting rules"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
