/**
 * Tenant personal-data export (#2052).
 *
 * A request writes a row and queues a job on the scheduler, so the bundle is built
 * outside the request. The job writes a JSON archive through storageService. The
 * download URL is short-lived, and the data-retention job deletes the archive once
 * its window has passed.
 *
 * The bundle lists only the requesting tenant's own data. Fields that are secret,
 * internal or about other people are left out by construction in buildExportBundle.
 */

import { randomUUID } from 'node:crypto'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { getScheduler } from '../jobs/scheduler/index.js'
import { userStore } from '../models/authStore.js'
import { dealStore } from '../models/dealStore.js'
import type { DealWithSchedule } from '../models/deal.js'
import { notificationPreferenceStore } from '../models/notificationPreferenceStore.js'
import type { NotificationPreferences } from '../models/notificationPreferenceStore.js'
import { tenantDataExportStore, type TenantDataExport, type TenantDataExportStatus } from '../models/tenantDataExportStore.js'
import { listingApplicationRepository } from '../repositories/ListingApplicationRepository.js'
import type { ListingApplication } from '../models/listingApplication.js'
import { getStorageProvider } from './storageService.js'
import { logger } from '../utils/logger.js'

export const TENANT_DATA_EXPORT_JOB = 'tenant_data_export.generate'
export const TENANT_DATA_EXPORT_RETENTION_DAYS = 7
export const TENANT_DATA_EXPORT_DAILY_LIMIT = 3
export const TENANT_DATA_EXPORT_URL_TTL_SECONDS = 300

const DAY_MS = 24 * 60 * 60 * 1000
const DEAL_PAGE_SIZE = 100

export interface ExportUserInput {
  id: string
  name: string
  email: string
  role: string
  walletAddress?: string
  displayCurrency?: string
  createdAt?: Date
}

export interface TenantDataExportBundle {
  formatVersion: 1
  generatedAt: string
  profile: {
    id: string
    name: string
    email: string
    role: string
    walletAddress: string | null
    displayCurrency: string | null
    accountCreatedAt: string | null
  }
  notificationPreferences: NotificationPreferences
  applications: Array<{
    id: string
    listingId: string
    status: string
    preferredStartDate: string
    paymentPlan: string
    appliedAt: string
    coverNote: string | null
  }>
  deals: Array<{
    dealId: string
    listingId: string | null
    status: string
    annualRentNgn: number
    depositNgn: number
    financedAmountNgn: number
    termMonths: number
    createdAt: string
    /** The tenant's repayment schedule, which holds every payment due on the deal. */
    payments: Array<{ period: number; dueDate: string; amountNgn: number; status: string }>
  }>
}

export interface BundleSources {
  user: ExportUserInput
  notificationPreferences: NotificationPreferences
  applications: ListingApplication[]
  deals: DealWithSchedule[]
  generatedAt: Date
}

/**
 * Turns raw records into the export bundle. Only fields listed here are copied.
 * Excluded, by construction: password hashes, session and refresh tokens, risk and
 * underwriting scores (rtiAssessment, risk states), reviewer notes, landlord ids and
 * any other user's id.
 */
export function buildExportBundle(sources: BundleSources): TenantDataExportBundle {
  const { user } = sources
  return {
    formatVersion: 1,
    generatedAt: sources.generatedAt.toISOString(),
    profile: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      walletAddress: user.walletAddress ?? null,
      displayCurrency: user.displayCurrency ?? null,
      accountCreatedAt: user.createdAt ? user.createdAt.toISOString() : null,
    },
    notificationPreferences: sources.notificationPreferences,
    applications: sources.applications.map((application) => ({
      id: application.id,
      listingId: application.listingId,
      status: application.status,
      preferredStartDate: application.preferredStartDate.toISOString(),
      paymentPlan: application.paymentPlan,
      appliedAt: application.appliedAt.toISOString(),
      coverNote: application.coverNote ?? null,
    })),
    deals: sources.deals.map((deal) => ({
      dealId: deal.dealId,
      listingId: deal.listingId ?? null,
      status: deal.status,
      annualRentNgn: deal.annualRentNgn,
      depositNgn: deal.depositNgn,
      financedAmountNgn: deal.financedAmountNgn,
      termMonths: deal.termMonths,
      createdAt: deal.createdAt.toISOString(),
      payments: deal.schedule.map((item) => ({
        period: item.period,
        dueDate: item.dueDate,
        amountNgn: item.amountNgn,
        status: item.status,
      })),
    })),
  }
}

export interface TenantDataExportView {
  id: string
  status: TenantDataExportStatus
  requestedAt: string
  completedAt: string | null
  expiresAt: string | null
  /** Present only while the archive is ready and has not expired. */
  downloadUrl: string | null
}

function effectiveStatus(record: TenantDataExport, now: Date): TenantDataExportStatus {
  if (record.status === 'ready' && record.expiresAt && record.expiresAt.getTime() <= now.getTime()) {
    return 'expired'
  }
  return record.status
}

