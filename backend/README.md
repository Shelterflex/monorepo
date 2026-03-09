# Shelterflex Backend

Node.js backend for Shelterflex.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

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

Tests are located in `src/**/*.test.ts` files and use Vitest + Supertest. They do not require external network access — all blockchain interactions are stubbed.

## Database migrations

SQL migrations live in `migrations/` and are applied in filename order.

The repository includes a migration runner script in `src/repositories/test.ts` that:

- creates a `schema_migrations` table if missing
- applies any `.sql` files not yet recorded

## Documentation

| Topic | File |
|---|---|
| API specification (OpenAPI) | [openapi.yml](openapi.yml) |
| Error handling contract | [src/docs/ERROR-INFO.md](src/docs/ERROR-INFO.md) |

## API Specification

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Service liveness check |
| `GET` | `/soroban/config` | Returns the active Soroban RPC configuration |
| `POST` | `/api/example/echo` | Example endpoint demonstrating Zod validation |
| `POST` | `/soroban/simulate` | Validates and queues a Soroban contract simulation |

### POST `/api/example/echo`

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
curl -X POST http://localhost:3001/api/example/echo \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, world!", "timestamp": 1234567890}'
```

Invalid request (empty message):
```bash
curl -X POST http://localhost:3001/api/example/echo \
  -H "Content-Type: application/json" \
  -d '{"message": ""}'
```

Invalid request (wrong type):
```bash
curl -X POST http://localhost:3001/api/example/echo \
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
The complete API specification is available in [OpenAPI format](openapi.yml). It includes:
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

# USDC token contract address (required in non-development environments)
# Testnet example: USDC_TOKEN_ADDRESS=0x8d3e2a4e2c3b4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9
# Mainnet example: USDC_TOKEN_ADDRESS=0xa0b86a33e6c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c
USDC_TOKEN_ADDRESS=

# Soroban RPC URL and network passphrase
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
SOROBAN_NETWORK_PASSPHRASE=Test SDF Network ; September 2015

# Optional: contract id for the deployed Shelterflex contract
SOROBAN_CONTRACT_ID=
```

**Important Notes:**
- `USDC_TOKEN_ADDRESS` is **required** in `production` and `test` environments
- In `development`, the address can be omitted (uses mock address for testing)
- The address must be a valid Ethereum address format: `0x` followed by 40 hex characters
- Server will refuse to start if `USDC_TOKEN_ADDRESS` is missing in non-development environments

## Soroban integration

Soroban-related code should live in `src/soroban/`.

Environment variables:

- `RATE_LIMIT_WINDOW_MS` (optional, default `60000`)
- `RATE_LIMIT_MAX_REQUESTS` (optional, default `100`)
- `SOROBAN_RPC_URL`
- `SOROBAN_NETWORK_PASSPHRASE`
- `SOROBAN_CONTRACT_ID` (optional)


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

Public endpoints (`GET /health`, `GET /soroban/config`) are rate limited per IP to reduce abuse and protect uptime.

| Variable | Description | Default |
|----------|-------------|---------|
| `RATE_LIMIT_WINDOW_MS` | Time window in milliseconds | `60000` (1 minute) |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per IP per window | `100` |

When a client exceeds the limit, the server responds with **429 Too Many Requests** and a JSON body in the standard error format:

```json
{
  "error": "Too many requests. Please try again later."
}
```

Defaults are suitable for local development; set lower limits in production if needed.

