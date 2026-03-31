import { MigrationRunner } from './runner.js';
import { MigrationTestFramework } from './test-framework.js';
import { Command } from 'commander';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const program = new Command();

program
    .name('migration-test')
    .description('Test framework for contract state migrations')
    .version('1.0.0');

program
    .command('test')
    .description('Run comprehensive migration tests')
    .argument('<contractId>', 'ID of the contract to test')
    .option('--secret <secret>', 'Admin secret key')
    .option('--rpc <url>', 'Soroban RPC URL', process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org')
    .option('--network <passphrase>', 'Network passphrase', process.env.SOROBAN_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015')
    .option('--output <file>', 'Output report file', 'migration-test-report.md')
    .option('--performance', 'Run performance benchmarks')
    .action(async (contractId, options) => {
        const secret = options.secret || process.env.SOROBAN_ADMIN_SECRET;
        if (!secret) {
            console.error('Admin secret is required (--secret or SOROBAN_ADMIN_SECRET)');
            process.exit(1);
        }

        console.log(`Starting migration tests for contract: ${contractId}`);
        
        const runner = new MigrationRunner(
            options.rpc,
            options.network,
            secret,
            contractId
        );

        const testFramework = new MigrationTestFramework(runner);

        try {
            const results = await testFramework.runFullMigrationTestSuite();
            const report = testFramework.generateReport();
            
            console.log('\n' + '='.repeat(50));
            console.log('MIGRATION TEST RESULTS');
            console.log('='.repeat(50));
            console.log(report);
            
            if (options.output) {
                fs.writeFileSync(options.output, report);
                console.log(`\nReport saved to: ${options.output}`);
            }

            const failedTests = results.filter(r => !r.passed);
            if (failedTests.length > 0) {
                console.log(`\n⚠️  ${failedTests.length} test(s) failed. See report for details.`);
                process.exit(1);
            } else {
                console.log('\n🎉 All tests passed!');
            }

        } catch (error) {
            console.error('Test execution failed:', error);
            process.exit(1);
        }
    });

program
    .command('benchmark')
    .description('Run performance benchmarks for migrations')
    .argument('<contractId>', 'ID of the contract to benchmark')
    .option('--secret <secret>', 'Admin secret key')
    .option('--rpc <url>', 'Soroban RPC URL', process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org')
    .option('--network <passphrase>', 'Network passphrase', process.env.SOROBAN_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015')
    .option('--sizes <sizes>', 'Data sizes to test (comma-separated)', '100,500,1000,5000')
    .option('--output <file>', 'Benchmark results file', 'migration-benchmarks.json')
    .action(async (contractId, options) => {
        const secret = options.secret || process.env.SOROBAN_ADMIN_SECRET;
        if (!secret) {
            console.error('Admin secret is required (--secret or SOROBAN_ADMIN_SECRET)');
            process.exit(1);
        }

        const runner = new MigrationRunner(
            options.rpc,
            options.network,
            secret,
            contractId
        );

        const testFramework = new MigrationTestFramework(runner);

        try {
            console.log('Running performance benchmarks...');
            await testFramework.runFullMigrationTestSuite();
            
            const benchmarks = testFramework.getBenchmarks();
            
            console.log('\n' + '='.repeat(50));
            console.log('PERFORMANCE BENCHMARKS');
            console.log('='.repeat(50));
            
            console.table(benchmarks);
            
            if (options.output) {
                fs.writeFileSync(options.output, JSON.stringify(benchmarks, null, 2));
                console.log(`\nBenchmark results saved to: ${options.output}`);
            }

        } catch (error) {
            console.error('Benchmark execution failed:', error);
            process.exit(1);
        }
    });

program
    .command('validate')
    .description('Validate migration integrity for a specific contract')
    .argument('<contractId>', 'ID of the contract to validate')
    .option('--secret <secret>', 'Admin secret key')
    .option('--rpc <url>', 'Soroban RPC URL', process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org')
    .option('--network <passphrase>', 'Network passphrase', process.env.SOROBAN_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015')
    .option('--backup-state <file>', 'File containing backup state for comparison')
    .action(async (contractId, options) => {
        const secret = options.secret || process.env.SOROBAN_ADMIN_SECRET;
        if (!secret) {
            console.error('Admin secret is required (--secret or SOROBAN_ADMIN_SECRET)');
            process.exit(1);
        }

        const runner = new MigrationRunner(
            options.rpc,
            options.network,
            secret,
            contractId
        );

        try {
            console.log('Validating contract state integrity...');
            
            const currentVersion = await runner.getCurrentVersion();
            console.log(`Current contract version: ${currentVersion}`);
            
            const testFramework = new MigrationTestFramework(runner);
            await testFramework.testDataIntegrity();
            
            const results = testFramework.getResults();
            const integrityTest = results.find(r => r.testName === 'Data Integrity');
            
            if (integrityTest?.passed) {
                console.log('✅ State integrity validation PASSED');
            } else {
                console.log('❌ State integrity validation FAILED');
                if (integrityTest?.error) {
                    console.log('Error:', integrityTest.error);
                }
                process.exit(1);
            }

            if (options.backupState) {
                console.log('\nComparing with backup state...');
                const backupState = JSON.parse(fs.readFileSync(options.backupState, 'utf8'));
                
                const currentState = await testFramework['captureContractState']();
                const comparison = compareStates(backupState, currentState);
                
                console.log('State comparison results:');
                console.log(`- Matching fields: ${comparison.matching.length}`);
                console.log(`- Different fields: ${comparison.different.length}`);
                console.log(`- Missing fields: ${comparison.missing.length}`);
                
                if (comparison.different.length > 0) {
                    console.log('\nDifferences found:');
                    comparison.different.forEach(([field, before, after]) => {
                        console.log(`  ${field}: ${before} → ${after}`);
                    });
                }
            }

        } catch (error) {
            console.error('Validation failed:', error);
            process.exit(1);
        }
    });

program
    .command('rollback-test')
    .description('Test rollback functionality')
    .argument('<contractId>', 'ID of the contract to test rollback')
    .argument('<oldWasmHash>', 'Hash of the previous WASM binary')
    .option('--secret <secret>', 'Admin secret key')
    .option('--rpc <url>', 'Soroban RPC URL', process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org')
    .option('--network <passphrase>', 'Network passphrase', process.env.SOROBAN_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015')
    .action(async (contractId, oldWasmHash, options) => {
        const secret = options.secret || process.env.SOROBAN_ADMIN_SECRET;
        if (!secret) {
            console.error('Admin secret is required (--secret or SOROBAN_ADMIN_SECRET)');
            process.exit(1);
        }

        const runner = new MigrationRunner(
            options.rpc,
            options.network,
            secret,
            contractId
        );

        const testFramework = new MigrationTestFramework(runner);

        try {
            console.log('Testing rollback functionality...');
            await testFramework.testRollback();
            
            const results = testFramework.getResults();
            const rollbackTest = results.find(r => r.testName === 'Rollback Test');
            
            if (rollbackTest?.passed) {
                console.log('✅ Rollback test PASSED');
            } else {
                console.log('❌ Rollback test FAILED');
                if (rollbackTest?.error) {
                    console.log('Error:', rollbackTest.error);
                }
                process.exit(1);
            }

        } catch (error) {
            console.error('Rollback test failed:', error);
            process.exit(1);
        }
    });

program
    .command('backup')
    .description('Backup contract state before migration')
    .argument('<contractId>', 'ID of the contract to backup')
    .option('--secret <secret>', 'Admin secret key')
    .option('--rpc <url>', 'Soroban RPC URL', process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org')
    .option('--network <passphrase>', 'Network passphrase', process.env.SOROBAN_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015')
    .option('--output <file>', 'Backup file', 'contract-backup.json')
    .action(async (contractId, options) => {
        const secret = options.secret || process.env.SOROBAN_ADMIN_SECRET;
        if (!secret) {
            console.error('Admin secret is required (--secret or SOROBAN_ADMIN_SECRET)');
            process.exit(1);
        }

        const runner = new MigrationRunner(
            options.rpc,
            options.network,
            secret,
            contractId
        );

        try {
            console.log('Creating contract state backup...');
            const testFramework = new MigrationTestFramework(runner);
            const backup = await testFramework['captureContractState']();
            
            fs.writeFileSync(options.output, JSON.stringify(backup, null, 2));
            console.log(`✅ Backup saved to: ${options.output}`);

        } catch (error) {
            console.error('Backup failed:', error);
            process.exit(1);
        }
    });

program
    .command('restore')
    .description('Restore contract state from backup (for testing rollback)')
    .argument('<contractId>', 'ID of the contract to restore')
    .argument('<backupFile>', 'Backup file to restore from')
    .option('--secret <secret>', 'Admin secret key')
    .option('--rpc <url>', 'Soroban RPC URL', process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org')
    .option('--network <passphrase>', 'Network passphrase', process.env.SOROBAN_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015')
    .action(async (contractId, backupFile, options) => {
        const secret = options.secret || process.env.SOROBAN_ADMIN_SECRET;
        if (!secret) {
            console.error('Admin secret is required (--secret or SOROBAN_ADMIN_SECRET)');
            process.exit(1);
        }

        if (!fs.existsSync(backupFile)) {
            console.error('Backup file not found:', backupFile);
            process.exit(1);
        }

        const runner = new MigrationRunner(
            options.rpc,
            options.network,
            secret,
            contractId
        );

        try {
            console.log('Restoring contract state from backup...');
            const backup = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
            
            // In a real implementation, this would restore the state
            // For now, we just validate the backup can be read
            console.log('✅ Backup validated successfully');
            console.log('Note: Actual state restoration would require contract-specific implementation');

        } catch (error) {
            console.error('Restore failed:', error);
            process.exit(1);
        }
    });

function compareStates(backup: any, current: any): {
    matching: string[];
    different: [string, any, any][];
    missing: string[];
} {
    const matching: string[] = [];
    const different: [string, any, any][] = [];
    const missing: string[] = [];

    const allKeys = new Set([...Object.keys(backup), ...Object.keys(current)]);

    for (const key of allKeys) {
        if (!(key in backup)) {
            missing.push(key);
            continue;
        }
        if (!(key in current)) {
            missing.push(key);
            continue;
        }

        if (JSON.stringify(backup[key]) === JSON.stringify(current[key])) {
            matching.push(key);
        } else {
            different.push([key, backup[key], current[key]]);
        }
    }

    return { matching, different, missing };
}

program.parse();
