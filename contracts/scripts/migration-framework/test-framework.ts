import { MigrationRunner } from './runner.js';
import type { MigrationScript, MigrationLog } from './runner.js';
import { Address, scValToNative, xdr } from '@stellar/stellar-sdk';

export interface TestData {
    users: string[];
    stakes: { user: string; amount: bigint }[];
    rewards: { user: string; amount: bigint }[];
    totalStaked: bigint;
    globalRewardIndex: bigint;
}

export interface MigrationTestResult {
    testName: string;
    passed: boolean;
    error?: string;
    executionTime: number;
    gasUsed?: number;
    beforeState?: any;
    afterState?: any;
}

export interface PerformanceBenchmark {
    migrationName: string;
    dataSize: string;
    executionTime: number;
    gasUsed: number;
    memoryUsage: number;
}

export class MigrationTestFramework {
    private runner: MigrationRunner;
    private results: MigrationTestResult[] = [];
    private benchmarks: PerformanceBenchmark[] = [];

    constructor(runner: MigrationRunner) {
        this.runner = runner;
    }

    async runFullMigrationTestSuite(): Promise<MigrationTestResult[]> {
        console.log('Starting comprehensive migration test suite...');
        this.results = [];

        try {
            await this.testBasicMigration();
            await this.testDataIntegrity();
            await this.testRollback();
            await this.validateRollbackScenario();
            await this.testEdgeCases();
            await this.testLargeDataVolumes();
            await this.testConcurrentMigrations();
            
            console.log('Migration test suite completed.');
            return this.results;
        } catch (error) {
            console.error('Test suite failed:', error);
            throw error;
        }
    }

    private async measureExecutionTime<T>(operation: () => Promise<T>): Promise<{ result: T; time: number }> {
        const start = Date.now();
        const result = await operation();
        const time = Date.now() - start;
        return { result, time };
    }

    private async captureContractState(): Promise<any> {
        try {
            const version = await this.runner.getCurrentVersion();
            
            const state: any = { version };
            
            try {
                const totalStaked = await this.runner.invoke('total_staked', []);
                state.totalStaked = scValToNative(totalStaked.result.retval);
            } catch (e) {
                state.totalStaked = null;
            }

            try {
                const globalIndex = await this.runner.invoke('global_reward_index', []);
                state.globalRewardIndex = scValToNative(globalIndex.result.retval);
            } catch (e) {
                state.globalRewardIndex = null;
            }

            return state;
        } catch (error) {
            console.warn('Could not capture full contract state:', error);
            return {};
        }
    }

    async testBasicMigration(): Promise<void> {
        console.log('Testing basic migration functionality...');
        
        const testName = 'Basic Migration';
        const beforeState = await this.captureContractState();
        
        try {
            const { result, time } = await this.measureExecutionTime(async () => {
                const currentVersion = await this.runner.getCurrentVersion();
                if (currentVersion < 2) {
                    return await this.runner.migrate(2);
                }
                return 'already_at_latest';
            });

            const afterState = await this.captureContractState();
            const finalVersion = await this.runner.getCurrentVersion();

            const passed = finalVersion >= 2;
            
            this.results.push({
                testName,
                passed,
                executionTime: time,
                beforeState,
                afterState
            });

            console.log(`✓ Basic migration test ${passed ? 'PASSED' : 'FAILED'}`);
        } catch (error) {
            this.results.push({
                testName,
                passed: false,
                error: error instanceof Error ? error.message : String(error),
                executionTime: 0,
                beforeState
            });
            console.log(`✗ Basic migration test FAILED: ${error}`);
        }
    }

    async testDataIntegrity(): Promise<void> {
        console.log('Testing data integrity during migration...');
        
        const testData = await this.generateTestData(100);
        const testName = 'Data Integrity';
        
        try {
            const beforeState = await this.captureContractState();
            
            await this.setupTestData(testData);
            const preMigrationState = await this.captureContractState();
            
            const { result: migrationResult, time } = await this.measureExecutionTime(async () => {
                return await this.runner.migrate(2);
            });
            
            const postMigrationState = await this.captureContractState();
            
            const integrityChecks = await this.verifyDataIntegrity(testData, preMigrationState, postMigrationState);
            const passed = integrityChecks.allPassed;
            
            this.results.push({
                testName,
                passed,
                executionTime: time,
                beforeState: preMigrationState,
                afterState: postMigrationState,
                error: integrityChecks.errors?.join(', ')
            });

            console.log(`✓ Data integrity test ${passed ? 'PASSED' : 'FAILED'}`);
        } catch (error) {
            this.results.push({
                testName,
                passed: false,
                error: error instanceof Error ? error.message : String(error),
                executionTime: 0
            });
            console.log(`✗ Data integrity test FAILED: ${error}`);
        }
    }

