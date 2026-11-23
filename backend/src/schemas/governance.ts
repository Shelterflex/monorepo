import { z } from 'zod'

export const proposalSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.enum(['pending', 'active', 'approved', 'rejected', 'executed']),
  startTime: z.number(),
  endTime: z.number(),
  votesFor: z.number(),
  votesAgainst: z.number(),
  createdAt: z.date(),
})

export type Proposal = z.infer<typeof proposalSchema>

export const createProposalSchema = z.object({
  title: z.string().min(5).max(200),
  description: z.string().min(10).max(2000),
  durationSeconds: z.number().int().positive(),
})

export type CreateProposalRequest = z.infer<typeof createProposalSchema>

export const voteSchema = z.object({
  support: z.boolean().describe('true for yes, false for no'),
})

export type VoteRequest = z.infer<typeof voteSchema>

export const listProposalsSchema = z.object({
  status: z.enum(['pending', 'active', 'approved', 'rejected', 'executed']).optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
})

export type ListProposalsRequest = z.infer<typeof listProposalsSchema>

export interface PreparedTransaction {
  xdr: string
}

export interface SignedTransaction {
  signedXdr: string
}
