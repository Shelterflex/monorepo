import { SorobanAdapter } from '../soroban/adapter.js';
import { parseTimelockEvent } from './event-parser.js';
import { TimelockProcessor } from './timelock-processor.js';
import { logger } from '../utils/logger.js';

export interface TimelockIndexerConfig {
    pollIntervalMs: number;
    startLedger?: number;
}

export class TimelockIndexer {
    private running = false;
    private lastLedger: number | null = null;
    private pollTimeout: NodeJS.Timeout | null = null;

    constructor(
        private adapter: SorobanAdapter,
        private processor: TimelockProcessor,
        private config: TimelockIndexerConfig
    ) {}

    async start(): Promise<void> {
        if (this.running) return;
        this.running = true;

        const checkpoint = await this.processor.getCheckpoint();
        this.lastLedger = checkpoint ?? this.config.startLedger ?? null;

        logger.info('[TimelockIndexer] Starting', { 
            fromLedger: this.lastLedger ?? 'latest' 
        });

        this.poll();
    }

    async stop(): Promise<void> {
        this.running = false;
        if (this.pollTimeout) {
            clearTimeout(this.pollTimeout);
        }
        logger.info('[TimelockIndexer] Stopped');
    }

    private async poll(): Promise<void> {
        if (!this.running) return;

        try {
            const rawEvents = await this.adapter.getTimelockEvents(this.lastLedger);
            
            if (rawEvents.length > 0) {
                const parsedEvents = rawEvents
                    .map(parseTimelockEvent)
                    .filter((e): e is any => e !== null);

                if (parsedEvents.length > 0) {
                    await this.processor.processEvents(parsedEvents);
                    const maxLedger = Math.max(...parsedEvents.map(e => e.ledger));
                    this.lastLedger = maxLedger;
                    
                    logger.info('[TimelockIndexer] Indexed events', { 
                        count: parsedEvents.length,
                        ledger: maxLedger 
                    });
                }
            }
        } catch (err) {
            logger.error('[TimelockIndexer] Poll failed', { 
                error: err instanceof Error ? err.message : String(err) 
            });
        }

        if (this.running) {
            this.pollTimeout = setTimeout(() => this.poll(), this.config.pollIntervalMs);
        }
    }
}
