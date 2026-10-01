/**
 * S3-compatible object storage (AWS S3 / MinIO) with presigned upload/download URLs.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

const UPLOAD_TTL_SECONDS = 15 * 60
const DOWNLOAD_TTL_SECONDS = 5 * 60

// Storage provider configuration
export const STORAGE_PROVIDER = process.env.STORAGE_PROVIDER ?? 's3'

// Storage provider interface
export interface StorageProvider {
  uploadFile(key: string, buffer: Buffer, contentType: string, metadata?: Record<string, string>): Promise<{ key: string; url: string }>
  downloadFile(key: string): Promise<{ buffer: Buffer; contentType: string }>
  deleteFile(key: string): Promise<void>
  generatePresignedUpload(key: string, contentType: string, ttlSeconds: number): Promise<{ uploadUrl: string; objectKey: string }>
  generatePresignedDownload(key: string, ttlSeconds: number): Promise<{ downloadUrl: string }>
  copyFile(sourceKey: string, destKey: string): Promise<void>
}

// S3 Storage Provider
class S3StorageProvider implements StorageProvider {
  private client: S3Client
  private bucket: string

  constructor() {
    const endpoint = process.env.S3_ENDPOINT
    const region = process.env.S3_REGION ?? 'us-east-1'
    const accessKeyId = process.env.S3_ACCESS_KEY_ID ?? 'minioadmin'
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin'

    this.client = new S3Client({
      region,
      endpoint,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
      credentials: { accessKeyId, secretAccessKey },
    })
    this.bucket = process.env.S3_BUCKET ?? 'tenant-documents'
  }

  async uploadFile(key: string, buffer: Buffer, contentType: string, metadata?: Record<string, string>): Promise<{ key: string; url: string }> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      Metadata: metadata,
    })
    await this.client.send(command)
    const { downloadUrl } = await this.generatePresignedDownload(key, DOWNLOAD_TTL_SECONDS)
    return { key, url: downloadUrl }
  }

  async downloadFile(key: string): Promise<{ buffer: Buffer; contentType: string }> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    })
    const response = await this.client.send(command)
    const bytes = await response.Body!.transformToByteArray()
    return {
      buffer: Buffer.from(bytes),
      contentType: response.ContentType ?? 'application/octet-stream',
    }
  }

  async deleteFile(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    })
    await this.client.send(command)
  }

  async generatePresignedUpload(key: string, contentType: string, ttlSeconds: number): Promise<{ uploadUrl: string; objectKey: string }> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    })
    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: ttlSeconds })
    return { uploadUrl, objectKey: key }
  }

  async generatePresignedDownload(key: string, ttlSeconds: number): Promise<{ downloadUrl: string }> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    })
    const downloadUrl = await getSignedUrl(this.client, command, { expiresIn: ttlSeconds })
    return { downloadUrl }
  }

  async copyFile(sourceKey: string, destKey: string): Promise<void> {
    const command = new CopyObjectCommand({
      Bucket: this.bucket,
      CopySource: `${this.bucket}/${sourceKey}`,
      Key: destKey,
    })
    await this.client.send(command)
  }
}

// Local Storage Provider (for development)
class LocalStorageProvider implements StorageProvider {
  private baseDir: string

  constructor() {
    this.baseDir = process.env.LOCAL_STORAGE_DIR ?? '/tmp/shelterflex-dev'
  }

  private ensureDir(): void {
    fs.mkdir(this.baseDir, { recursive: true }).catch(() => {})
  }

  private getFilePath(key: string): string {
    return join(this.baseDir, key)
  }

  async uploadFile(key: string, buffer: Buffer, contentType: string, _metadata?: Record<string, string>): Promise<{ key: string; url: string }> {
    this.ensureDir()
    const filePath = this.getFilePath(key)
    const dir = join(filePath, '..')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(filePath, buffer)
    return { key, url: `file://${filePath}` }
  }

  async downloadFile(key: string): Promise<{ buffer: Buffer; contentType: string }> {
    const filePath = this.getFilePath(key)
    const buffer = await fs.readFile(filePath)
    return { buffer, contentType: 'application/octet-stream' }
  }

  async deleteFile(key: string): Promise<void> {
    const filePath = this.getFilePath(key)
    await fs.unlink(filePath).catch(() => {})
  }

  async generatePresignedUpload(key: string, _contentType: string, _ttlSeconds: number): Promise<{ uploadUrl: string; objectKey: string }> {
    // For local storage, we return a mock upload URL
    return { uploadUrl: `file://upload/${key}`, objectKey: key }
  }

  async generatePresignedDownload(key: string, _ttlSeconds: number): Promise<{ downloadUrl: string }> {
    const filePath = this.getFilePath(key)
    return { downloadUrl: `file://${filePath}` }
  }

  async copyFile(sourceKey: string, destKey: string): Promise<void> {
    this.ensureDir()
    const sourcePath = this.getFilePath(sourceKey)
    const destPath = this.getFilePath(destKey)
    const dir = join(destPath, '..')
    await fs.mkdir(dir, { recursive: true })
    await fs.copyFile(sourcePath, destPath)
  }
}

// Storage provider factory
let storageProviderInstance: StorageProvider | null = null

export function getStorageProvider(): StorageProvider {
  if (!storageProviderInstance) {
    if (STORAGE_PROVIDER === 'local') {
      storageProviderInstance = new LocalStorageProvider()
    } else {
      storageProviderInstance = new S3StorageProvider()
    }
  }
  return storageProviderInstance
}

// Legacy functions for backward compatibility
let s3Client: S3Client | null = null

function getS3Client(): S3Client {
  if (!s3Client) {
    const endpoint = process.env.S3_ENDPOINT
    const region = process.env.S3_REGION ?? 'us-east-1'
    const accessKeyId = process.env.S3_ACCESS_KEY_ID ?? 'minioadmin'
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin'

    s3Client = new S3Client({
      region,
      endpoint,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
      credentials: { accessKeyId, secretAccessKey },
    })
  }
  return s3Client
}

function getBucket(): string {
  return process.env.S3_BUCKET ?? 'tenant-documents'
}

// Convenience functions that use the storage provider
export async function uploadFile(key: string, buffer: Buffer, contentType: string, metadata?: Record<string, string>): Promise<{ key: string; url: string }> {
  const provider = getStorageProvider()
  return provider.uploadFile(key, buffer, contentType, metadata)
}

export async function deleteFile(key: string): Promise<void> {
  const provider = getStorageProvider()
  return provider.deleteFile(key)
}

export async function copyFile(sourceKey: string, destKey: string): Promise<void> {
  const provider = getStorageProvider()
  return provider.copyFile(sourceKey, destKey)
}

export function contentTypeToExtension(contentType: string): string {
  const map: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  }
  const ext = map[contentType.toLowerCase()]
  if (!ext) {
    const parts = contentType.split('/')
    const fallback = parts[parts.length - 1]?.split('+')[0]
    return fallback && fallback.length <= 10 ? fallback : 'bin'
  }
  return ext
}

export function buildTenantDocumentObjectKey(
  tenantId: string,
  docType: string,
  contentType: string,
): string {
  const ext = contentTypeToExtension(contentType)
  return `tenant-documents/${tenantId}/${docType}/${randomUUID()}.${ext}`
}

export function buildPropertyMediaObjectKey(
  listingId: string,
  contentType: string,
): string {
  const ext = contentTypeToExtension(contentType)
  return `property-media/${listingId}/${randomUUID()}.${ext}`
}

export function buildInspectionReportObjectKey(
  jobId: string,
  contentType: string,
): string {
  const ext = contentTypeToExtension(contentType)
  return `inspection-reports/${jobId}/${randomUUID()}.${ext}`
}

export function buildAgreementObjectKey(
  dealId: string,
): string {
  return `agreements/${dealId}/agreement.pdf`
}

export async function generatePresignedUpload(
  key: string,
  contentType: string,
  ttlSeconds = UPLOAD_TTL_SECONDS,
): Promise<{ uploadUrl: string; expiresAt: string }> {
  const provider = getStorageProvider()
  const result = await provider.generatePresignedUpload(key, contentType, ttlSeconds)
  return {
    uploadUrl: result.uploadUrl,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  }
}

export async function generatePresignedDownload(
  key: string,
  ttlSeconds = DOWNLOAD_TTL_SECONDS,
): Promise<{ downloadUrl: string; expiresAt: string }> {
  const provider = getStorageProvider()
  const result = await provider.generatePresignedDownload(key, ttlSeconds)
  return {
    downloadUrl: result.downloadUrl,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  }
}

export const STORAGE_TTL = {
  UPLOAD_SECONDS: UPLOAD_TTL_SECONDS,
  DOWNLOAD_SECONDS: DOWNLOAD_TTL_SECONDS,
} as const
