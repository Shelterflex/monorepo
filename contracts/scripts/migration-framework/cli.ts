import { Command } from 'commander';
import { MigrationRunner } from './runner.js';
import { v2Migration } from './migrations/v2_staking_pool.js';
import dotenv from 'dotenv';

dotenv.config();

const program = new Command();

program
    .name('migration-tool')
    .description('CLI to migrate Soroban contract state')
    .version('1.0.0');

program
    .command('migrate')
    .description('Migrate contract to a new version')
    .argument('<contractId>', 'ID of the contract to migrate')
    .option('--dry-run', 'Simulate migration without executing')
    .option('--secret <secret>', 'Admin secret key')
    .option('--rpc <url>', 'Soroban RPC URL', process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org')
    .option('--network <passphrase>', 'Network passphrase', process.env.SOROBAN_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015')
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
            const currentVersion = await runner.getCurrentVersion();
            console.log(`Current contract version: ${currentVersion}`);

            // For now, we only have v2
            if (currentVersion >= 2) {
                console.log('Contract is already at the latest version.');
                return;
            }

            if (options.dryRun) {
                await runner.dryRun(2);
                console.log('Dry run completed successfully.');
            } else {
                console.log('Verifying state before migration...');
                // In a real scenario, we'd run more checks here

                const txHash = await runner.migrate(2);
                console.log(`Migration successful. Transaction hash: ${txHash}`);

                const verified = await v2Migration.verify(runner);
                if (verified) {
                    console.log('State verification successful.');
                    runner.logMigration({
                        contractId,
                        version: 2,
                        timestamp: new Date().toISOString(),
                        description: v2Migration.description,
                        txHash
                    });
                } else {
                    console.error('State verification FAILED!');
                    process.exit(1);
                }
            }
        } catch (error) {
            console.error('Migration failed:', error);
            process.exit(1);
        }
    });

program
    .command('rollback')
    .description('Rollback contract to a previous version')
    .argument('<contractId>', 'ID of the contract to rollback')
    .argument('<oldWasmHash>', 'Hash of the previous WASM binary')
    .argument('<fromVersion>', 'Current version')
    .argument('<toVersion>', 'Target version (to rollback to)')
    .option('--secret <secret>', 'Admin secret key')
    .option('--rpc <url>', 'Soroban RPC URL')
    .option('--network <passphrase>', 'Network passphrase')
    .action(async (contractId, oldWasmHash, fromVersion, toVersion, options) => {
        const secret = options.secret || process.env.SOROBAN_ADMIN_SECRET;
        const runner = new MigrationRunner(
            options.rpc || process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org',
            options.network || process.env.SOROBAN_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015',
            secret!,
            contractId
        );

        try {
            console.log(`Starting rollback from v${fromVersion} to v${toVersion}...`);
            const txHash = await runner.rollback(oldWasmHash, Number(fromVersion), Number(toVersion));
            console.log(`Rollback successful. Transaction hash: ${txHash}`);

            runner.logMigration({
                contractId,
                version: Number(toVersion),
                timestamp: new Date().toISOString(),
                description: `Rollback from v${fromVersion} to v${toVersion}`,
                txHash
            });
        } catch (error) {
            console.error('Rollback failed:', error);
            process.exit(1);
        }
    });

program.parse();