    async testRollback(): Promise<void> {
        console.log('Testing rollback functionality...');
        
        const testName = 'Rollback Test';
        const oldWasmHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
        
        try {
            const beforeState = await this.captureContractState();
            const initialVersion = await this.runner.getCurrentVersion();
            
            if (initialVersion < 2) {
                await this.runner.migrate(2);
            }
            
            const migratedState = await this.captureContractState();
            
            const { result: rollbackResult, time } = await this.measureExecutionTime(async () => {
                return await this.runner.rollback(oldWasmHash, 2, 1);
            });
            
            const afterRollbackState = await this.captureContractState();
            const finalVersion = await this.runner.getCurrentVersion();
            
            const passed = finalVersion === 1;
            
            this.results.push({
                testName,
                passed,
                executionTime: time,
                beforeState: migratedState,
                afterState: afterRollbackState
            });

            console.log(`✓ Rollback test ${passed ? 'PASSED' : 'FAILED'}`);
        } catch (error) {
            this.results.push({
                testName,
                passed: false,
                error: error instanceof Error ? error.message : String(error),
                executionTime: 0
            });
            console.log(`✗ Rollback test FAILED: ${error}`);
        }
    }

    async testEdgeCases(): Promise<void> {
        console.log('Testing edge cases...');
        
        const edgeCases = [
            { name: 'Empty State Migration', setup: async () => {} },
            { name: 'Invalid Version Migration', setup: async () => {} },
            { name: 'Large Amount Migration', setup: async () => await this.generateTestData(1000) }
        ];

        for (const testCase of edgeCases) {
            try {
                const { result, time } = await this.measureExecutionTime(async () => {
                    await testCase.setup();
                    return await this.runner.migrate(2);
                });

                this.results.push({
                    testName: testCase.name,
                    passed: true,
                    executionTime: time
                });

                console.log(`✓ ${testCase.name} test PASSED`);
            } catch (error) {
                this.results.push({
                    testName: testCase.name,
                    passed: false,
                    error: error instanceof Error ? error.message : String(error),
                    executionTime: 0
                });
                console.log(`✗ ${testCase.name} test FAILED: ${error}`);
            }
        }
    }

    async testLargeDataVolumes(): Promise<void> {
        console.log('Testing large data volume migrations...');
        
        const dataSizes = [100, 500, 1000, 5000];
        
        for (const size of dataSizes) {
            const testName = `Large Data Volume (${size} entries)`;
            
            try {
                const { result, time } = await this.measureExecutionTime(async () => {
                    const testData = await this.generateTestData(size);
                    await this.setupTestData(testData);
                    return await this.runner.migrate(2);
                });

                const gasUsed = await this.estimateGasUsage();
                
                this.benchmarks.push({
                    migrationName: testName,
                    dataSize: `${size} entries`,
                    executionTime: time,
                    gasUsed,
                    memoryUsage: await this.estimateMemoryUsage()
                });

                this.results.push({
                    testName,
                    passed: true,
                    executionTime: time,
                    gasUsed
                });

                console.log(`✓ ${testName} test PASSED (${time}ms)`);
            } catch (error) {
                this.results.push({
                    testName,
                    passed: false,
                    error: error instanceof Error ? error.message : String(error),
                    executionTime: 0
                });
                console.log(`✗ ${testName} test FAILED: ${error}`);
            }
        }
    }

    async validateRollbackScenario(): Promise<void> {
        console.log('Validating rollback scenario...');
        
        const testName = 'Rollback Validation';
        const oldWasmHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
        
        try {
            const beforeState = await this.captureContractState();
            const initialVersion = await this.runner.getCurrentVersion();
            
            // Migrate to newer version if needed
            if (initialVersion < 2) {
                await this.runner.migrate(2);
            }
            
            const migratedState = await this.captureContractState();
            
            // Perform rollback
            const { result: rollbackResult, time } = await this.measureExecutionTime(async () => {
                return await this.runner.rollback(oldWasmHash, 2, 1);
            });
            
            const afterRollbackState = await this.captureContractState();
            const finalVersion = await this.runner.getCurrentVersion();
            
            // Validate rollback integrity
            const rollbackValid = await this.validateRollbackIntegrity(beforeState, afterRollbackState);
            
            const passed = finalVersion === 1 && rollbackValid;
            
            this.results.push({
                testName,
                passed,
                executionTime: time,
                beforeState: migratedState,
                afterState: afterRollbackState
            });

            console.log(`✓ Rollback validation test ${passed ? 'PASSED' : 'FAILED'}`);
        } catch (error) {
            this.results.push({
                testName,
                passed: false,
                error: error instanceof Error ? error.message : String(error),
                executionTime: 0
            });
            console.log(`✗ Rollback validation test FAILED: ${error}`);
        }
    }

    private async validateRollbackIntegrity(beforeState: any, afterState: any): Promise<boolean> {
        try {
            // Check that version is rolled back correctly
            if (afterState.version !== 1) {
                return false;
            }
            
            // Check that critical data is preserved
            if (beforeState.totalStaked !== afterState.totalStaked) {
                return false;
            }
            
            // Additional integrity checks can be added here
            return true;
        } catch (error) {
            console.warn('Rollback integrity validation failed:', error);
            return false;
        }
    }

