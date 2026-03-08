import { conversionStore } from '../models/conversionStore.js'
import { StakingService } from '../services/stakingService.js'
import { logger } from '../utils/logger.js'

export class StakingFinalizer {
  private interval: NodeJS.Timeout | null = null

  constructor(
    private stakingService: StakingService,
    private pollIntervalMs: number = 10000,
  ) {}

  start() {
    if (this.interval) return
    logger.info('Starting StakingFinalizer job', { pollIntervalMs: this.pollIntervalMs })
    this.interval = setInterval(() => this.poll(), this.pollIntervalMs)
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
      logger.info('Stopped StakingFinalizer job')
    }
  }

  async poll() {
    try {
      const completedConversions = await conversionStore.listCompleted()
      
      for (const conversion of completedConversions) {
        try {
          // Finalize staking (idempotent inside service)
          await this.stakingService.finalizeStaking(conversion.conversionId)
        } catch (error) {
          // Log error but continue with other conversions
          logger.error('Failed to finalize conversion in background job', {
            conversionId: conversion.conversionId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    } catch (error) {
      logger.error('Error in StakingFinalizer poll', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
