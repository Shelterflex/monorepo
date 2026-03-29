import { MigrationRunner } from '../runner.js';
import type { MigrationScript } from '../runner.js';

export const v2Migration: MigrationScript = {
    version: 2,
    description: 'Upgrade mvp_staking_pool to version 2',
    async migrate(runner: MigrationRunner) {
        // In a real migration, we might pass some data here
        await runner.migrate(2);
    },
    async verify(runner: MigrationRunner) {
        const version = await runner.getCurrentVersion();
        return version === 2;
    }
};
