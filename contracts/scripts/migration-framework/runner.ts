import {
    Address,
    rpc,
    Keypair,
    TransactionBuilder,
    Networks,
    Memo,
    Operation,
    StrKey,
    xdr,
    scValToNative,
    Transaction
} from '@stellar/stellar-sdk';
import * as fs from 'fs';
import * as path from 'path';

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

export class MigrationRunner {
    private rpc: rpc.Server;
    private networkPassphrase: string;
    private adminKeypair: Keypair;
    private contractId: string;

    constructor(
        rpcUrl: string,
        networkPassphrase: string,
        adminSecret: string,
        contractId: string
    ) {
        this.rpc = new rpc.Server(rpcUrl);
        this.networkPassphrase = networkPassphrase;
        this.adminKeypair = Keypair.fromSecret(adminSecret);
        this.contractId = contractId;
    }

    async getCurrentVersion(): Promise<number> {
        const result = await this.invoke('contract_version', []);
        return Number(scValToNative(result.result.retval));
    }

    async upgrade(wasmHash: string): Promise<string> {
        console.log(`Upgrading contract to WASM hash: ${wasmHash}`);
        const result = await this.invoke('upgrade_contract', [
            xdr.ScVal.scvBytes(Buffer.from(wasmHash, 'hex'))
        ]);
        return result.hash;
    }

    async migrate(toVersion: number, data: Buffer = Buffer.alloc(0)): Promise<string> {
        console.log(`Running migration to version ${toVersion}`);
        const result = await this.invoke('migrate', [
            xdr.ScVal.scvU32(toVersion),
            xdr.ScVal.scvBytes(data)
        ]);
        return result.hash;
    }

    async invoke(fnName: string, args: any[], simulate: boolean = false): Promise<any> {
        const account = await this.rpc.getAccount(this.adminKeypair.publicKey());

        const tx = new TransactionBuilder(account, {
            fee: '100000',
            networkPassphrase: this.networkPassphrase
        })
            .addOperation(Operation.invokeHostFunction({
                func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                    new xdr.InvokeContractArgs({
                        contractAddress: Address.fromString(this.contractId).toScAddress(),
                        functionName: fnName,
                        args: args
                    })
                ),
                auth: []
            }))
            .setTimeout(60)
            .build();

        const simulation = await this.rpc.simulateTransaction(tx);
        if (rpc.Api.isSimulationError(simulation)) {
            throw new Error(`Simulation failed: ${JSON.stringify(simulation.error)}`);
        }

        if (simulate) {
            return simulation;
        }

        const signedTx = TransactionBuilder.fromXDR(simulation.transactionData!.build().toXDR('base64'), this.networkPassphrase) as Transaction;
        signedTx.sign(this.adminKeypair);

        const sendResult = await this.rpc.sendTransaction(signedTx);
        if (sendResult.status !== 'PENDING') {
            throw new Error(`Transaction failed: ${JSON.stringify(sendResult)}`);
        }

        // Poll for result
        let txResult = await this.rpc.getTransaction(sendResult.hash);
        while (txResult.status === 'NOT_FOUND' || txResult.status === 'SUCCESS' && txResult.resultMetaXdr === undefined) {
            await new Promise(r => setTimeout(r, 1000));
            txResult = await this.rpc.getTransaction(sendResult.hash);
        }

        return txResult;
    }

    async dryRun(toVersion: number, data: Buffer = Buffer.alloc(0)): Promise<void> {
        console.log(`[Dry Run] Simulating migration to version ${toVersion}`);
        const result = await this.invoke('migrate', [
            xdr.ScVal.scvU32(toVersion),
            xdr.ScVal.scvBytes(data)
        ], true);

        console.log(`[Dry Run] Success. Estimated resources:`, result.minResourceFee);
    }

    async rollback(oldWasmHash: string, fromVersion: number, toVersion: number, data: Buffer = Buffer.alloc(0)): Promise<string> {
        console.log(`Rolling back from version ${fromVersion} to ${toVersion}`);
        // 1. Restore old WASM
        await this.upgrade(oldWasmHash);
        // 2. Run compensating migration if needed (this assumes the old WASM has a migrate function that handles downgrades)
        const result = await this.migrate(toVersion, data);
        return result;
    }

    logMigration(log: MigrationLog) {
        const logPath = path.join(process.cwd(), 'migrations.json');
        let logs: MigrationLog[] = [];
        if (fs.existsSync(logPath)) {
            logs = JSON.parse(fs.readFileSync(logPath, 'utf8'));
        }
        logs.push(log);
        fs.writeFileSync(logPath, JSON.stringify(logs, null, 2));
    }
}
