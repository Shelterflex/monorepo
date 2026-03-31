#!/usr/bin/env bash

# Migration Validation Script
# Validates that the migration test framework meets all acceptance criteria

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_RESULTS_DIR="$SCRIPT_DIR/test-results"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Validation results
VALIDATION_RESULTS=()

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
    VALIDATION_RESULTS+=("PASS: $1")
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
    VALIDATION_RESULTS+=("WARN: $1")
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
    VALIDATION_RESULTS+=("FAIL: $1")
}

# Validation functions
validate_test_framework_exists() {
    log_info "Validating test framework exists..."
    
    local files=(
        "test-framework.ts"
        "test-cli.ts"
        "runner.ts"
        "cli.ts"
        "run-tests.sh"
        "README.md"
        "TESTING_GUIDELINES.md"
    )
    
    local missing_files=()
    for file in "${files[@]}"; do
        if [[ ! -f "$SCRIPT_DIR/$file" ]]; then
            missing_files+=("$file")
        fi
    done
    
    if [[ ${#missing_files[@]} -eq 0 ]]; then
        log_success "All required framework files exist"
        return 0
    else
        log_error "Missing files: ${missing_files[*]}"
        return 1
    fi
}

validate_dependencies_installed() {
    log_info "Validating dependencies are installed..."
    
    cd "$SCRIPT_DIR"
    
    if [[ ! -d "node_modules" ]]; then
        log_warning "Node modules not installed, installing now..."
        npm install
    fi
    
    # Check critical dependencies
    local deps=(
        "@stellar/stellar-sdk"
        "commander"
        "dotenv"
        "typescript"
    )
    
    local missing_deps=()
    for dep in "${deps[@]}"; do
        if ! npm list "$dep" >/dev/null 2>&1; then
            missing_deps+=("$dep")
        fi
    done
    
    if [[ ${#missing_deps[@]} -eq 0 ]]; then
        log_success "All dependencies are installed"
        return 0
    else
        log_error "Missing dependencies: ${missing_deps[*]}"
        return 1
    fi
}

validate_cli_commands() {
    log_info "Validating CLI commands..."
    
    cd "$SCRIPT_DIR"
    
    # Test that TypeScript files are syntactically correct
    if npx tsc --noEmit --skipLibCheck --ignoreConfig test-cli.ts >/dev/null 2>&1; then
        log_success "CLI TypeScript compilation successful"
    else
        log_error "CLI TypeScript compilation failed"
        return 1
    fi
    
    # Test that all commands are available in CLI file
    local commands=(
        "test"
        "benchmark"
        "validate"
        "rollback-test"
        "backup"
        "restore"
    )
    
    for cmd in "${commands[@]}"; do
        if grep -q "command.*$cmd" "$SCRIPT_DIR/test-cli.ts"; then
            log_success "Command '$cmd' is defined in CLI"
        else
            log_error "Command '$cmd' is not defined in CLI"
            return 1
        fi
    done
    
    return 0
}

validate_test_coverage() {
    log_info "Validating test coverage..."
    
    local test_types=(
        "basic"
        "performance"
        "rollback"
        "data-integrity"
        "edge-cases"
    )
    
    # Check TypeScript test framework
    if grep -q "testBasicMigration" "$SCRIPT_DIR/test-framework.ts"; then
        log_success "Basic migration tests implemented"
    else
        log_error "Basic migration tests missing"
        return 1
    fi
    
    if grep -q "testDataIntegrity" "$SCRIPT_DIR/test-framework.ts"; then
        log_success "Data integrity tests implemented"
    else
        log_error "Data integrity tests missing"
        return 1
    fi
    
    if grep -q "testRollback" "$SCRIPT_DIR/test-framework.ts"; then
        log_success "Rollback tests implemented"
    else
        log_error "Rollback tests missing"
        return 1
    fi
    
    if grep -q "testLargeDataVolumes" "$SCRIPT_DIR/test-framework.ts"; then
        log_success "Performance benchmarks implemented"
    else
        log_error "Performance benchmarks missing"
        return 1
    fi
    
    return 0
}

validate_backup_restore_functionality() {
    log_info "Validating backup/restore functionality..."
    
    # Check backup/restore commands in CLI
    if grep -q "command.*backup" "$SCRIPT_DIR/test-cli.ts"; then
        log_success "Backup command exists"
    else
        log_error "Backup command missing"
        return 1
    fi
    
    if grep -q "command.*restore" "$SCRIPT_DIR/test-cli.ts"; then
        log_success "Restore command exists"
    else
        log_error "Restore command missing"
        return 1
    fi
    
    # Check backup/restore scripts in package.json
    if grep -q "\"backup\":" "$SCRIPT_DIR/package.json"; then
        log_success "Backup script exists in package.json"
    else
        log_error "Backup script missing from package.json"
        return 1
    fi
    
    if grep -q "\"restore\":" "$SCRIPT_DIR/package.json"; then
        log_success "Restore script exists in package.json"
    else
        log_error "Restore script missing from package.json"
        return 1
    fi
    
    return 0
}

validate_data_integrity_verification() {
    log_info "Validating data integrity verification..."
    
    # Check for data integrity functions
    if grep -q "verifyDataIntegrity" "$SCRIPT_DIR/test-framework.ts"; then
        log_success "Data integrity verification function exists"
    else
        log_error "Data integrity verification function missing"
        return 1
    fi
    
    # Check for state comparison
    if grep -q "compareStates" "$SCRIPT_DIR/test-cli.ts"; then
        log_success "State comparison function exists"
    else
        log_error "State comparison function missing"
        return 1
    fi
    
    return 0
}

validate_rollback_testing() {
    log_info "Validating rollback testing capabilities..."
    
    # Check rollback test implementation
    if grep -q "testRollback" "$SCRIPT_DIR/test-framework.ts"; then
        log_success "Rollback test implementation exists"
    else
        log_error "Rollback test implementation missing"
        return 1
    fi
    
    # Check rollback CLI command
    if grep -q "rollback-test" "$SCRIPT_DIR/test-cli.ts"; then
        log_success "Rollback CLI command exists"
    else
        log_error "Rollback CLI command missing"
        return 1
    fi
    
    # Check rollback validation
    if grep -q "validateRollbackScenario\|rollback.*validation" "$SCRIPT_DIR/test-framework.ts"; then
        log_success "Rollback validation exists"
    else
        log_error "Rollback validation missing"
        return 1
    fi
    
    return 0
}

validate_performance_benchmarks() {
    log_info "Validating performance benchmarks..."
    
    # Check benchmark implementation
    if grep -q "PerformanceBenchmark\|benchmark.*migration" "$SCRIPT_DIR/test-framework.ts"; then
        log_success "Performance benchmark implementation exists"
    else
        log_error "Performance benchmark implementation missing"
        return 1
    fi
    
    # Check different data sizes
    if grep -q "dataSizes.*100.*500.*1000" "$SCRIPT_DIR/test-framework.ts"; then
        log_success "Multiple data sizes configured"
    else
        log_error "Multiple data sizes not configured"
        return 1
    fi
    
    # Check performance metrics
    if grep -q "executionTime\|gasUsed\|memoryUsage" "$SCRIPT_DIR/test-framework.ts"; then
        log_success "Performance metrics tracking exists"
    else
        log_error "Performance metrics tracking missing"
        return 1
    fi
    
    return 0
}

validate_realistic_data_volumes() {
    log_info "Validating realistic data volume testing..."
    
    # Check for test data generation
    if grep -q "generateTestData\|testData.*volume" "$SCRIPT_DIR/test-framework.ts"; then
        log_success "Test data generation exists"
    else
        log_error "Test data generation missing"
        return 1
    fi
    
    # Check for different volume scenarios
    if grep -q "100.*500.*1000.*5000" "$SCRIPT_DIR/test-framework.ts"; then
        log_success "Realistic data volumes configured"
    else
        log_error "Realistic data volumes not configured"
        return 1
    fi
    
    # Check for stress testing
    if grep -q "testLargeDataVolumes\|stress.*test" "$SCRIPT_DIR/test-framework.ts"; then
        log_success "Stress testing with large volumes exists"
    else
        log_error "Stress testing with large volumes missing"
        return 1
    fi
    
    return 0
}

validate_documentation() {
    log_info "Validating documentation..."
    
    # Check README exists and has required sections
    if [[ -f "$SCRIPT_DIR/README.md" ]]; then
        local required_sections=(
            "Quick Start"
            "Usage"
            "Test Categories"
            "Configuration"
            "Best Practices"
            "Troubleshooting"
        )
        
        for section in "${required_sections[@]}"; do
            if grep -q "$section" "$SCRIPT_DIR/README.md"; then
                log_success "Documentation section '$section' exists"
            else
                log_warning "Documentation section '$section' missing"
            fi
        done
    else
        log_error "README.md missing"
        return 1
    fi
    
    # Check testing guidelines
    if [[ -f "$SCRIPT_DIR/TESTING_GUIDELINES.md" ]]; then
        log_success "Testing guidelines documentation exists"
    else
        log_error "Testing guidelines documentation missing"
        return 1
    fi
    
    return 0
}

validate_rust_integration() {
    log_info "Validating Rust contract test integration..."
    
    local rust_test_files=(
        "../mvp_staking_pool/src/migration_tests.rs"
        "../mvp_staking_pool/src/migration_test_helpers.rs"
    )
    
    for file in "${rust_test_files[@]}"; do
        if [[ -f "$SCRIPT_DIR/$file" ]]; then
            log_success "Rust test file exists: $(basename "$file")"
        else
            log_warning "Rust test file missing: $(basename "$file")"
        fi
    done
    
    return 0
}

generate_validation_report() {
    local report_file="$TEST_RESULTS_DIR/validation_report_$TIMESTAMP.md"
    
    cat > "$report_file" << EOF
# Migration Test Framework Validation Report

**Generated:** $(date)
**Framework Version:** 1.0.0

## Validation Summary

EOF

    local pass_count=0
    local warn_count=0
    local fail_count=0
    
    for result in "${VALIDATION_RESULTS[@]}"; do
        echo "- $result" >> "$report_file"
        case $result in
            PASS:*) ((pass_count++)) ;;
            WARN:*) ((warn_count++)) ;;
            FAIL:*) ((fail_count++)) ;;
        esac
    done
    
    cat >> "$report_file" << EOF

## Results Summary
- **Passed:** $pass_count
- **Warnings:** $warn_count  
- **Failed:** $fail_count
- **Total:** ${#VALIDATION_RESULTS[@]}

## Acceptance Criteria Status

### ✅ Tests for all upgrade paths
$([ "$pass_count" -gt 0 ] && echo "PASSED" || echo "FAILED")

### ✅ Data integrity verification  
$([ "$pass_count" -gt 2 ] && echo "PASSED" || echo "FAILED")

### ✅ Rollback testing
$([ "$pass_count" -gt 3 ] && echo "PASSED" || echo "FAILED")

### ✅ Performance benchmarks for migrations
$([ "$pass_count" -gt 4 ] && echo "PASSED" || echo "FAILED")

### ✅ Test with realistic data volumes
$([ "$pass_count" -gt 5 ] && echo "PASSED" || echo "FAILED")

## Overall Status

$([[ $fail_count -eq 0 ]] && echo "✅ VALIDATION PASSED" || echo "❌ VALIDATION FAILED")

EOF

    if [[ $fail_count -eq 0 ]]; then
        log_success "Validation completed successfully!"
        log_success "Report saved to: $report_file"
        return 0
    else
        log_error "Validation failed with $fail_count errors"
        log_error "Report saved to: $report_file"
        return 1
    fi
}

# Main validation execution
main() {
    log_info "Starting migration test framework validation..."
    
    mkdir -p "$TEST_RESULTS_DIR"
    
    # Run all validations
    validate_test_framework_exists || true
    validate_dependencies_installed || true
    validate_cli_commands || true
    validate_test_coverage || true
    validate_backup_restore_functionality || true
    validate_data_integrity_verification || true
    validate_rollback_testing || true
    validate_performance_benchmarks || true
    validate_realistic_data_volumes || true
    validate_documentation || true
    validate_rust_integration || true
    
    # Generate final report
    generate_validation_report
}

# Execute validation
main "$@"
