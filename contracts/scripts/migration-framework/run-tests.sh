#!/usr/bin/env bash

# Migration Test Suite Runner
# This script runs comprehensive migration tests for Stellar contracts

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(dirname "$SCRIPT_DIR")"
TEST_RESULTS_DIR="$SCRIPT_DIR/test-results"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Create results directory
mkdir -p "$TEST_RESULTS_DIR"

# Function to run TypeScript migration tests
run_ts_tests() {
    local contract_id="$1"
    local test_type="$2"
    
    log_info "Running TypeScript migration tests: $test_type"
    
    cd "$SCRIPT_DIR"
    
    case "$test_type" in
        "basic")
            npm run test -- "$contract_id" --output "$TEST_RESULTS_DIR/basic_migration_$TIMESTAMP.md"
            ;;
        "performance")
            npm run benchmark -- "$contract_id" --output "$TEST_RESULTS_DIR/performance_$TIMESTAMP.json"
            ;;
        "rollback")
            npm run rollback-test -- "$contract_id" "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
            ;;
        "validation")
            npm run validate -- "$contract_id"
            ;;
        *)
            log_error "Unknown test type: $test_type"
            return 1
            ;;
    esac
}

# Function to run Rust contract tests
run_rust_tests() {
    local contract_name="$1"
    
    log_info "Running Rust contract tests for: $contract_name"
    
    cd "$CONTRACTS_DIR/$contract_name"
    
    # Run migration-specific tests
    cargo test migration_tests -- --nocapture
    
    # Run all tests if migration tests don't exist
    if [ $? -ne 0 ]; then
        log_warning "Migration tests not found, running all tests"
        cargo test -- --nocapture
    fi
}

# Function to generate test report
generate_report() {
    local report_file="$TEST_RESULTS_DIR/migration_test_report_$TIMESTAMP.md"
    
    log_info "Generating comprehensive test report: $report_file"
    
    cat > "$report_file" << EOF
# Migration Test Report

**Generated:** $(date)
**Test Environment:** Local Development

## Executive Summary

This report contains the results of comprehensive migration testing for Stellar contracts.

## Test Categories

### 1. Basic Migration Tests
- Purpose: Verify basic migration functionality
- Status: [Results will be populated]

### 2. Data Integrity Tests
- Purpose: Ensure data preservation during migration
- Status: [Results will be populated]

### 3. Performance Benchmarks
- Purpose: Measure migration performance across different data sizes
- Status: [Results will be populated]

### 4. Rollback Tests
- Purpose: Verify rollback functionality
- Status: [Results will be populated]

### 5. Edge Case Tests
- Purpose: Test migration with various edge cases
- Status: [Results will be populated]

## Detailed Results

[Detailed results will be populated here]

## Recommendations

[Recommendations will be provided based on test results]

EOF

    log_success "Report generated: $report_file"
}

# Function to validate environment
validate_environment() {
    log_info "Validating test environment..."
    
    # Check if Node.js is installed
    if ! command -v node &> /dev/null; then
        log_error "Node.js is required but not installed"
        return 1
    fi
    
    # Check if Rust is installed
    if ! command -v cargo &> /dev/null; then
        log_error "Cargo/Rust is required but not installed"
        return 1
    fi
    
    # Check if required environment variables are set
    if [ -z "$SOROBAN_ADMIN_SECRET" ]; then
        log_warning "SOROBAN_ADMIN_SECRET not set, some tests may fail"
    fi
    
    # Check if npm dependencies are installed
    cd "$SCRIPT_DIR"
    if [ ! -d "node_modules" ]; then
        log_info "Installing npm dependencies..."
        npm install
    fi
    
    log_success "Environment validation completed"
}