function toView(record: TenantDataExport, downloadUrl: string | null, now: Date): TenantDataExportView {
  return {
    id: record.id,
    status: effectiveStatus(record, now),
    requestedAt: record.requestedAt.toISOString(),
    completedAt: record.completedAt ? record.completedAt.toISOString() : null,
    expiresAt: record.expiresAt ? record.expiresAt.toISOString() : null,
    downloadUrl,
  }
}

/** Queues an export for the caller. Enforces one active export and a daily request limit. */
export async function requestExport(userId: string, now: Date = new Date()): Promise<TenantDataExportView> {
  const active = await tenantDataExportStore.findActiveForUser(userId)
  if (active) {
    throw new AppError(ErrorCode.CONFLICT, 409, 'A data export is already in progress', { exportId: active.id })
  }

  const recent = await tenantDataExportStore.countRequestedSince(userId, new Date(now.getTime() - DAY_MS))
  if (recent >= TENANT_DATA_EXPORT_DAILY_LIMIT) {
    throw new AppError(
      ErrorCode.TOO_MANY_REQUESTS,
      429,
      `You can request at most ${TENANT_DATA_EXPORT_DAILY_LIMIT} data exports in 24 hours`,
    )
  }

  const record = await tenantDataExportStore.create({ id: randomUUID(), userId, requestedAt: now })
  await getScheduler().schedule({
    name: TENANT_DATA_EXPORT_JOB,
    handler: TENANT_DATA_EXPORT_JOB,
    payload: { exportId: record.id },
    maxRetries: 3,
  })
  return toView(record, null, now)
}

/** Returns one of the caller's exports. Another user's export id gets the same 404 as an unknown one. */
export async function getExport(
  userId: string,
  exportId: string,
  now: Date = new Date(),
): Promise<TenantDataExportView> {
  const record = await tenantDataExportStore.findById(exportId)
  if (!record || record.userId !== userId) {
    throw new AppError(ErrorCode.NOT_FOUND, 404, 'Data export not found')
  }

  let downloadUrl: string | null = null
  if (effectiveStatus(record, now) === 'ready' && record.storageKey) {
    const { downloadUrl: url } = await getStorageProvider().generatePresignedDownload(
      record.storageKey,
      TENANT_DATA_EXPORT_URL_TTL_SECONDS,
    )
    downloadUrl = url
  }
  return toView(record, downloadUrl, now)
}

async function collectDeals(userId: string): Promise<DealWithSchedule[]> {
  const deals: DealWithSchedule[] = []
  let page = 1
  for (;;) {
    const result = await dealStore.findMany({ tenantId: userId, page, pageSize: DEAL_PAGE_SIZE })
    for (const deal of result.deals) {
      const full = await dealStore.findById(deal.dealId)
      if (full) deals.push(full)
    }
    if (result.deals.length === 0 || page * DEAL_PAGE_SIZE >= result.total) break
    page += 1
  }
  return deals
}

/** Builds the bundle for one tenant from the stores. Used by the job handler. */
export async function collectExportBundle(userId: string, now: Date = new Date()): Promise<TenantDataExportBundle> {
  const user = await userStore.getById(userId)
  if (!user) {
    throw new Error(`Export user ${userId} not found`)
  }
  const [notificationPreferences, applications, deals] = await Promise.all([
    notificationPreferenceStore.get(userId),
    listingApplicationRepository.findByTenantId(userId),
    collectDeals(userId),
  ])
  return buildExportBundle({
    user,
    notificationPreferences,
    applications,
    deals,
    generatedAt: now,
  })
}

/** Job handler: builds the archive and marks the export ready, or failed. Safe to run twice. */
export async function generateExport(exportId: string, now: Date = new Date()): Promise<void> {
  const record = await tenantDataExportStore.findById(exportId)
  if (!record || record.status === 'ready' || record.status === 'expired') return

  await tenantDataExportStore.markProcessing(exportId)
  try {
    const bundle = await collectExportBundle(record.userId, now)
    const storageKey = `tenant-exports/${record.userId}/${exportId}.json`
    await getStorageProvider().uploadFile(
      storageKey,
      Buffer.from(JSON.stringify(bundle, null, 2), 'utf8'),
      'application/json',
    )
    await tenantDataExportStore.markReady(
      exportId,
      storageKey,
      now,
      new Date(now.getTime() + TENANT_DATA_EXPORT_RETENTION_DAYS * DAY_MS),
    )
  } catch (error) {
    logger.error('Tenant data export failed', {
      exportId,
      error: error instanceof Error ? error.message : String(error),
    })
    await tenantDataExportStore.markFailed(exportId, 'The export could not be generated', now)
  }
}

/** Deletes archives whose window has passed and marks them expired. Called by the data-retention job. */
export async function expireReadyExports(now: Date = new Date()): Promise<number> {
  const due = await tenantDataExportStore.listExpiredReady(now)
  let expired = 0
  for (const record of due) {
    if (record.storageKey) {
      try {
        await getStorageProvider().deleteFile(record.storageKey)
      } catch (error) {
        logger.warn('Could not delete expired data export archive', {
          exportId: record.id,
          error: error instanceof Error ? error.message : String(error),
        })
        continue
      }
    }
    await tenantDataExportStore.markExpired(record.id)
    expired += 1
  }
  return expired
}
