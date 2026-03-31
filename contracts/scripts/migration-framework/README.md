# Contract Migration Test Framework

A comprehensive testing framework for Stellar contract state migrations that ensures reliable state migration, data integrity verification, rollback testing, and performance benchmarking.

## Overview

This framework provides automated testing for contract upgrades to prevent data loss during migration processes. It includes:

- **Automated State Migration Tests**: Comprehensive testing of all upgrade paths
- **Data Integrity Verification**: Ensures no data is lost or corrupted during migration
- **Rollback Testing**: Validates rollback functionality and state restoration
- **Performance Benchmarks**: Measures migration performance with realistic data volumes
- **Test Suite Runner**: Automated test execution and reporting

## Architecture

```
migration-framework/
├── runner.ts              # Core migration execution engine
├── cli.ts                 # Migration CLI tool
├── test-framework.ts       # Comprehensive test framework
├── test-cli.ts            # Test execution CLI
├── run-tests.sh           # Bash test runner
├── migrations/            # Migration scripts
│   └── v2_staking_pool.ts
├── package.json
└── tsconfig.json
```

## Quick Start

### Prerequisites

- Node.js 18+
- Rust 1.70+
- Soroban CLI

### Installation

```bash
cd contracts/scripts/migration-framework
npm install
```

### Environment Setup

Create a `.env` file with your Stellar network configuration:

```env
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
SOROBAN_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
SOROBAN_ADMIN_SECRET=your_admin_secret_key
```

## Usage

### Running Migration Tests

#### Full Test Suite
```bash
# Run comprehensive tests for a contract
npm run test -- <CONTRACT_ID>

# Example
npm run test -- C1234567890ABCDEF --output migration-report.md
```

#### Performance Benchmarks
```bash
# Run performance benchmarks
npm run benchmark -- <CONTRACT_ID> --sizes "100,500,1000,5000"

# Example
npm run benchmark -- C1234567890ABCDEF --sizes "100,1000" --output benchmarks.json
```

#### Rollback Testing
```bash
# Test rollback functionality
npm run rollback-test -- <CONTRACT_ID> <OLD_WASM_HASH>

# Example
npm run rollback-test -- C1234567890ABCDEF e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

#### State Validation
```bash
# Validate contract state integrity
npm run validate -- <CONTRACT_ID> --backup-state state-backup.json

# Example
npm run validate -- C1234567890ABCDEF --backup-state pre-migration-state.json
```

### Using the Bash Runner

```bash
# Run full test suite
./run-tests.sh full <CONTRACT_ID> [contract_name]

# Run quick smoke tests
./run-tests.sh smoke <CONTRACT_ID>

# Run specific test types
./run-tests.sh ts <CONTRACT_ID> performance
./run-tests.sh rust mvp_staking_pool

# Generate report
./run-tests.sh report

# Cleanup old test artifacts
./run-tests.sh cleanup
```

## Test Categories

### 1. Basic Migration Tests
- Verify basic migration functionality
- Test version transitions
- Validate migration completion

### 2. Data Integrity Tests
- Ensure all user stakes are preserved
- Verify reward indices remain consistent
- Check total staked amounts
- Validate global state consistency

### 3. Performance Benchmarks
- Measure execution time across data sizes
- Track gas consumption
- Monitor storage operations
- Memory usage analysis

### 4. Rollback Tests
- Verify rollback to previous versions
- Test state restoration
- Validate compensating transactions
- Check data consistency after rollback

### 5. Edge Case Tests
- Empty contract state migration
- Large dataset migration
- Maximum capacity scenarios
- Invalid version handling

## Configuration

### Test Data Sizes

Performance tests use these default data sizes:
- Small: 100 entries
- Medium: 500 entries
- Large: 1,000 entries
- Stress: 5,000 entries

Customize with `--sizes` parameter:
```bash
npm run benchmark -- <CONTRACT_ID> --sizes "50,200,800,2000"
```

### Test Scenarios

The framework includes predefined test scenarios:

- **Empty Contract**: Tests migration with no existing data
- **Single User**: Tests with minimal data
- **Multi-User**: Tests with realistic user counts
- **Max Capacity**: Tests contract storage limits
- **Edge Cases**: Tests boundary conditions

## Integration with Rust Tests

The framework includes Rust contract tests in `migration_tests.rs`:

```rust
#[test]
fn test_migration_v1_to_v2_basic() {
    // Test basic migration functionality
}

