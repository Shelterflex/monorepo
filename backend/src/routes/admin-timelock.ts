import { Router, Request, Response } from 'express';
import { SorobanAdapter } from '../soroban/adapter.js';
import { TimelockRepository } from '../indexer/timelock-repository.js';
import { logger } from '../utils/logger.js';

export function createAdminTimelockRouter(sorobanAdapter: SorobanAdapter, repo: TimelockRepository): Router {
  const router = Router();

  /**
   * GET /api/admin/timelock/transactions
   * Returns all tracked governance transactions
   */
  router.get('/transactions', async (_req: Request, res: Response) => {
    try {
      const transactions = await repo.findAll();
      res.json({ transactions });
    } catch (err) {
      logger.error('Failed to fetch timelock transactions', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/admin/timelock/execute
   * Executes a queued transaction. Looks up details by txHash.
   */
  router.post('/execute', async (req: Request, res: Response) => {
    const { txHash } = req.body;
    
    if (!txHash) {
      return res.status(400).json({ error: 'Missing txHash' });
    }

    try {
      // Look up transaction details from the repository
      const allTx = await repo.findAll();
      const tx = allTx.find(t => t.txHash === txHash);

      if (!tx) {
        return res.status(404).json({ error: 'Transaction not found in index' });
      }

      if (tx.status !== 'queued') {
        return res.status(400).json({ error: `Transaction is already ${tx.status}` });
      }

      const stellarTxHash = await sorobanAdapter.executeTimelock(
        tx.txHash, 
        tx.target, 
        tx.functionName, 
        tx.args || [], 
        tx.eta
      );
      
      res.json({ success: true, stellarTxHash });
    } catch (err) {
      logger.error('Failed to execute timelock transaction', { txHash, error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Failed to execute transaction' });
    }
  });

  /**
   * POST /api/admin/timelock/cancel
   * Cancels a queued transaction
   */
  router.post('/cancel', async (req: Request, res: Response) => {
    const { txHash } = req.body;

    if (!txHash) {
      return res.status(400).json({ error: 'Missing txHash' });
    }

    try {
      const stellarTxHash = await sorobanAdapter.cancelTimelock(txHash);
      res.json({ success: true, stellarTxHash });
    } catch (err) {
      logger.error('Failed to cancel timelock transaction', { txHash, error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Failed to cancel transaction' });
    }
  });

  return router;
}

export default createAdminTimelockRouter;
