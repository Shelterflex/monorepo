import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  buildOrderedMigrationFiles,
  type LegacyMigrationManifest,
} from './migrationOrdering.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const migrationsDir = path.resolve(__dirname, '../../migrations')

describe('migration ordering manifest', () => {
  it('orders legacy migrations and appends timestamped migrations', async () => {
    const sqlFiles = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql'))
    const manifestRaw = await readFile(
      path.join(migrationsDir, 'migration-order.manifest.json'),
      'utf8',
    )
    const manifest = JSON.parse(manifestRaw) as LegacyMigrationManifest

    const orderedFiles = buildOrderedMigrationFiles(sqlFiles, manifest)

    expect(orderedFiles).toHaveLength(sqlFiles.length)
    expect(new Set(orderedFiles).size).toBe(sqlFiles.length)

    const manifestFiles = manifest.legacyMigrations
      .sort((a, b) => a.position - b.position)
      .map((entry) => entry.filename)
    const manifestSet = new Set(manifestFiles)
    const timestampedFiles = sqlFiles
      .filter((file) => !manifestSet.has(file))
      .sort((a, b) => a.localeCompare(b))
    expect(orderedFiles).toEqual([...manifestFiles, ...timestampedFiles])
  })

  it('fails on duplicate legacy positions', () => {
    expect(() =>
      buildOrderedMigrationFiles(['001_init.sql', '002_ngn_deposits.sql'], {
        version: 1,
        legacyMigrations: [
          { position: 1, filename: '001_init.sql' },
          { position: 1, filename: '002_ngn_deposits.sql' },
        ],
      }),
    ).toThrow('Duplicate migration position 1 in legacy manifest.')
  })

  it('fails when a new migration is not timestamp-prefixed', () => {
    expect(() =>
      buildOrderedMigrationFiles(['001_init.sql', 'new_feature.sql'], {
        version: 1,
        legacyMigrations: [{ position: 1, filename: '001_init.sql' }],
      }),
    ).toThrow(
      'New migration must use timestamp prefix YYYYMMDDHHMMSS_description.sql: new_feature.sql',
    )
  })

  it('fails when two timestamped migrations share a prefix', () => {
    expect(() =>
      buildOrderedMigrationFiles(
        [
          '001_init.sql',
          '20260727120000_add_table.sql',
          '20260727120000_add_index.sql',
        ],
        {
          version: 1,
          legacyMigrations: [{ position: 1, filename: '001_init.sql' }],
        },
      ),
    ).toThrow(
      'Duplicate migration timestamp prefix 20260727120000 detected (20260727120000_add_table.sql, 20260727120000_add_index.sql).',
    )
  })
})
