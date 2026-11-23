# Shelterflex Backend

Node.js backend for Shelterflex.

## API Consistency Notes

- List endpoints should paginate consistently (cursor-based preferred for time-ordered or frequently-changing data), enforce a maximum page size, and return consistent pagination metadata.
- Error responses should use the shared `AppError` / `ErrorCode` contract in `src/errors/` so every failure class (unauthenticated, forbidden, not found, validation, conflict, rate limited, server error) is distinguishable and never leaks internals in production.
- Request bodies, query parameters, and path parameters should be validated via schemas in `src/schemas/` applied through the `validate` middleware, with explicit handling of unexpected extra fields.
- `docs/openapi.yml` should be kept in sync with the mounted route surface so it accurately reflects what the server serves.

## Setup

> **Package manager:** This project uses **npm**. Use `npm ci` (not `pnpm`) to match the lockfile and CI workflow.

```bash
npm ci
cp .env.example .env
npm run dev
```

- The backend CI job runs `npm ci` from this directory.
- For local API development, make sure PostgreSQL is available and that the environment file contains at least `DATABASE_URL` and `ENCRYPTION_KEY`.

## Testing

Run the integration test suite:

```bash
npm test
```

Run tests in watch mode (useful during development):

```bash
npm run test:watch
```

Run tests with coverage report:

```bash
npm run test:coverage
```

Run Soroban integration tests (requires configuration):

```bash
npm run test:integration
```

Tests are located in `src/**/*.test.ts` files and use Vitest + Supertest. 

- **Unit tests** do not require external network access — all blockchain interactions are stubbed.
- **Integration tests** make actual calls to Soroban testnet and require proper environment configuration. See [docs/soroban-integration-tests.md](docs/soroban-integration-tests.md) for details.

## Database migrations

SQL migrations live in `migrations/`.

At runtime (`src/migrations/runMigrations.ts`), migrations are:

- tracked by **exact filename** in `schema_migrations.filename`
- wrapped in a transaction per file
- skipped when that exact filename already exists in `schema_migrations`

Because tracking is filename-based, renaming an already-applied migration is unsafe (it can make an applied migration look unapplied and cause re-execution).

Ordering is resolved by `src/migrations/migrationOrdering.ts`:

- legacy files are pinned in `migrations/migration-order.manifest.json` with unique integer positions
- new files not listed in the manifest must use `YYYYMMDDHHMMSS_description.sql`
- timestamp-prefixed files are appended in lexicographic order (chronological) and duplicate timestamps are rejected

The repository includes a database setup script in `src/repositories/test.ts` that:

- creates a `schema_migrations` table if missing
- applies any `.sql` files not yet recorded

## Documentation

| Topic | File |
|---|---|
| API specification (OpenAPI) | [docs/openapi.yml](docs/openapi.yml) |
| Error handling contract | [src/docs/ERROR-INFO.md](src/docs/ERROR-INFO.md) |
| Soroban integration tests | [docs/soroban-integration-tests.md](docs/soroban-integration-tests.md) |
| Admin signing service | [docs/ADMIN_SIGNING.md](docs/ADMIN_SIGNING.md) |
| Webhook signature verification | [docs/WEBHOOK_SIGNATURE_VERIFICATION.md](docs/WEBHOOK_SIGNATURE_VERIFICATION.md) |

## API Specification

All API endpoints are now versioned under `/api/v1/`. The current version is `v1`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Service liveness check (includes API version) |
| `GET` | `/soroban/config` | Returns the active Soroban RPC configuration |
| `POST` | `/api/v1/example/echo` | Example endpoint demonstrating Zod validation |
| `POST` | `/soroban/simulate` | Validates and queues a Soroban contract simulation |

### OpenAPI drift guard

`npm run openapi:validate` only checks that `docs/openapi.yml` is valid. `src/docs/openapiCoverage.test.ts`
(part of `npm run test:ci`) checks that it is complete: it walks the real Express app, collects every
mounted `/api` route and compares `METHOD /path` with the spec (path parameters are compared as `{}`,
and `/api/v1` is read as `/api`, since the spec documents both).

- **Add a route:** document it in `docs/openapi.yml` in the same PR. A mounted route that the spec does
  not describe fails the test and lists the missing `METHOD /path`.
- **Remove a route:** remove its operation from the spec. A documented operation with no mounted route
  fails as dead documentation.
- **Allow-list:** `src/docs/openapiCoverage.allowlist.json` holds the routes that were undocumented
  when the guard was added. It may only shrink: when you document one of them, delete its line (the
  test fails if an entry is now documented or no longer exists), and lower `ALLOWLIST_CEILING` in the
  test. Never add a new route to it.
