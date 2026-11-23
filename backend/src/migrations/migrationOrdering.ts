import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const LEGACY_MANIFEST_FILENAME = 'migration-order.manifest.json'
const LEGACY_PREFIX = /^\d{3}_.+\.sql$/
const TIMESTAMPED_PREFIX = /^(\d{14})_[a-z0-9][a-z0-9_]*\.sql$/i

export type LegacyMigrationManifest = {
  version: number
  legacyMigrations: Array<{
    position: number
    filename: string
  }>
}

export async function getOrderedMigrationFiles(migrationsDir: string): Promise<string[]> {
  const sqlFiles = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql'))
  const manifestPath = path.join(migrationsDir, LEGACY_MANIFEST_FILENAME)
  const manifestRaw = await readFile(manifestPath, 'utf8')
  const manifest = JSON.parse(manifestRaw) as LegacyMigrationManifest

  return buildOrderedMigrationFiles(sqlFiles, manifest)
}

export function buildOrderedMigrationFiles(
  sqlFiles: string[],
  manifest: LegacyMigrationManifest,
): string[] {
  const files = Array.from(new Set(sqlFiles))

  const positions = new Set<number>()
  const manifestFilenames = new Set<string>()
  for (const entry of manifest.legacyMigrations) {
    if (positions.has(entry.position)) {
      throw new Error(`Duplicate migration position ${entry.position} in legacy manifest.`)
    }
    positions.add(entry.position)

    if (manifestFilenames.has(entry.filename)) {
      throw new Error(`Duplicate migration filename ${entry.filename} in legacy manifest.`)
    }
    manifestFilenames.add(entry.filename)

    if (!files.includes(entry.filename)) {
      throw new Error(`Legacy migration missing from disk: ${entry.filename}`)
    }
  }

  const unmanagedLegacy = files.filter(
    (file) => LEGACY_PREFIX.test(file) && !manifestFilenames.has(file),
  )
  if (unmanagedLegacy.length > 0) {
    throw new Error(
      `Legacy-prefixed migrations must be declared in ${LEGACY_MANIFEST_FILENAME}: ${unmanagedLegacy.join(', ')}`,
    )
  }

  const timestampedFiles = files.filter((file) => !manifestFilenames.has(file))
  const timestampPrefixMap = new Map<string, string>()
  for (const file of timestampedFiles) {
    const match = TIMESTAMPED_PREFIX.exec(file)
    if (!match) {
      throw new Error(
        `New migration must use timestamp prefix YYYYMMDDHHMMSS_description.sql: ${file}`,
      )
    }

    const prefix = match[1]
    const existing = timestampPrefixMap.get(prefix)
    if (existing) {
      throw new Error(
        `Duplicate migration timestamp prefix ${prefix} detected (${existing}, ${file}).`,
      )
    }
    timestampPrefixMap.set(prefix, file)
  }

  const orderedLegacy = [...manifest.legacyMigrations]
    .sort((a, b) => a.position - b.position)
    .map((entry) => entry.filename)

  return [...orderedLegacy, ...timestampedFiles.sort((a, b) => a.localeCompare(b))]
}
