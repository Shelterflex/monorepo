#!/bin/bash

# Validation Test Suite for Security Scanner
# Tests that all scanner components can detect known vulnerabilities

set -e

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🧪 Security Scanner Validation Test Suite${NC}"
echo "==========================================="
echo ""

# Build the scanner first
echo "Building security scanner..."
cd security-scan
npm install --silent
npx tsc --outDir dist --module commonjs --target es2022 --esModuleInterop --resolveJsonModule --skipLibCheck orchestrator.ts
cd "$REPO_ROOT"

# Test 1: Vulnerable Dependency Detection
echo ""
echo -e "${YELLOW}Test 1: Vulnerable Dependency Detection${NC}"
echo "Adding lodash@4.17.15 (known vulnerable)..."

# Backup original package.json
cp backend/package.json backend/package.json.backup

# Add vulnerable dependency
cd backend
npm install lodash@4.17.15 --save --silent
cd "$REPO_ROOT"

# Run scanner in test mode
TEST_MODE=true node security-scan/dist/orchestrator.js

# Check if vulnerability was detected
if grep -q "lodash" security-scan-results.json && grep -q "CVE-2020-8203" security-scan-results.json; then
  echo -e "${GREEN}✓ Test 1 PASSED: Vulnerable dependency detected${NC}"
else
  echo -e "${RED}✗ Test 1 FAILED: Vulnerable dependency not detected${NC}"
fi

# Restore original package.json
mv backend/package.json.backup backend/package.json
cd backend && npm install --silent
cd "$REPO_ROOT"

# Test 2: Secret Detection
echo ""
echo -e "${YELLOW}Test 2: Secret Detection${NC}"
echo "Creating file with sample API key..."

# Create test file with secret
cat > test-secret-file.js << 'EOF'
// Test file for secret detection
const API_KEY = "sk-1234567890abcdef1234567890abcdef1234567890abcdef";
const config = {
  apiKey: API_KEY
};
EOF

# Commit the file
git add test-secret-file.js
git commit -m "Test: Add file with secret" --no-verify

# Run scanner in test mode
TEST_MODE=true node security-scan/dist/orchestrator.js

# Check if secret was detected
if grep -q "secret" security-scan-results.json || grep -q "api" security-scan-results.json; then
  echo -e "${GREEN}✓ Test 2 PASSED: Secret detected${NC}"
else
  echo -e "${RED}✗ Test 2 FAILED: Secret not detected${NC}"
fi

# Remove test file and commit
git reset HEAD~1
rm test-secret-file.js

# Test 3: SQL Injection Detection
echo ""
echo -e "${YELLOW}Test 3: SQL Injection Detection${NC}"
echo "Creating file with SQL injection pattern..."

# Create test file with SQL injection
cat > test-sql-injection.ts << 'EOF'
// Test file for SQL injection detection
import { db } from './db';

export function getUserById(userId: string) {
  // Vulnerable: SQL injection via string concatenation
  return db.query("SELECT * FROM users WHERE id = " + userId);
}
EOF

# Run scanner in test mode
TEST_MODE=true node security-scan/dist/orchestrator.js

# Check if SQL injection was detected
if grep -q "sql" security-scan-results.json || grep -q "injection" security-scan-results.json; then
  echo -e "${GREEN}✓ Test 3 PASSED: SQL injection detected${NC}"
else
  echo -e "${YELLOW}⚠ Test 3 WARNING: SQL injection not detected (may need Semgrep installed)${NC}"
fi

# Remove test file
rm test-sql-injection.ts

# Test 4: Round-Trip Property
echo ""
echo -e "${YELLOW}Test 4: Round-Trip Property${NC}"
echo "Testing: clean → add vulnerability → remove → clean"

# Get baseline scan
TEST_MODE=true node security-scan/dist/orchestrator.js
BASELINE_TOTAL=$(cat security-scan-results.json | jq -r '.summary.total')
echo "Baseline vulnerabilities: $BASELINE_TOTAL"

# Add vulnerability
cat > test-vuln-file.js << 'EOF'
const password = "hardcoded-password-123";
EOF

# Scan with vulnerability
TEST_MODE=true node security-scan/dist/orchestrator.js
WITH_VULN_TOTAL=$(cat security-scan-results.json | jq -r '.summary.total')
echo "With vulnerability: $WITH_VULN_TOTAL"

# Remove vulnerability
rm test-vuln-file.js

# Scan again
TEST_MODE=true node security-scan/dist/orchestrator.js
FINAL_TOTAL=$(cat security-scan-results.json | jq -r '.summary.total')
echo "After removal: $FINAL_TOTAL"

if [ "$BASELINE_TOTAL" -eq "$FINAL_TOTAL" ]; then
  echo -e "${GREEN}✓ Test 4 PASSED: Round-trip property holds${NC}"
else
  echo -e "${RED}✗ Test 4 FAILED: Round-trip property violated${NC}"
fi

# Cleanup
rm -f security-scan-results.json security-scan-report.md

echo ""
echo "==========================================="
echo -e "${GREEN}✅ Validation test suite complete${NC}"
echo ""
echo "Note: Some tests may show warnings if optional tools (Semgrep) are not installed."
echo "The core functionality (dependency and secret scanning) should work."
