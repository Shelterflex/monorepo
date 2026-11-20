import { getPool } from '../db.js'
import { linkedAddressStore } from './linkedAddressStore.js'

export interface IGovernanceStore {
  getProposal(proposalId: string): Promise<any>
  listProposals(status?: string, page?: number, limit?: number): Promise<{ proposals: any[]; total: number }>
  getProposalCount(): Promise<number>
  createProposalTransaction(userId: string, proposal: any): Promise<{ xdr: string }>
  validateProposalXdr(xdr: string): Promise<boolean>
  submitProposalTransaction(userId: string, signedXdr: string): Promise<{ proposalId: string }>
  createVoteTransaction(userId: string, proposalId: string, support: boolean): Promise<{ xdr: string }>
  validateVoteXdr(xdr: string, proposalId: string): Promise<boolean>
  submitVoteTransaction(userId: string, signedXdr: string): Promise<void>
  finalizeProposal(proposalId: string): Promise<void>
  executeProposal(proposalId: string): Promise<void>
}

export class InMemoryGovernanceStore implements IGovernanceStore {
  private proposals: Map<string, any> = new Map()
  private proposalCounter = 0

  async getProposal(proposalId: string): Promise<any> {
    return this.proposals.get(proposalId) || null
  }

  async listProposals(status?: string, page = 1, limit = 20): Promise<{ proposals: any[]; total: number }> {
    let proposals = Array.from(this.proposals.values())

    if (status) {
      proposals = proposals.filter((p) => p.status === status)
    }

    const total = proposals.length
    const start = (page - 1) * limit
    return {
      proposals: proposals.slice(start, start + limit),
      total,
    }
  }

  async getProposalCount(): Promise<number> {
    return this.proposals.size
  }

  async createProposalTransaction(userId: string, proposal: any): Promise<{ xdr: string }> {
    // In-memory stub - returns a mock XDR
    return {
      xdr: `mock_xdr_proposal_${Date.now()}`,
    }
  }

  async validateProposalXdr(xdr: string): Promise<boolean> {
    // In-memory stub - accepts any XDR starting with mock_xdr
    return xdr.startsWith('mock_xdr')
  }

  async submitProposalTransaction(userId: string, signedXdr: string): Promise<{ proposalId: string }> {
    if (!await this.validateProposalXdr(signedXdr)) {
      throw new Error('Invalid proposal XDR')
    }

    const proposalId = `proposal_${++this.proposalCounter}`
    this.proposals.set(proposalId, {
      id: proposalId,
      status: 'pending',
      createdAt: new Date(),
    })

    return { proposalId }
  }

  async createVoteTransaction(userId: string, proposalId: string, support: boolean): Promise<{ xdr: string }> {
    if (!this.proposals.has(proposalId)) {
      throw new Error('Proposal not found')
    }

    return {
      xdr: `mock_xdr_vote_${proposalId}_${support}`,
    }
  }

  async validateVoteXdr(xdr: string, proposalId: string): Promise<boolean> {
    return xdr.startsWith(`mock_xdr_vote_${proposalId}`)
  }

  async submitVoteTransaction(userId: string, signedXdr: string): Promise<void> {
    // In-memory stub
  }

  async finalizeProposal(proposalId: string): Promise<void> {
    const proposal = this.proposals.get(proposalId)
    if (proposal) {
      proposal.status = 'finalized'
    }
  }

  async executeProposal(proposalId: string): Promise<void> {
    const proposal = this.proposals.get(proposalId)
    if (proposal) {
      proposal.status = 'executed'
    }
  }
}

export class PostgresGovernanceStore implements IGovernanceStore {
  async getProposal(proposalId: string): Promise<any> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')

    const result = await pool.query(
      `SELECT * FROM governance_proposals WHERE id = $1`,
      [proposalId],
    )

    return result.rows.length > 0 ? result.rows[0] : null
  }

  async listProposals(status?: string, page = 1, limit = 20): Promise<{ proposals: any[]; total: number }> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')

    let query = 'SELECT * FROM governance_proposals'
    const params: any[] = []

    if (status) {
      query += ' WHERE status = $1'
      params.push(status)
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) as count FROM governance_proposals ${status ? 'WHERE status = $1' : ''}`,
      params,
    )
    const total = parseInt(countResult.rows[0].count, 10)

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
    params.push(limit)
    params.push((page - 1) * limit)

    const result = await pool.query(query, params)
    return {
      proposals: result.rows,
      total,
    }
  }

  async getProposalCount(): Promise<number> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')

    const result = await pool.query('SELECT COUNT(*) as count FROM governance_proposals')
    return parseInt(result.rows[0].count, 10)
  }

  async createProposalTransaction(userId: string, proposal: any): Promise<{ xdr: string }> {
    // This would be generated by the Soroban adapter
    // For now, return a placeholder
    return {
      xdr: `xdr_for_proposal_${userId}_${Date.now()}`,
    }
  }

  async validateProposalXdr(xdr: string): Promise<boolean> {
    // This would validate the XDR format and contract call
    return xdr.length > 0
  }

  async submitProposalTransaction(userId: string, signedXdr: string): Promise<{ proposalId: string }> {
    if (!await this.validateProposalXdr(signedXdr)) {
      throw new Error('Invalid proposal XDR')
    }

    const pool = await getPool()
    if (!pool) throw new Error('Database not available')

    const result = await pool.query(
      `INSERT INTO governance_proposals (creator_id, signed_xdr, status) VALUES ($1, $2, 'pending') RETURNING id`,
      [userId, signedXdr],
    )

    return { proposalId: result.rows[0].id }
  }

  async createVoteTransaction(userId: string, proposalId: string, support: boolean): Promise<{ xdr: string }> {
    // Verify proposal exists
    const proposal = await this.getProposal(proposalId)
    if (!proposal) {
      throw new Error('Proposal not found')
    }

    return {
      xdr: `xdr_for_vote_${proposalId}_${userId}_${support}`,
    }
  }

  async validateVoteXdr(xdr: string, proposalId: string): Promise<boolean> {
    // Validate XDR format
    return xdr.includes(proposalId)
  }

  async submitVoteTransaction(userId: string, signedXdr: string): Promise<void> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')

    // Store vote record
    await pool.query(
      `INSERT INTO governance_votes (voter_id, signed_xdr) VALUES ($1, $2)`,
      [userId, signedXdr],
    )
  }

  async finalizeProposal(proposalId: string): Promise<void> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')

    await pool.query(
      `UPDATE governance_proposals SET status = 'finalized' WHERE id = $1`,
      [proposalId],
    )
  }

  async executeProposal(proposalId: string): Promise<void> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not available')

    await pool.query(
      `UPDATE governance_proposals SET status = 'executed' WHERE id = $1`,
      [proposalId],
    )
  }
}

let governanceStore: IGovernanceStore

export function initGovernanceStore(store: IGovernanceStore) {
  governanceStore = store
}

export function getGovernanceStore(): IGovernanceStore {
  if (!governanceStore) {
    governanceStore = process.env.DATABASE_URL
      ? new PostgresGovernanceStore()
      : new InMemoryGovernanceStore()
  }
  return governanceStore
}

export const inMemoryGovernanceStore = new InMemoryGovernanceStore()