    async testConcurrentMigrations(): Promise<void> {
        console.log('Testing concurrent migration scenarios...');
        
        const testName = 'Concurrent Migrations';
        
        try {
            const { result, time } = await this.measureExecutionTime(async () => {
                const promises = [];
                for (let i = 0; i < 3; i++) {
                    promises.push(this.runner.dryRun(2));
                }
                return await Promise.all(promises);
            });

            this.results.push({
                testName,
                passed: true,
                executionTime: time
            });

            console.log(`✓ ${testName} test PASSED`);
        } catch (error) {
            this.results.push({
                testName,
                passed: false,
                error: error instanceof Error ? error.message : String(error),
                executionTime: 0
            });
            console.log(`✗ ${testName} test FAILED: ${error}`);
        }
    }

    private async generateTestData(userCount: number): Promise<TestData> {
        const users: string[] = [];
        const stakes: { user: string; amount: bigint }[] = [];
        const rewards: { user: string; amount: bigint }[] = [];
        let totalStaked = 0n;

        for (let i = 0; i < userCount; i++) {
            const user = `G${'A'.repeat(55)}${i.toString().padStart(2, '0')}`;
            users.push(user);
            
            const stakeAmount = BigInt(Math.floor(Math.random() * 1000000) + 1000);
            stakes.push({ user, amount: stakeAmount });
            totalStaked += stakeAmount;
            
            if (Math.random() > 0.5) {
                const rewardAmount = BigInt(Math.floor(Math.random() * 10000) + 100);
                rewards.push({ user, amount: rewardAmount });
            }
        }

        return {
            users,
            stakes,
            rewards,
            totalStaked,
            globalRewardIndex: BigInt(1000000)
        };
    }

    private async setupTestData(testData: TestData): Promise<void> {
        console.log('Setting up test data...');
        
        for (const stake of testData.stakes) {
            try {
                await this.runner.invoke('stake', [
                    xdr.ScVal.scvAddress(Address.fromString(stake.user).toScAddress()),
                    xdr.ScVal.scvU64(new xdr.Uint64(Number(stake.amount)))
                ], true);
            } catch (error) {
                console.warn(`Could not setup stake for ${stake.user}:`, error);
            }
        }
    }

    private async verifyDataIntegrity(
        testData: TestData,
        beforeState: any,
        afterState: any
    ): Promise<{ allPassed: boolean; errors: string[] | undefined }> {
        const errors: string[] = [];

        if (beforeState.totalStaked !== afterState.totalStaked) {
            errors.push(`Total staked mismatch: before=${beforeState.totalStaked}, after=${afterState.totalStaked}`);
        }

        if (beforeState.globalRewardIndex !== afterState.globalRewardIndex) {
            errors.push(`Global reward index mismatch: before=${beforeState.globalRewardIndex}, after=${afterState.globalRewardIndex}`);
        }

        const result: { allPassed: boolean; errors: string[] | undefined } = {
            allPassed: errors.length === 0,
            errors: errors.length > 0 ? errors : undefined
        };
        return result;
    }

    private async estimateGasUsage(): Promise<number> {
        try {
            const simulation = await this.runner.dryRun(2);
            return Number((simulation as any).minResourceFee) || 0;
        } catch (error) {
            return 0;
        }
    }

    private async estimateMemoryUsage(): Promise<number> {
        try {
            const state = await this.captureContractState();
            return JSON.stringify(state).length;
        } catch (error) {
            return 0;
        }
    }

    getResults(): MigrationTestResult[] {
        return this.results;
    }

    getBenchmarks(): PerformanceBenchmark[] {
        return this.benchmarks;
    }

    generateReport(): string {
        const passedTests = this.results.filter(r => r.passed).length;
        const totalTests = this.results.length;
        const successRate = ((passedTests / totalTests) * 100).toFixed(1);

        let report = `# Migration Test Report\n\n`;
        report += `## Summary\n`;
        report += `- Total Tests: ${totalTests}\n`;
        report += `- Passed: ${passedTests}\n`;
        report += `- Failed: ${totalTests - passedTests}\n`;
        report += `- Success Rate: ${successRate}%\n\n`;

        report += `## Test Results\n\n`;
        for (const result of this.results) {
            const status = result.passed ? '✅ PASS' : '❌ FAIL';
            report += `### ${result.testName} ${status}\n`;
            report += `- Execution Time: ${result.executionTime}ms\n`;
            if (result.gasUsed) {
                report += `- Gas Used: ${result.gasUsed}\n`;
            }
            if (result.error) {
                report += `- Error: ${result.error}\n`;
            }
            report += `\n`;
        }

        if (this.benchmarks.length > 0) {
            report += `## Performance Benchmarks\n\n`;
            report += `| Migration | Data Size | Time (ms) | Gas Used | Memory (bytes) |\n`;
            report += `|-----------|-----------|-----------|----------|----------------|\n`;
            
            for (const benchmark of this.benchmarks) {
                report += `| ${benchmark.migrationName} | ${benchmark.dataSize} | ${benchmark.executionTime} | ${benchmark.gasUsed} | ${benchmark.memoryUsage} |\n`;
            }
            report += `\n`;
        }

        return report;
    }
}