- Routes that are only mounted behind a feature flag or in non-test environments are not seen by the
  test. Routes mounted outside `/api/` (such as `/health`) are not checked.

### API Versioning

The API uses URL path versioning with the `/api/v1/` prefix. Requests to the unversioned `/api/*` paths are automatically redirected to `/api/v1/*` with deprecation headers.

**Version negotiation:**
- URL path prefix: `/api/v1/...` (preferred)
- `Accept-Version` header: `v1` (optional)
- Default: `v1`

**Deprecation headers:**
When accessing deprecated API versions, the response includes:
- `Deprecation: true`
- `Sunset: {date}` (ISO 8601 date string)
- `Link: </api/v1>; rel="successor-version"`

**Health check response:**
```json
{
  "status": "ok",
  "version": "0.1.0",
  "apiVersion": "v1",
  "uptimeSeconds": 1234,
  "dbLatencyMs": 5,
  "memoryUsageMb": 128,
  "requestId": "abc-123"
}
```

### POST `/api/v1/example/echo`

Example endpoint demonstrating Zod request validation. Use this as a reference pattern when adding new endpoints.

**Request body**

```json
{
  "message": "Hello, world!",
  "timestamp": 1234567890
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `message` | `string` | ✅ | 1-100 characters |
| `timestamp` | `number` | ❌ | Positive integer |

**Success – 200**

```json
{
  "echo": "Hello, world!",
  "receivedAt": "2026-02-27T10:30:00.000Z",
  "originalTimestamp": 1234567890
}
```

**Validation error – 400**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request data",
    "details": {
      "message": "Message cannot be empty"
    }
  }
}
```

**Example curl commands**

Valid request:
```bash
curl -X POST http://localhost:3001/api/v1/example/echo \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, world!", "timestamp": 1234567890}'
```

Invalid request (empty message):
```bash
curl -X POST http://localhost:3001/api/v1/example/echo \
  -H "Content-Type: application/json" \
  -d '{"message": ""}'
```

Invalid request (wrong type):
```bash
curl -X POST http://localhost:3001/api/v1/example/echo \
  -H "Content-Type: application/json" \
  -d '{"message": 123}'
```

### POST `/soroban/simulate`

Validates the request body with Zod before forwarding to the Soroban RPC node.
Returns **400** with structured field-level errors on invalid input.

**Request body**

```json
{
  "contractId": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  "method": "deposit",
  "args": [1000, "GABC..."]
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `contractId` | `string` | ✅ | Exactly 56 characters (Stellar strkey) |
| `method` | `string` | ✅ | Non-empty string |
| `args` | `unknown[]` | ❌ | Defaults to `[]` |

**Success – 200**

```json
{
  "contractId": "CAAA...",
  "method": "deposit",
  "args": [1000, "GABC..."],
  "status": "pending",
  "message": "Simulation queued – RPC integration coming soon"
}
```

**Validation error – 400**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request data",
    "details": {
      "contractId": "contractId must be a 56-character Stellar strkey"
    }
  }
}
```
The complete API specification is available in [OpenAPI format](docs/openapi.yml). It includes:
- All available endpoints
- Request/response schemas
- Error response formats
- Example requests and responses

You can view the OpenAPI spec in tools like Swagger UI or Redoc, or use it to generate client code.

## Request validation pattern

All endpoints that accept input use the `validate` middleware from
`src/middleware/validate.ts`. It wraps any Zod schema and can target
`body` (default), `query`, or `params`:

```ts
import { validate } from './middleware/validate.js'
import { mySchema } from './schemas/my-feature.js'

// validate body (default)
router.post('/route', validate(mySchema), handler)

// validate query string
router.get('/route', validate(mySchema, 'query'), handler)
```

Schemas live in `src/schemas/` and export both the Zod schema and the
inferred TypeScript type.

## Error handling

See [src/docs/ERROR-INFO.md](src/docs/ERROR-INFO.md) for the full error contract, code catalog, and usage examples.

## Environment Variables

Create a `.env` file based on `.env.example`. The following environment variables are required:

### Core Configuration
```bash
# Server
PORT=4000
NODE_ENV=development

# CORS (comma-separated origins)
CORS_ORIGINS=http://localhost:3000

# Rate limiting (public endpoints: /health, /soroban/config)
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
```