#[test]
fn test_migration_preserves_staked_balances() {
    // Test data preservation
}
```

Run Rust tests:
```bash
cd contracts/mvp_staking_pool
cargo test migration_tests
```

## Output and Reporting

### Test Reports

The framework generates comprehensive reports in Markdown format:

```markdown
# Migration Test Report

## Summary
- Total Tests: 15
- Passed: 14
- Failed: 1
- Success Rate: 93.3%

## Test Results
### Basic Migration ✅ PASS
- Execution Time: 1250ms
- Gas Used: 245000

### Data Integrity ✅ PASS
- Execution Time: 2100ms
- Gas Used: 380000

## Performance Benchmarks
| Migration | Data Size | Time (ms) | Gas Used |
|-----------|-----------|-----------|----------|
| v1→v2     | 100       | 1250      | 245000   |
| v1→v2     | 1000      | 8900      | 1.2M     |
```

### JSON Output

For programmatic consumption, use JSON output:
```bash
npm run benchmark -- <CONTRACT_ID> --output results.json
```

## Best Practices

### Before Migration
1. **Backup State**: Always create a state backup
2. **Run Tests**: Execute full test suite on testnet
3. **Review Reports**: Analyze performance and integrity results
4. **Dry Run**: Use `--dry-run` to simulate migration

### During Migration
1. **Monitor Progress**: Watch execution logs
2. **Verify Completion**: Check final version
3. **Validate State**: Run integrity checks
4. **Document Results**: Save migration logs

### After Migration
1. **Run Validation**: Verify state integrity
2. **Monitor Performance**: Track contract behavior
3. **Backup New State**: Save post-migration state
4. **Update Documentation**: Record migration details

## Troubleshooting

### Common Issues

#### Migration Fails
```bash
# Check contract version
npm run validate -- <CONTRACT_ID>

# Run dry run
npm run test -- <CONTRACT_ID> --dry-run
```

#### Performance Issues
```bash
# Run benchmarks with smaller data sizes
npm run benchmark -- <CONTRACT_ID> --sizes "10,50,100"

# Check gas consumption
npm run test -- <CONTRACT_ID> --output gas-analysis.md
```

#### Rollback Issues
```bash
# Test rollback separately
npm run rollback-test -- <CONTRACT_ID> <OLD_WASM_HASH>

# Verify backup state
npm run validate -- <CONTRACT_ID> --backup-state backup.json
```

### Debug Mode

Enable verbose logging:
```bash
DEBUG=migration:* npm run test -- <CONTRACT_ID>
```

## Contributing

### Adding New Migration Tests

1. **TypeScript Tests**: Add to `test-framework.ts`
2. **Rust Tests**: Add to `migration_tests.rs`
3. **Test Scenarios**: Add to `migration_test_helpers.rs`
4. **CLI Commands**: Extend `test-cli.ts`

### Test Structure

```typescript
async testNewFeature(): Promise<void> {
    const testName = 'New Feature Test';
    
    try {
        const { result, time } = await this.measureExecutionTime(async () => {
            // Test implementation
        });

        this.results.push({
            testName,
            passed: true,
            executionTime: time
        });
    } catch (error) {
        this.results.push({
            testName,
            passed: false,
            error: error.message,
            executionTime: 0
        });
    }
}
```

## Security Considerations

- **Secret Management**: Never commit admin secrets
- **Network Isolation**: Test on testnet before mainnet
- **State Verification**: Always verify post-migration state
- **Rollback Planning**: Have rollback strategy ready
- **Access Control**: Limit migration permissions

## License

This framework is part of the Stellar Wave project and follows the same license terms.

## Support

For issues and questions:
1. Check existing test reports
2. Review migration logs
3. Run diagnostic tests
4. Create detailed issue reports

---

**Note**: This framework is designed to prevent data loss during contract migrations. Always run comprehensive tests before production migrations.
