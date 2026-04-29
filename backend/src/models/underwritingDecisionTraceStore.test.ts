import { describe, it, expect, beforeEach } from 'vitest'
import {
  InMemoryUnderwritingDecisionTraceStore,
  PostgresUnderwritingDecisionTraceStore,
} from './underwritingDecisionTraceStore.js'
import { UnderwritingDecision } from '../services/underwritingRuleEngine.js'

describe('UnderwritingDecisionTraceStore', () => {
  let inMemoryStore: InMemoryUnderwritingDecisionTraceStore

  beforeEach(() => {
    inMemoryStore = new InMemoryUnderwritingDecisionTraceStore()
  })

  describe('InMemoryUnderwritingDecisionTraceStore', () => {
    beforeEach(async () => {
      await inMemoryStore.clear()
    })

    it('should create a decision trace', async () => {
      const trace = await inMemoryStore.create({
        applicationId: 'app-1',
        userId: 'user-1',
        decision: 'APPROVE' as UnderwritingDecision,
        totalScore: 85,
        maxScore: 100,
        triggeredRules: [],
        decisionReason: 'Good application',
        ruleConfigVersion: '1.0.0',
        evaluatedAt: new Date().toISOString(),
      })

      expect(trace.id).toBeDefined()
      expect(trace.applicationId).toBe('app-1')
      expect(trace.userId).toBe('user-1')
      expect(trace.decision).toBe('APPROVE')
    })

    it('should find trace by id', async () => {
      const created = await inMemoryStore.create({
        applicationId: 'app-1',
        userId: 'user-1',
        decision: 'APPROVE' as UnderwritingDecision,
        totalScore: 85,
        maxScore: 100,
        triggeredRules: [],
        decisionReason: 'Good application',
        ruleConfigVersion: '1.0.0',
        evaluatedAt: new Date().toISOString(),
      })

      const found = await inMemoryStore.findById(created.id)

      expect(found).not.toBeNull()
      expect(found?.id).toBe(created.id)
      expect(found?.applicationId).toBe('app-1')
    })

    it('should return null for non-existent trace', async () => {
      const found = await inMemoryStore.findById('non-existent')
      expect(found).toBeNull()
    })

    it('should find traces by application id', async () => {
      await inMemoryStore.create({
        applicationId: 'app-1',
        userId: 'user-1',
        decision: 'APPROVE' as UnderwritingDecision,
        totalScore: 85,
        maxScore: 100,
        triggeredRules: [],
        decisionReason: 'Good application',
        ruleConfigVersion: '1.0.0',
        evaluatedAt: new Date().toISOString(),
      })

      await inMemoryStore.create({
        applicationId: 'app-1',
        userId: 'user-2',
        decision: 'REVIEW' as UnderwritingDecision,
        totalScore: 65,
        maxScore: 100,
        triggeredRules: [],
        decisionReason: 'Needs review',
        ruleConfigVersion: '1.0.0',
        evaluatedAt: new Date().toISOString(),
      })

      await inMemoryStore.create({
        applicationId: 'app-2',
        userId: 'user-1',
        decision: 'APPROVE' as UnderwritingDecision,
        totalScore: 90,
        maxScore: 100,
        triggeredRules: [],
        decisionReason: 'Good application',
        ruleConfigVersion: '1.0.0',
        evaluatedAt: new Date().toISOString(),
      })

      const traces = await inMemoryStore.findByApplicationId('app-1')

      expect(traces).toHaveLength(2)
      expect(traces.every((t) => t.applicationId === 'app-1')).toBe(true)
    })

    it('should find traces by user id', async () => {
      await inMemoryStore.create({
        applicationId: 'app-1',
        userId: 'user-1',
        decision: 'APPROVE' as UnderwritingDecision,
        totalScore: 85,
        maxScore: 100,
        triggeredRules: [],
        decisionReason: 'Good application',
        ruleConfigVersion: '1.0.0',
        evaluatedAt: new Date().toISOString(),
      })

      await inMemoryStore.create({
        applicationId: 'app-2',
        userId: 'user-1',
        decision: 'REVIEW' as UnderwritingDecision,
        totalScore: 65,
        maxScore: 100,
        triggeredRules: [],
        decisionReason: 'Needs review',
        ruleConfigVersion: '1.0.0',
        evaluatedAt: new Date().toISOString(),
      })

      await inMemoryStore.create({
        applicationId: 'app-3',
        userId: 'user-2',
        decision: 'APPROVE' as UnderwritingDecision,
        totalScore: 90,
        maxScore: 100,
        triggeredRules: [],
        decisionReason: 'Good application',
        ruleConfigVersion: '1.0.0',
        evaluatedAt: new Date().toISOString(),
      })

      const traces = await inMemoryStore.findByUserId('user-1')

      expect(traces).toHaveLength(2)
      expect(traces.every((t) => t.userId === 'user-1')).toBe(true)
    })

    it('should list traces with filters', async () => {
      await inMemoryStore.create({
        applicationId: 'app-1',
        userId: 'user-1',
        decision: 'APPROVE' as UnderwritingDecision,
        totalScore: 85,
        maxScore: 100,
        triggeredRules: [],
        decisionReason: 'Good application',
        ruleConfigVersion: '1.0.0',
        evaluatedAt: new Date().toISOString(),
      })

      await inMemoryStore.create({
        applicationId: 'app-2',
        userId: 'user-2',
        decision: 'REJECT' as UnderwritingDecision,
        totalScore: 30,
        maxScore: 100,
        triggeredRules: [],
        decisionReason: 'Poor application',
        ruleConfigVersion: '1.0.0',
        evaluatedAt: new Date().toISOString(),
      })

      await inMemoryStore.create({
        applicationId: 'app-3',
        userId: 'user-3',
        decision: 'REVIEW' as UnderwritingDecision,
        totalScore: 60,
        maxScore: 100,
        triggeredRules: [],
        decisionReason: 'Needs review',
        ruleConfigVersion: '1.0.0',
        evaluatedAt: new Date().toISOString(),
      })

      const allTraces = await inMemoryStore.list()
      expect(allTraces.traces).toHaveLength(3)
      expect(allTraces.total).toBe(3)

      const approveTraces = await inMemoryStore.list({ decision: 'APPROVE' as UnderwritingDecision })
      expect(approveTraces.traces).toHaveLength(1)
      expect(approveTraces.total).toBe(1)

      const rejectTraces = await inMemoryStore.list({ decision: 'REJECT' as UnderwritingDecision })
      expect(rejectTraces.traces).toHaveLength(1)
      expect(rejectTraces.total).toBe(1)
    })

    it('should support pagination', async () => {
      // Create 10 traces
      for (let i = 0; i < 10; i++) {
        await inMemoryStore.create({
          applicationId: `app-${i}`,
          userId: `user-${i}`,
          decision: 'APPROVE' as UnderwritingDecision,
          totalScore: 85,
          maxScore: 100,
          triggeredRules: [],
          decisionReason: 'Good application',
          ruleConfigVersion: '1.0.0',
          evaluatedAt: new Date().toISOString(),
        })
      }

      const firstPage = await inMemoryStore.list({ limit: 5, offset: 0 })
      expect(firstPage.traces).toHaveLength(5)
      expect(firstPage.total).toBe(10)

      const secondPage = await inMemoryStore.list({ limit: 5, offset: 5 })
      expect(secondPage.traces).toHaveLength(5)
      expect(secondPage.total).toBe(10)
    })
  })
})