### Soroban / Stellar Configuration
```bash
# Soroban network (local|testnet|mainnet)
SOROBAN_NETWORK=testnet

# Soroban adapter mode (stub|real)
# 'stub' (default) uses fake data, 'real' makes actual contract calls
SOROBAN_ADAPTER_MODE=stub

# USDC token contract address (required in non-development environments).
# This must be a Soroban contract ID: a 56-character Stellar StrKey starting with 'C' (base32).
# Prefer SOROBAN_USDC_TOKEN_ID; USDC_TOKEN_ADDRESS is accepted as a legacy alias.
# Testnet example: USDC_TOKEN_ADDRESS=CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
# Mainnet example: USDC_TOKEN_ADDRESS=CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7EJJUD
USDC_TOKEN_ADDRESS=

# Soroban RPC URL and network passphrase
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
SOROBAN_NETWORK_PASSPHRASE=Test SDF Network ; September 2015

# Soroban contract IDs (required for 'real' adapter mode).
# Each value must be a 56-character Stellar StrKey starting with 'C'.
SOROBAN_CONTRACT_ID=
SOROBAN_USDC_TOKEN_ID=
SOROBAN_STAKING_POOL_ID=
SOROBAN_STAKING_REWARDS_ID=
```

### Indexer Configuration
```bash
# How often the indexer polls for new ledgers (in milliseconds). Default is 5000.
INDEXER_POLL_MS=5000

# The ledger sequence number to start indexing from. If omitted, the indexer starts from the current network ledger.
INDEXER_START_LEDGER=
```

**Important Notes:**
- `SOROBAN_USDC_TOKEN_ID` (preferred) or `USDC_TOKEN_ADDRESS` (legacy alias) is **required** in `production` environments
- In `development` and `test`, the token ID can be omitted (the server uses mock/stub data)
- The value must be a valid Soroban contract ID: a **56-character Stellar StrKey starting with `C`** (base32-encoded, no `0x` prefix)
- Server will refuse to start if neither variable is set in non-development/non-test environments

**Soroban Adapter Mode**: The backend uses an adapter pattern for Soroban interactions:
- `SOROBAN_ADAPTER_MODE=stub` (Default): Uses in-memory state and fake data. No network calls are made. Suitable for local UI development and unit testing.
- `SOROBAN_ADAPTER_MODE=real`: Performs actual calls to the Soroban RPC. Requires all contract IDs and network configuration to be set.

**Admin Signing**: Admin operations (pause/unpause, set_operator, init) require:
- `SOROBAN_ADMIN_SECRET` - Admin secret key for signing transactions
- `SOROBAN_ADMIN_SIGNING_ENABLED=true` - Feature flag to enable admin signing

> [!CAUTION]
> **Security**: `SOROBAN_ADMIN_SECRET` confers full control over the contracts. It should ONLY be used in restricted admin contexts and NEVER committed to version control. General request handlers do not have access to this secret.


## Production integration guard (#1942)

Several integrations default to a stub or mock when their env var is unset. In
production the server refuses to start while any integration resolves to a stub,
so a missing variable cannot produce fake balances, KYC approvals or payment
confirmations.

Set these in production so every integration uses its real provider:

| Integration | Env var | Stub / mock value |
|---|---|---|
| `soroban` | `SOROBAN_ADAPTER_MODE=real` (or `USE_REAL_SOROBAN=true`) | `stub` |
| `paymentRail.psp` | `PSP_PROVIDER_PSP` | `stub` |
| `paymentRail.paystack` | `PSP_PROVIDER_PAYSTACK=paystack` | `stub` |
| `paymentRail.flutterwave` | `PSP_PROVIDER_FLUTTERWAVE=flutterwave` | `stub` |
| `conversion` | `CONVERSION_PROVIDER` | `stub` |
| `kyc` | `KYC_PROVIDER_TYPE` | `stub` |
| `esign` | `ESIGN_PROVIDER` | `stub` |
| `creditBureau` | `CREDIT_BUREAU_PROVIDER` | `mock` |
| `aiScoring` | `AI_SCORING_PROVIDER` | `stub` |

An integration with no real provider yet can be accepted explicitly with
`ALLOW_STUB_PROVIDERS` (comma-separated names from the table, case-insensitive):

```bash
ALLOW_STUB_PROVIDERS=aiScoring
```

Opted-out stubs log a `production.stub_integration_allowed` warning at boot.
`GET /health` lists every integration on a stub in `stubbedIntegrations`, whether
or not it is opted out. Outside production the guard never blocks startup.

## Request IDs

Every incoming request is assigned a unique request ID to help track and debug requests across the system.

- If the client sends `x-request-id` in the request header, it is reused.
- Otherwise, a UUID is generated automatically.
- The request ID is returned in the response header (`x-request-id`).
- Error responses include the request ID in both the header and the JSON body.
- Logs include the request ID for easier correlation between requests and system logs.

Example:

Request:
GET /health
x-request-id: abc-123

Response:
HTTP/1.1 200 OK
x-request-id: abc-123
{
  "status": "ok",
  "requestId": "abc-123"
}
## Rate limiting