# Function to run full test suite
run_full_test_suite() {
    local contract_id="$1"
    local contract_name="$2"
    
    log_info "Starting full migration test suite..."
    log_info "Contract ID: $contract_id"
    log_info "Contract Name: $contract_name"
    
    # Create test results file
    local results_file="$TEST_RESULTS_DIR/test_results_$TIMESTAMP.json"
    echo '{"tests": [],' > "$results_file"
    echo '"start_time": "'$(date -Iseconds)'",' >> "$results_file"
    
    # Run TypeScript tests
    log_info "=== TypeScript Migration Tests ==="
    
    run_ts_tests "$contract_id" "basic"
    run_ts_tests "$contract_id" "performance"
    run_ts_tests "$contract_id" "rollback"
    run_ts_tests "$contract_id" "validation"
    
    # Run Rust tests
    log_info "=== Rust Contract Tests ==="
    
    if [ -n "$contract_name" ]; then
        run_rust_tests "$contract_name"
    else
        log_warning "No contract name provided, skipping Rust tests"
    fi
    
    # Complete results file
    echo '"end_time": "'$(date -Iseconds)'"}' >> "$results_file"
    
    # Generate final report
    generate_report
    
    log_success "Full test suite completed"
    log_info "Results saved to: $TEST_RESULTS_DIR"
}

# Function to run quick smoke tests
run_smoke_tests() {
    local contract_id="$1"
    
    log_info "Running smoke tests..."
    
    # Quick validation test
    run_ts_tests "$contract_id" "validation"
    
    # Basic migration test
    run_ts_tests "$contract_id" "basic"
    
    log_success "Smoke tests completed"
}

# Function to cleanup test artifacts
cleanup() {
    log_info "Cleaning up test artifacts..."
    
    # Remove temporary files older than 7 days
    find "$TEST_RESULTS_DIR" -name "*.tmp" -mtime +7 -delete 2>/dev/null || true
    
    # Remove old test results (keep last 10)
    cd "$TEST_RESULTS_DIR"
    ls -t *.json *.md 2>/dev/null | tail -n +11 | xargs -r rm
    
    log_success "Cleanup completed"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [COMMAND] [OPTIONS]"
    echo ""
    echo "Commands:"
    echo "  full <contract_id> [contract_name]  Run full test suite"
    echo "  smoke <contract_id>                 Run quick smoke tests"
    echo "  ts <contract_id> <test_type>        Run TypeScript tests only"
    echo "  rust <contract_name>                Run Rust tests only"
    echo "  report                              Generate test report"
    echo "  cleanup                             Clean up test artifacts"
    echo "  help                                Show this help message"
    echo ""
    echo "Test Types for TypeScript tests:"
    echo "  basic       Basic migration functionality"
    echo "  performance  Performance benchmarks"
    echo "  rollback    Rollback functionality"
    echo "  validation  Data integrity validation"
    echo ""
    echo "Examples:"
    echo "  $0 full C123456... mvp_staking_pool"
    echo "  $0 smoke C123456..."
    echo "  $0 ts C123456... performance"
    echo "  $0 rust mvp_staking_pool"
}

# Main script logic
main() {
    case "${1:-help}" in
        "full")
            if [ -z "$2" ]; then
                log_error "Contract ID is required for full test suite"
                show_usage
                exit 1
            fi
            validate_environment
            run_full_test_suite "$2" "${3:-}"
            ;;
        "smoke")
            if [ -z "$2" ]; then
                log_error "Contract ID is required for smoke tests"
                show_usage
                exit 1
            fi
            validate_environment
            run_smoke_tests "$2"
            ;;
        "ts")
            if [ -z "$2" ] || [ -z "$3" ]; then
                log_error "Contract ID and test type are required for TypeScript tests"
                show_usage
                exit 1
            fi
            validate_environment
            run_ts_tests "$2" "$3"
            ;;
        "rust")
            if [ -z "$2" ]; then
                log_error "Contract name is required for Rust tests"
                show_usage
                exit 1
            fi
            run_rust_tests "$2"
            ;;
        "report")
            generate_report
            ;;
        "cleanup")
            cleanup
            ;;
        "help"|*)
            show_usage
            ;;
    esac
}

# Run main function with all arguments
main "$@"
