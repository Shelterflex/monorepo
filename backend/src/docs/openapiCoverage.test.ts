/**
 * OpenAPI drift guard (#2001).
 *
 * `npm run openapi:validate` checks that docs/openapi.yml is valid, not that it is complete. This
 * test walks the real Express app, collects every mounted `/api` route and compares it with the
 * spec:
 *
 *  - a mounted route that the spec does not document fails, unless it is in the committed
 *    allow-list (`openapiCoverage.allowlist.json`, the routes that were undocumented when the guard
 *    was added). New routes therefore have to be documented;
 *  - a spec operation with no matching mounted route fails (dead documentation);
 *  - an allow-list entry that is now documented, or no longer exists, fails, so the list can only
 *    shrink; and it may not grow past `ALLOWLIST_CEILING`.
 *
 * Routes are compared as `METHOD /path` with every path parameter reduced to `{}` and `/api/v1`
 * read as `/api` (the spec documents the same operations under both prefixes).
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { collectRoutes, mountPathOf, routeKey } from './routeCollector.js'
import { loadOpenApiSpec } from './openApiRegistry.js'

/** Lower this when you shrink the allow-list; the test fails if the list is ever longer. */
const ALLOWLIST_CEILING = 145

const HERE = path.dirname(fileURLToPath(import.meta.url))
const allowlist: string[] = JSON.parse(
  readFileSync(path.join(HERE, 'openapiCoverage.allowlist.json'), 'utf8'),
).routes

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete']

function mountedKeys(): Set<string> {
  return new Set(
    collectRoutes(createApp())
      .filter((r) => r.path.startsWith('/api/'))
      .map((r) => routeKey(r.method, r.path)),
  )
}

function documentedKeys(): Set<string> {
  const keys = new Set<string>()
  for (const [p, item] of Object.entries(loadOpenApiSpec().paths)) {
    if (!p.startsWith('/api/')) continue
    for (const method of Object.keys(item)) {
      if (HTTP_METHODS.includes(method)) keys.add(routeKey(method, p))
    }
  }
  return keys
}

const mounted = mountedKeys()
const documented = documentedKeys()
const allowed = new Set(allowlist)

const fix = (heading: string, items: string[], hint: string) =>
  `${heading} (${items.length}):\n  ${items.slice(0, 40).join('\n  ')}${items.length > 40 ? '\n  ...' : ''}\n${hint}`

describe('OpenAPI spec drift guard (#2001)', () => {
  it('finds the mounted routes (sanity check on the collector)', () => {
    expect(mounted.size).toBeGreaterThan(200)
    expect(mounted.has('POST /api/staking/stake')).toBe(true)
    expect(mounted.has('GET /api/wallet/ngn/balance')).toBe(true)
  })

  it('documents every mounted route, except the allow-listed ones', () => {
    const undocumented = [...mounted].filter((k) => !documented.has(k) && !allowed.has(k)).sort()

    expect(
      undocumented,
      fix(
        'Mounted routes missing from docs/openapi.yml',
        undocumented,
        'Document them in backend/docs/openapi.yml. Do not add them to openapiCoverage.allowlist.json.',
      ),
    ).toEqual([])
  })

  it('has no documented operation without a mounted route (dead documentation)', () => {
    const dead = [...documented].filter((k) => !mounted.has(k)).sort()

    expect(
      dead,
      fix('Operations in docs/openapi.yml with no mounted route', dead, 'Remove them from the spec, or mount the route.'),
    ).toEqual([])
  })

  it('keeps the allow-list honest: every entry is still mounted and still undocumented', () => {
    const gone = allowlist.filter((k) => !mounted.has(k))
    const nowDocumented = allowlist.filter((k) => documented.has(k))

    expect(gone, fix('Allow-listed routes that no longer exist', gone, 'Delete them from openapiCoverage.allowlist.json.')).toEqual([])
    expect(
      nowDocumented,
      fix('Allow-listed routes that are now documented', nowDocumented, 'Delete them from openapiCoverage.allowlist.json.'),
    ).toEqual([])
  })

  it('only shrinks: no duplicates, sorted, and never longer than the ceiling', () => {
    expect(new Set(allowlist).size).toBe(allowlist.length)
    expect([...allowlist].sort()).toEqual(allowlist)
    expect(
      allowlist.length,
      'The allow-list grew. Document the new route instead of allow-listing it.',
    ).toBeLessThanOrEqual(ALLOWLIST_CEILING)
  })
})

describe('route collector', () => {
  it('normalises parameters and the version prefix', () => {
    expect(routeKey('get', '/api/v1/deals/:dealId/lease/')).toBe('GET /api/deals/{}/lease')
    expect(routeKey('POST', '/api/deals/{id}')).toBe('POST /api/deals/{}')
    expect(routeKey('get', '/api/v1')).toBe('GET /api')
  })

  it('rebuilds the mount path from a layer, parameters included', () => {
    const plain = { regexp: /^\/api\/v1\/admin\/?(?=\/|$)/i, keys: [] }
    const param = { regexp: new RegExp('^\\/api\\/users\\/(?:([^\\/]+?))\\/?(?=\\/|$)', 'i'), keys: [{ name: 'userId' }] }
    expect(mountPathOf(plain as never)).toBe('/api/v1/admin')
    expect(mountPathOf(param as never)).toBe('/api/users/:userId')
    expect(mountPathOf({ regexp: Object.assign(/^\/?(?=\/|$)/i, { fast_slash: true }) } as never)).toBe('')
  })
})
