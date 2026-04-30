import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryFraudStore, initFraudStore } from './store.js'
import { FraudDetectionEngine, initFraudEngine } from './engine.js'
import {
  SignalType,
  RiskLevel,
  ActionType,
  EntityType,
  type CreateSignalInput,
  type AssessmentContext,
} from './types.js'

describe('Fraud Detection Engine', () => {
  beforeEach(() => {
    const store = new InMemoryFraudStore()
    initFraudStore(store)
    const engine = new FraudDetectionEngine()
    initFraudEngine(engine)
  })

  describe('Signal Management', () => {
    it('should create and retrieve a fraud signal', async () => {
      const store = new InMemoryFraudStore()
      initFraudStore(store)

      const input: CreateSignalInput = {
        name: 'high-value-transaction',
        description: 'Flag transactions above threshold',
        signalType: SignalType.THRESHOLD,
        config: {
          field: 'amount',
          operator: 'gt',
          value: 10000,
        },
        scoreWeight: 25,
      }

      const signal = await store.createSignal(input)
      expect(signal.id).toBeTruthy()
      expect(signal.name).toBe(input.name)
      expect(signal.enabled).toBe(true)

      const retrieved = await store.getSignal(signal.id)
      expect(retrieved).toEqual(signal)
    })

    it('should list enabled signals only', async () => {
      const store = new InMemoryFraudStore()
      initFraudStore(store)

      await store.createSignal({
        name: 'signal-1',
        signalType: SignalType.RULE,
        config: {},
        enabled: true,
      })

      await store.createSignal({
        name: 'signal-2',
        signalType: SignalType.RULE,
        config: {},
        enabled: false,
      })

      const enabled = await store.listSignals({ enabled: true })
      expect(enabled).toHaveLength(1)
      expect(enabled[0].name).toBe('signal-1')
    })

    it('should update a signal', async () => {
      const store = new InMemoryFraudStore()
      initFraudStore(store)

      const signal = await store.createSignal({
        name: 'test-signal',
        signalType: SignalType.THRESHOLD,
        config: { field: 'amount', operator: 'gt', value: 1000 },
      })

      const updated = await store.updateSignal(signal.id, {
        scoreWeight: 50,
        enabled: false,
      })

      expect(updated.scoreWeight).toBe(50)
      expect(updated.enabled).toBe(false)
    })

    it('should enable and disable signals', async () => {
      const store = new InMemoryFraudStore()
      initFraudStore(store)

      const signal = await store.createSignal({
        name: 'test-signal',
        signalType: SignalType.RULE,
        config: {},
      })

      await store.disableSignal(signal.id)
      let retrieved = await store.getSignal(signal.id)
      expect(retrieved?.enabled).toBe(false)

      await store.enableSignal(signal.id)
      retrieved = await store.getSignal(signal.id)
      expect(retrieved?.enabled).toBe(true)
    })
  })

  describe('Threshold Signal Evaluation', () => {
    it('should match threshold signals', async () => {
      const store = new InMemoryFraudStore()
      initFraudStore(store)

      await store.createSignal({
        name: 'high-amount',
        signalType: SignalType.THRESHOLD,
        config: {
          field: 'amount',
          operator: 'gt',
          value: 5000,
        },
        scoreWeight: 30,
      })

      const engine = new FraudDetectionEngine()
      initFraudEngine(engine)

      const context: AssessmentContext = {
        entityType: EntityType.PAYMENT,
        entityId: 'payment-123',
        eventData: { amount: 10000 },
      }

      const assessment = await engine.evaluate(context)

      expect(assessment.totalScore).toBe(30)
      expect(assessment.riskLevel).toBe(RiskLevel.MEDIUM)
      expect(assessment.signalMatches).toHaveLength(1)
      expect(assessment.signalMatches[0].signalName).toBe('high-amount')
    })

    it('should not match below threshold', async () => {
      const store = new InMemoryFraudStore()
      initFraudStore(store)

      await store.createSignal({
        name: 'high-amount',
        signalType: SignalType.THRESHOLD,
        config: {
          field: 'amount',
          operator: 'gt',
          value: 5000,
        },
        scoreWeight: 30,
      })

      const engine = new FraudDetectionEngine()
      initFraudEngine(engine)

      const context: AssessmentContext = {
        entityType: EntityType.PAYMENT,
        entityId: 'payment-123',
        eventData: { amount: 1000 },
      }

      const assessment = await engine.evaluate(context)

      expect(assessment.totalScore).toBe(0)
      expect(assessment.riskLevel).toBe(RiskLevel.LOW)
      expect(assessment.signalMatches).toHaveLength(0)
    })

    it('should support different operators', async () => {
      const store = new InMemoryFraudStore()
      initFraudStore(store)

      await store.createSignal({
        name: 'low-amount',
        signalType: SignalType.THRESHOLD,
        config: {
          field: 'amount',
          operator: 'lt',
          value: 100,
        },
        scoreWeight: 10,
      })

      const engine = new FraudDetectionEngine()
      initFraudEngine(engine)

      const context: AssessmentContext = {
        entityType: EntityType.PAYMENT,
        entityId: 'payment-123',
        eventData: { amount: 50 },
      }

      const assessment = await engine.evaluate(context)

      expect(assessment.totalScore).toBe(10)
    })
  })

  describe('Rule Signal Evaluation', () => {
    it('should match rule signals with AND logic', async () => {
      const store = new InMemoryFraudStore()
      initFraudStore(store)

      await store.createSignal({
        name: 'suspicious-country',
        signalType: SignalType.RULE,
        config: {
          conditions: [
            { field: 'country', operator: 'eq', value: 'XX' },
            { field: 'amount', operator: 'eq', value: 2000 },
          ],
          logic: 'AND',
        },
        scoreWeight: 40,
      })

      const engine = new FraudDetectionEngine()
      initFraudEngine(engine)

      const context: AssessmentContext = {
        entityType: EntityType.PAYMENT,
        entityId: 'payment-123',
        eventData: { country: 'XX', amount: 2000 },
      }

      const assessment = await engine.evaluate(context)

      expect(assessment.totalScore).toBe(40)
      expect(assessment.riskLevel).toBe(RiskLevel.MEDIUM)
    })

    it('should match rule signals with OR logic', async () => {
      const store = new InMemoryFraudStore()
      initFraudStore(store)

      await store.createSignal({
        name: 'risk-indicator',
        signalType: SignalType.RULE,
        config: {
          conditions: [
            { field: 'isVpn', operator: 'eq', value: true },
            { field: 'isProxy', operator: 'eq', value: true },
          ],
          logic: 'OR',
        },
        scoreWeight: 20,
      })

      const engine = new FraudDetectionEngine()
      initFraudEngine(engine)

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'account-123',
        eventData: { isVpn: true, isProxy: false },
      }

      const assessment = await engine.evaluate(context)

      expect(assessment.totalScore).toBe(20)
    })

    it('should not match when conditions fail', async () => {
      const store = new InMemoryFraudStore()
      initFraudStore(store)

      await store.createSignal({
        name: 'strict-rule',
        signalType: SignalType.RULE,
        config: {
          conditions: [
            { field: 'verified', operator: 'eq', value: true },
            { field: 'age', operator: 'gte', value: 18 },
          ],
          logic: 'AND',
        },
        scoreWeight: 15,
      })

      const engine = new FraudDetectionEngine()
      initFraudEngine(engine)

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'account-123',
        eventData: { verified: true, age: 16 },
      }

      const assessment = await engine.evaluate(context)

      expect(assessment.totalScore).toBe(0)
    })
  })

  describe('Pattern Signal Evaluation', () => {
    it('should match regex patterns', async () => {
      const store = new InMemoryFraudStore()
      initFraudStore(store)

      await store.createSignal({
        name: 'suspicious-email',
        signalType: SignalType.PATTERN,
        config: {
          field: 'email',
          pattern: '.*@temp-mail\\.com$',
        },
        scoreWeight: 35,
      })

      const engine = new FraudDetectionEngine()
      initFraudEngine(engine)

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'account-123',
        eventData: { email: 'user@temp-mail.com' },
      }

      const assessment = await engine.evaluate(context)

      expect(assessment.totalScore).toBe(35)
      expect(assessment.riskLevel).toBe(RiskLevel.MEDIUM)
    })

    it('should not match non-matching patterns', async () => {
      const store = new InMemoryFraudStore()
      initFraudStore(store)

      await store.createSignal({
        name: 'suspicious-email',
        signalType: SignalType.PATTERN,
        config: {
          field: 'email',
          pattern: '.*@temp-mail\\.com$',
        },
        scoreWeight: 35,
      })

      const engine = new FraudDetectionEngine()
      initFraudEngine(engine)

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'account-123',
        eventData: { email: 'user@gmail.com' },
      }

      const assessment = await engine.evaluate(context)

      expect(assessment.totalScore).toBe(0)
    })
  })

  describe('Risk Level Calculation', () => {
    it('should calculate low risk for low scores', async () => {
      const store = new InMemoryFraudStore()
      initFraudStore(store)

      await store.createSignal({
        name: 'minor-flag',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'flag', operator: 'eq', value: true }] },
        scoreWeight: 10,
      })

      const engine = new FraudDetectionEngine()
      initFraudEngine(engine)

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'account-123',
        eventData: { flag: true },
      }

      const assessment = await engine.evaluate(context)

      expect(assessment.riskLevel).toBe(RiskLevel.LOW)
      expect(assessment.actionTaken).toBe(ActionType.NONE)
    })

    it('should calculate medium risk for medium scores', async () => {
      const store = new InMemoryFraudStore()
      initFraudStore(store)

      await store.createSignal({
        name: 'medium-flag',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'flag', operator: 'eq', value: true }] },
        scoreWeight: 40,
      })

      const engine = new FraudDetectionEngine()
      initFraudEngine(engine)

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'account-123',
        eventData: { flag: true },
      }

      const assessment = await engine.evaluate(context)

      expect(assessment.riskLevel).toBe(RiskLevel.MEDIUM)
      expect(assessment.actionTaken).toBe(ActionType.REVIEW_QUEUE)
    })

    it('should calculate high risk for high scores', async () => {
      const store = new InMemoryFraudStore()
      initFraudStore(store)

      await store.createSignal({
        name: 'high-flag',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'flag', operator: 'eq', value: true }] },
        scoreWeight: 70,
      })

      const engine = new FraudDetectionEngine()
      initFraudEngine(engine)

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'account-123',
        eventData: { flag: true },
      }

      const assessment = await engine.evaluate(context)

      expect(assessment.riskLevel).toBe(RiskLevel.HIGH)
      expect(assessment.actionTaken).toBe(ActionType.HOLD)
    })

    it('should calculate critical risk for critical scores', async () => {
      const store = new InMemoryFraudStore()
      initFraudStore(store)

      await store.createSignal({
        name: 'critical-flag',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'flag', operator: 'eq', value: true }] },
        scoreWeight: 95,
      })

      const engine = new FraudDetectionEngine()
      initFraudEngine(engine)

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'account-123',
        eventData: { flag: true },
      }

      const assessment = await engine.evaluate(context)

      expect(assessment.riskLevel).toBe(RiskLevel.CRITICAL)
      expect(assessment.actionTaken).toBe(ActionType.BLOCK)
    })
  })

  describe('Multi-signal Aggregation', () => {
    it('should aggregate scores from multiple signals', async () => {
      const store = new InMemoryFraudStore()
      initFraudStore(store)

      await store.createSignal({
        name: 'signal-1',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'flag1', operator: 'eq', value: true }] },
        scoreWeight: 20,
      })

      await store.createSignal({
        name: 'signal-2',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'flag2', operator: 'eq', value: true }] },
        scoreWeight: 25,
      })

      const engine = new FraudDetectionEngine()
      initFraudEngine(engine)

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'account-123',
        eventData: { flag1: true, flag2: true },
      }

      const assessment = await engine.evaluate(context)

      expect(assessment.totalScore).toBe(45)
      expect(assessment.signalMatches).toHaveLength(2)
      expect(assessment.riskLevel).toBe(RiskLevel.MEDIUM)
    })
  })

  describe('Account Holds', () => {
    it('should create account hold for high risk', async () => {
      const store = new InMemoryFraudStore()
      initFraudStore(store)

      await store.createSignal({
        name: 'high-risk',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'risk', operator: 'eq', value: true }] },
        scoreWeight: 70,
      })

      const engine = new FraudDetectionEngine()
      initFraudEngine(engine)

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'account-123',
        eventData: { risk: true },
      }

      await engine.evaluate(context)

      const holds = await store.getActiveHolds('account-123')
      expect(holds).toHaveLength(1)
      expect(holds[0].holdType).toBe('partial')
    })

    it('should block for critical risk (not hold)', async () => {
      const store = new InMemoryFraudStore()
      initFraudStore(store)

      await store.createSignal({
        name: 'critical-risk',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'critical', operator: 'eq', value: true }] },
        scoreWeight: 95,
      })

      const engine = new FraudDetectionEngine()
      initFraudEngine(engine)

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'account-123',
        eventData: { critical: true },
      }

      const assessment = await engine.evaluate(context)

      // Critical risk triggers BLOCK action, not HOLD
      expect(assessment.actionTaken).toBe(ActionType.BLOCK)
      expect(assessment.riskLevel).toBe(RiskLevel.CRITICAL)

      // No hold should be created for blocked accounts
      const holds = await store.getActiveHolds('account-123')
      expect(holds).toHaveLength(0)
    })

    it('should release account hold', async () => {
      const store = new InMemoryFraudStore()
      initFraudStore(store)

      const hold = await store.createAccountHold('account-123', 'assessment-123', 'full', 'Test hold')
      expect(hold.releasedAt).toBeNull()

      await store.releaseHold(hold.id, 'admin-1')

      const updated = await store.getActiveHolds('account-123')
      expect(updated).toHaveLength(0)
    })
  })

  describe('Assessment History', () => {
    it('should retrieve assessment history for entity', async () => {
      const store = new InMemoryFraudStore()
      initFraudStore(store)

      await store.createAssessment(
        EntityType.ACCOUNT,
        'account-123',
        10,
        RiskLevel.LOW,
        ActionType.NONE,
        [],
        {},
      )

      await store.createAssessment(
        EntityType.ACCOUNT,
        'account-123',
        50,
        RiskLevel.HIGH,
        ActionType.HOLD,
        [],
        {},
      )

      const history = await store.getAssessmentsByEntity(EntityType.ACCOUNT, 'account-123')
      expect(history).toHaveLength(2)
    })

    it('should list assessments with filters', async () => {
      const store = new InMemoryFraudStore()
      initFraudStore(store)

      await store.createAssessment(
        EntityType.ACCOUNT,
        'account-1',
        10,
        RiskLevel.LOW,
        ActionType.NONE,
        [],
        {},
      )

      await store.createAssessment(
        EntityType.ACCOUNT,
        'account-2',
        70,
        RiskLevel.HIGH,
        ActionType.HOLD,
        [],
        {},
      )

      const highRisk = await store.listAssessments({ riskLevel: RiskLevel.HIGH })
      expect(highRisk).toHaveLength(1)
      expect(highRisk[0].riskLevel).toBe(RiskLevel.HIGH)
    })
  })

  describe('Threshold Updates', () => {
    it('should update risk thresholds', () => {
      const engine = new FraudDetectionEngine()
      initFraudEngine(engine)

      engine.updateThresholds({ medium: 50, high: 80, critical: 95 })

      const thresholds = engine.getThresholds()
      expect(thresholds.medium).toBe(50)
      expect(thresholds.high).toBe(80)
      expect(thresholds.critical).toBe(95)
    })

    it('should use updated thresholds for evaluation', async () => {
      const store = new InMemoryFraudStore()
      initFraudStore(store)

      await store.createSignal({
        name: 'test-signal',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'flag', operator: 'eq', value: true }] },
        scoreWeight: 40,
      })

      const engine = new FraudDetectionEngine()
      engine.updateThresholds({ medium: 50 })
      initFraudEngine(engine)

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'account-123',
        eventData: { flag: true },
      }

      const assessment = await engine.evaluate(context)

      // With default thresholds, 40 would be MEDIUM
      // With updated threshold (medium: 50), 40 should be LOW
      expect(assessment.riskLevel).toBe(RiskLevel.LOW)
    })
  })

  describe('Rule Updates Without Restart', () => {
    it('should apply rule changes immediately', async () => {
      const store = new InMemoryFraudStore()
      initFraudStore(store)

      const signal = await store.createSignal({
        name: 'dynamic-rule',
        signalType: SignalType.THRESHOLD,
        config: { field: 'amount', operator: 'gt', value: 1000 },
        scoreWeight: 20,
      })

      const engine = new FraudDetectionEngine()
      initFraudEngine(engine)

      // First evaluation - should not match
      const context1: AssessmentContext = {
        entityType: EntityType.PAYMENT,
        entityId: 'payment-123',
        eventData: { amount: 500 },
      }

      const assessment1 = await engine.evaluate(context1)
      expect(assessment1.totalScore).toBe(0)

      // Update the rule
      await store.updateSignal(signal.id, {
        config: { field: 'amount', operator: 'gt', value: 100 },
      })

      // Second evaluation - should now match
      const assessment2 = await engine.evaluate(context1)
      expect(assessment2.totalScore).toBe(20)
    })

    it('should respect enabled/disabled state', async () => {
      const store = new InMemoryFraudStore()
      initFraudStore(store)

      const signal = await store.createSignal({
        name: 'toggle-rule',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'flag', operator: 'eq', value: true }] },
        scoreWeight: 30,
      })

      const engine = new FraudDetectionEngine()
      initFraudEngine(engine)

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'account-123',
        eventData: { flag: true },
      }

      // Enabled - should match
      const assessment1 = await engine.evaluate(context)
      expect(assessment1.totalScore).toBe(30)

      // Disable
      await store.disableSignal(signal.id)

      // Disabled - should not match
      const assessment2 = await engine.evaluate(context)
      expect(assessment2.totalScore).toBe(0)

      // Re-enable
      await store.enableSignal(signal.id)

      // Enabled again - should match
      const assessment3 = await engine.evaluate(context)
      expect(assessment3.totalScore).toBe(30)
    })
  })
})
