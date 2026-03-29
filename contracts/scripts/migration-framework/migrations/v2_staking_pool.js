import { MigrationRunner } from '../runner.js';
export const v2Migration = {
    version: 2,
    description: 'Upgrade mvp_staking_pool to version 2',
    async migrate(runner) {
        // In a real migration, we might pass some data here
        await runner.migrate(2);
    },
    async verify(runner) {
        const version = await runner.getCurrentVersion();
        return version === 2;
    }
};
//# sourceMappingURL=v2_staking_pool.js.map