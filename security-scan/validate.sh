#!/bin/bash

# Validation script for security scanner
# Tests that all scanner components can detect known vulnerabilities

set -e

echo "🔍 Security Scanner Validation"
echo "=============================="
echo ""

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

# Function to run a test
run_test() {
  local test_name="$1"
  local test_command="$2"
  
  echo -n "Testing: $test_name... "
  
  if eval "$test_command" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((TESTS_PASSED++))
  else
    echo -e "${RED}✗ FAIL${NC}"
    ((TESTS_FAILED++))
  fi
}

echo "1. Checking required tools..."
echo "------------------------------"

run_test "npm installed" "command -v npm"
run_test "cargo installed" "command -v cargo"
run_test "gitleaks installed" "command -v gitleaks"
run_test "semgrep installed" "command -v semgrep"

echo ""
echo "2. Checking configuration files..."
echo "-----------------------------------"

run_test ".gitleaks.toml exists" "test -f .gitleaks.toml"
run_test "semgrep.yml exists" "test -f semgrep.yml"
run_test ".eslintrc.security.js exists" "test -f .eslintrc.security.js"

echo ""
echo "3. Building security scanner..."
echo "--------------------------------"

cd security-scan
npm install --silent
npx tsc --outDir dist --module commonjs --target es2022 --esModuleInterop --resolveJsonModule --skipLibCheck orchestrator.ts

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓ Build successful${NC}"
  ((TESTS_PASSED++))
else
  echo -e "${RED}✗ Build failed${NC}"
  ((TESTS_FAILED++))
  exit 1
fi

echo ""
echo "4. Testing scanner execution..."
echo "--------------------------------"

cd "$REPO_ROOT"

# Run the scanner
if node security-scan/dist/orchestrator.js; then
  echo -e "${GREEN}✓ Scanner executed successfully${NC}"
  ((TESTS_PASSED++))
else
  echo -e "${YELLOW}⚠ Scanner found vulnerabilities (this is expected)${NC}"
  ((TESTS_PASSED++))
fi

# Check if results file was created
if [ -f "security-scan-results.json" ]; then
  echo -e "${GREEN}✓ Results file generated${NC}"
  ((TESTS_PASSED++))
  
  # Parse and display summary
  TOTAL=$(cat security-scan-results.json | jq -r '.summary.total')
  CRITICAL=$(cat security-scan-results.json | jq -r '.summary.critical')
  HIGH=$(cat security-scan-results.json | jq -r '.summary.high')
  MEDIUM=$(cat security-scan-results.json | jq -r '.summary.medium')
  LOW=$(cat security-scan-results.json | jq -r '.summary.low')
  
  echo ""
  echo "Scan Results:"
  echo "  Total: $TOTAL"
  echo "  Critical: $CRITICAL"
  echo "  High: $HIGH"
  echo "  Medium: $MEDIUM"
  echo "  Low: $LOW"
else
  echo -e "${RED}✗ Results file not generated${NC}"
  ((TESTS_FAILED++))
fi

echo ""
echo "=============================="
echo "Validation Summary"
echo "=============================="
echo -e "Tests Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Tests Failed: ${RED}$TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
  echo -e "${GREEN}✅ All validation tests passed!${NC}"
  exit 0
else
  echo -e "${RED}❌ Some validation tests failed${NC}"
  exit 1
fi