The backend implements a comprehensive rate limiting system to protect sensitive endpoints and prevent abuse. It supports per-endpoint, per-user (authenticated), and per-IP (unauthenticated) limits.

### Configuration

Rate limits are configured in `src/middleware/comprehensiveRateLimit.ts`. Default limits are:

| Category | Endpoints | Default Limit | Window |
|----------|-----------|---------------|--------|
| Auth | `/api/auth/*` | 5-20 reqs | 1-15 min |
| Wallet | `/api/wallet/*` | 30 reqs | 1 min |
| Admin | `/api/admin/*` | 10 reqs | 1 min |
| General | `/api/*` | 50-100 reqs | 1 min |

### Environment Variables

Global defaults can be adjusted via environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `RATE_LIMIT_WINDOW_MS` | Default time window in milliseconds | `60000` (1 minute) |
| `RATE_LIMIT_MAX_REQUESTS` | Default max requests per IP/user per window | `100` |

### Headers

The server includes standard rate limit headers in all API responses:

- `X-RateLimit-Limit`: The total limit for the current window.
- `X-RateLimit-Remaining`: Remaining requests in the current window.
- `X-RateLimit-Reset`: Time when the limit resets (UTC timestamp in seconds).
- `Retry-After`: (Only on 429) Number of seconds to wait before retrying.

### 429 Too Many Requests

When a limit is exceeded, the server returns a **429** error with a `Retry-After` header:

```json
{
  "error": {
    "code": "TOO_MANY_REQUESTS",
    "message": "Too many requests. Please try again later."
  }
}
```

Health checks (`/health`) are exempt from rate limiting.

## Object Storage

The backend uses S3-compatible object storage for tenant documents, property media, inspection reports, and rental agreements. The storage layer supports both AWS S3 and MinIO (for local development).

### Configuration

Set the storage provider and credentials in `.env`:

```bash
# Storage provider: s3 (AWS S3 or MinIO) or local (filesystem)
STORAGE_PROVIDER=s3

# S3 Configuration (required when STORAGE_PROVIDER=s3)
S3_BUCKET=tenant-documents
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=your_access_key
S3_SECRET_ACCESS_KEY=your_secret_key
S3_ENDPOINT=https://s3.amazonaws.com  # For MinIO: http://localhost:9000
S3_FORCE_PATH_STYLE=false  # Set to true for MinIO

# Local Storage Configuration (required when STORAGE_PROVIDER=local)
LOCAL_STORAGE_DIR=/tmp/shelterflex-dev
```

### Local Development with MinIO

For local development, you can run MinIO using Docker:

```bash
docker run -d \
  -p 9000:9000 \
  -p 9001:9001 \
  --name minio \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio server /data --console-address ":9001"
```

Then configure your `.env`:

```bash
STORAGE_PROVIDER=s3
S3_BUCKET=tenant-documents
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_ENDPOINT=http://localhost:9000
S3_FORCE_PATH_STYLE=true
```

After starting MinIO:
1. Visit http://localhost:9001
2. Login with `minioadmin` / `minioadmin`
3. Create a bucket named `tenant-documents`
4. Set bucket policy to block all public access (access via presigned URLs only)

### Bucket Structure Convention

Files are organized using the following key structure:

- `tenant-documents/{tenantId}/{docType}/{uuid}.{ext}` - Tenant documents
- `property-media/{listingId}/{uuid}.{ext}` - Property images
- `inspection-reports/{jobId}/{uuid}.{ext}` - Inspection reports
- `agreements/{dealId}/agreement.pdf` - Rental agreements

### Usage

```typescript
import {
  getStorageProvider,
  buildTenantDocumentObjectKey,
  uploadFile,
  deleteFile,
  generatePresignedUpload,
  generatePresignedDownload,
  copyFile,
} from './services/storageService.js'

// Get the configured storage provider
const provider = getStorageProvider()

// Upload a file
const key = buildTenantDocumentObjectKey('tenant-123', 'id-proof', 'application/pdf')
const { key: objectKey, url } = await uploadFile(key, buffer, 'application/pdf')

// Generate presigned upload URL (for direct browser upload)
const { uploadUrl, objectKey } = await generatePresignedUpload(key, 'image/jpeg', 900)

// Generate presigned download URL
const { downloadUrl } = await generatePresignedDownload(key, 300)

// Delete a file
await deleteFile(key)

// Copy a file
await copyFile(sourceKey, destKey)
```

### Switching Providers

Set `STORAGE_PROVIDER=local` to use filesystem storage without AWS credentials:

```bash
STORAGE_PROVIDER=local
LOCAL_STORAGE_DIR=/tmp/shelterflex-dev
```

This is useful for local development when you don't want to run MinIO.
