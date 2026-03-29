export interface MigrationScript {
    version: number;
    description: string;
    migrate(runner: MigrationRunner): Promise<void>;
    verify(runner: MigrationRunner): Promise<boolean>;
}
export interface MigrationLog {
    contractId: string;
    version: number;
    timestamp: string;
    description: string;
    txHash?: string;
}
export declare class MigrationRunner {
    private rpc;
    private networkPassphrase;
    private adminKeypair;
    private contractId;
    constructor(rpcUrl: string, networkPassphrase: string, adminSecret: string, contractId: string);
    getCurrentVersion(): Promise<number>;
    upgrade(wasmHash: string): Promise<string>;
    migrate(toVersion: number, data?: Buffer): Promise<string>;
    invoke(fnName: string, args: any[], simulate?: boolean): Promise<any>;
    dryRun(toVersion: number, data?: Buffer): Promise<void>;
    rollback(oldWasmHash: string, fromVersion: number, toVersion: number, data?: Buffer): Promise<string>;
    logMigration(log: MigrationLog): void;
}
//# sourceMappingURL=runner.d.ts.map