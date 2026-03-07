# Convex Agent Bridge (Config-First)

[![npm version](https://badge.fury.io/js/@okrlinkhub%2Fagent-bridge.svg)](https://badge.fury.io/js/@okrlinkhub%2Fagent-bridge)

`@okrlinkhub/agent-bridge` exposes an HTTP gateway for external agents with a **config-first** approach:

- declare exposed Convex functions in a single file;
- configure permissions in batch only for those functions;
- no changes to existing Convex queries/mutations/actions.

## Installation

```sh
npm install @okrlinkhub/agent-bridge
```

## Quick setup

### 1) Initialize files in the consumer project

```sh
npx @okrlinkhub/agent-bridge init
```

This creates:

- `agent-bridge.config.ts` (project root)
- `convex/agentBridge.ts`

### 2) Enable the component in `convex/convex.config.ts`

```ts
import { defineApp } from "convex/server";
import agentBridge from "@okrlinkhub/agent-bridge/convex.config.js";

const app = defineApp();
app.use(agentBridge);
export default app;
```

### 3) Mount routes in `convex/http.ts`

```ts
import { httpRouter } from "convex/server";
import { registerAgentBridgeRoutes } from "./agentBridge";

const http = httpRouter();
registerAgentBridgeRoutes(http);
export default http;
```

Optional: customize auth in `registerRoutes`:

```ts
registerRoutes(http, components.agentBridge, bridgeConfig, {
  pathPrefix: "/agent",
  serviceKeysEnvVar: "AGENT_BRIDGE_SERVICE_KEYS_JSON",
  linkingMode: "component_api_only",
});
```

`linkingMode: "component_api_only"` is the default and keeps linking on the component's Convex API (no HTTP linking endpoints exposed by the bridge).

### 4) Configure exposed functions in `agent-bridge.config.ts`

```ts
import { api } from "./convex/_generated/api";
import { defineAgentBridgeConfig } from "@okrlinkhub/agent-bridge";

export default defineAgentBridgeConfig({
  functions: {
    "cart.calculatePrice": { ref: api.cart.calculatePrice, type: "query" },
    "cart.applyDiscount": { ref: api.cart.applyDiscount, type: "mutation" },
    "okr.create": { ref: api.okr.create, type: "mutation" },
  },
  metadata: {
    "cart.calculatePrice": {
      description: "Calculate total price",
      riskLevel: "low",
      category: "commerce",
    },
  },
});
```

## Exposed HTTP endpoints

- `POST /agent/execute`
- `GET /agent/functions`

### `POST /agent/execute`

Required headers (strict-only):

- `X-Agent-Service-Id: <service-id>`
- `X-Agent-Service-Key: <service-key>`
- `X-Agent-App: <app-key>` (e.g. `crm`, `billing`)

Optional header for Convex user context:

- `Authorization: Bearer <user-jwt>`

Optional headers for audit linking (hashed in bridge logs):

- `X-Agent-Link-Provider`
- `X-Agent-Link-Provider-User-Id`
- `X-Agent-Link-User-Subject`
- `X-Agent-Link-Status`

When to use:

- If the target function uses `ctx.auth.getUserIdentity()`, always send `Authorization`.
- If the function is service-only, `Authorization` can be omitted.

Required body:

```json
{
  "functionKey": "cart.calculatePrice",
  "args": { "cartId": "..." }
}
```

Response:

- success: `{ "success": true, "result": ... }`
- error: `{ "success": false, "error": "..." }`

Main status codes: `401`, `403`, `404`, `429`, `500`.

## User context cross-app (best practice)

To use Agent Bridge in Convex apps with different auth stacks, follow this contract:

1. **Service auth** (always): `X-Agent-Service-Id`, `X-Agent-Service-Key`, `X-Agent-App`
2. **User auth** (when needed): `Authorization: Bearer <user-jwt>`

Common token sources:

- `nextauth_convex`: read `session.convexToken` server-side
- `auth0`: use Auth0 access token valid for Convex
- `custom_oidc`: use OIDC token from the app's provider

The package includes reusable helpers:

```ts
import {
  buildAgentBridgeStrictHeaders,
  createAuth0TokenAdapter,
  createCustomOidcTokenAdapter,
  createNextAuthConvexTokenAdapter,
  parseAppBaseUrlMap,
  resolveAppBaseUrlForAppKey,
  resolveUserToken,
  validateJwtClaims,
} from "@okrlinkhub/agent-bridge";
```

Quick example:

```ts
const tokenAdapter = createNextAuthConvexTokenAdapter({
  getSession: async () => session,
});

const userToken = await resolveUserToken(tokenAdapter);
const validation = userToken
  ? validateJwtClaims(userToken, { expectedAudience: "convex" })
  : { valid: false };

const headers = buildAgentBridgeStrictHeaders({
  serviceId: process.env.OPENCLAW_SERVICE_ID!,
  serviceKey: process.env.OPENCLAW_SERVICE_KEY!,
  appKey: "crm",
  userToken: validation.valid ? userToken : null,
});
```

Notes:

- `validateJwtClaims` only checks claims (`exp`, `iss`, `aud`) and does not replace Convex's cryptographic validation.
- Never log user tokens or service keys.

## Environment variables — detailed setup

**Single source of truth:** `.env.local` in the project root.

Put all variables in `.env.local`, then sync them to Convex, Vercel, and Fly.io (or Railway) according to the matrix below.

### Sync matrix (from .env.local to platforms)

| Variable | Convex | Vercel | Fly.io / Railway |
|----------|--------|--------|-----------------|
| AGENT_BRIDGE_SERVICE_KEYS_JSON | ✓ | — | — |
| AGENT_BRIDGE_AUDIT_HASH_SALT | ✓ | — | — |
| PUBLISHED_SITE_URL | ✓ | — | — |
| AGENT_BRIDGE_BASE_URL | — | ✓ | — |
| APP_BASE_URL_MAP_JSON | — | ✓ | ✓ |
| OPENCLAW_SERVICE_ID | — | ✓ | ✓ |
| OPENCLAW_SERVICE_KEY | — | ✓ | ✓ |

**Important:** This package reads only `AGENT_BRIDGE_SERVICE_KEYS_JSON`, `AGENT_BRIDGE_AUDIT_HASH_SALT`, and `APP_BASE_URL_MAP_JSON`. Variables like `OPENCLAW_*`, `PUBLISHED_SITE_URL`, and `AGENT_BRIDGE_BASE_URL` belong to the integration flow (OpenClaw + frontend/BFF), not the package runtime.

### Where do service_id and service_key come from?

- **service_id:** You choose it. A readable identifier for the service instance calling the bridge (e.g. `openclaw-prod`, `openclaw-staging`, `my-agent`).
- **service_key:** Generate it with the package helper. A cryptographic secret (format `abs_live_<random>`).

**Flow:**

1. Choose a `service_id` (e.g. `openclaw-prod`).
2. Generate the `service_key` (see below).
3. Add the pair to `AGENT_BRIDGE_SERVICE_KEYS_JSON` on Convex.
4. Use the same `service_id` and `service_key` in `OPENCLAW_SERVICE_ID` and `OPENCLAW_SERVICE_KEY` on Vercel/Fly.io/Railway.

**Generate service_key (Node.js, requires package installed):**

```sh
node -e "import('@okrlinkhub/agent-bridge').then(m => console.log(m.generateAgentBridgeServiceKey()))"
```

Or in TypeScript:

```ts
import { generateAgentBridgeServiceKey } from "@okrlinkhub/agent-bridge";

const serviceKey = generateAgentBridgeServiceKey(); // e.g. abs_live_abc123...
```

**Generate AGENT_BRIDGE_AUDIT_HASH_SALT:**

```sh
openssl rand -base64 32
```

Or with Node.js:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Complete .env.local example

```env
# Convex (sync to Convex Dashboard)
AGENT_BRIDGE_SERVICE_KEYS_JSON={"openclaw-prod":"abs_live_xxx","openclaw-staging":"abs_live_yyy"}
AGENT_BRIDGE_AUDIT_HASH_SALT=<random-32-chars>
PUBLISHED_SITE_URL=https://app.example.com

# Vercel / Fly.io / Railway (sync to all platforms)
APP_BASE_URL_MAP_JSON={"crm":"https://crm.example.com","billing":"https://billing.example.com"}
OPENCLAW_SERVICE_ID=openclaw-prod
OPENCLAW_SERVICE_KEY=abs_live_xxx

# Vercel only (BFF that invokes the bridge)
AGENT_BRIDGE_BASE_URL=https://your-deployment.convex.site
```

### Convex Dashboard — step by step

1. Go to [dashboard.convex.dev](https://dashboard.convex.dev).
2. Select your consumer app project.
3. Sidebar → **Settings** → **Environment Variables**.
4. Click **Add Environment Variable**.
5. **Name:** `AGENT_BRIDGE_SERVICE_KEYS_JSON`
6. **Value:** JSON (e.g. `{"openclaw-prod":"abs_live_xxx"}`). No extra spaces, use double quotes.
7. Select **Development** and **Production**.
8. Click **Save**.

Repeat for `AGENT_BRIDGE_AUDIT_HASH_SALT` and `PUBLISHED_SITE_URL`.

### OpenClaw multi-app setup

For multiple OpenClaw instances managing multiple apps:

1. In Convex, set the variables from the matrix above.
2. Register an agent per app with a unique `appKey`: `crm`, `billing`, `warehouse`, etc.
3. OpenClaw sends for each call:
   - `X-Agent-Service-Id` (instance identity)
   - `X-Agent-Service-Key` (key for that instance)
   - `X-Agent-App` (varies by target app)

### Multi-app URL routing (appKey -> baseUrl)

When OpenClaw must call multiple consumer apps (e.g. `execute-on-behalf` endpoint), use:

- `APP_BASE_URL_MAP_JSON={"crm":"https://crm.example.com","billing":"https://billing.example.com"}`

Package helpers:

```ts
import {
  parseAppBaseUrlMap,
  resolveAppBaseUrlForAppKey,
} from "@okrlinkhub/agent-bridge";

const appBaseUrlMap = parseAppBaseUrlMap({
  appBaseUrlMapEnvVar: "APP_BASE_URL_MAP_JSON",
});
const resolvedBaseUrl = resolveAppBaseUrlForAppKey({
  appKey: "crm",
  appBaseUrlMap,
});
if (!resolvedBaseUrl.ok) {
  throw new Error(resolvedBaseUrl.error);
}
// resolvedBaseUrl.baseUrl => https://crm.example.com
```

Policy: no fallback to legacy `APP_BASE_URL`. If `appKey` is not in the map, fail explicitly.

### Platform-specific setup

**Vercel:** Project → Settings → Environment Variables. Sync variables from `.env.local` per the matrix. Set for Production, Preview, and Development.

**Fly.io:** App → Secrets (or `fly secrets set KEY=value`). Sync `APP_BASE_URL_MAP_JSON`, `OPENCLAW_SERVICE_ID`, `OPENCLAW_SERVICE_KEY` from `.env.local`.

**Railway:** Service → Variables. Same variables as Fly.io.

### Consistency checklist

1. `OPENCLAW_SERVICE_ID` + `OPENCLAW_SERVICE_KEY` must match an entry in `AGENT_BRIDGE_SERVICE_KEYS_JSON` on Convex.
2. `appKey` values in `APP_BASE_URL_MAP_JSON` must match `X-Agent-App` in requests and the database.
3. No fallback to a single `APP_BASE_URL`: if `appKey` is not mapped, fail explicitly.
4. Never log secrets (`OPENCLAW_SERVICE_KEY`, bearer token).

Benefits:
- centralized control and debugging in the Convex bridge;
- no multiple API key submissions in requests;
- rotation and per-app policies managed in the bridge.

## Agent and permission management

Component mutations/queries available in `components.agentBridge`:

- `agents.createAgent`
- `agents.updateAgent`
- `agents.rotateApiKey`
- `agents.listAgents`
- `gateway.authorizeByAppKey`
- `permissions.setAgentPermissions` (batch)
- `permissions.listAgentPermissions`
- `permissions.setFunctionOverrides` (batch)
- `permissions.listFunctionOverrides`
- `gateway.queryAccessLog`
- `linking.upsertLink`
- `linking.resolveLink`
- `linking.revokeLink`
- `linking.listLinks`

### Link registry in the component (per-app)

The user link registry is persisted in the component's Convex DB:

- logical key: `provider + providerUserId + appKey`
- target: `appUserSubject`
- status: `active | revoked | expired`

Each app that installs the component keeps its own registry in its Convex deployment, without a centralized cross-app database.

### Batch permissions example

```ts
await ctx.runMutation(components.agentBridge.permissions.setAgentPermissions, {
  agentId,
  rules: [
    { pattern: "cart.*", permission: "allow" },
    {
      pattern: "okr.create",
      permission: "rate_limited",
      rateLimitConfig: { requestsPerHour: 60, tokenBudget: 50000 },
    },
  ],
  availableFunctionKeys: Object.keys(config.functions),
});
```

## Breaking change: strict-only

As of this version:
- `X-Agent-API-Key` is no longer supported in the HTTP runtime;
- there is no single-key fallback;
- the triad `X-Agent-Service-Id` + `X-Agent-Service-Key` + `X-Agent-App` is required.

## Migration 0.2 -> next major

Main breaking changes:

- removed token/instance token provisioning flow;
- removed runtime function registration via `createFunctionHandle`;
- removed use of legacy `AgentBridge` class.

New flow:

1. configure functions in `agent-bridge.config.ts`;
2. strict auth via `X-Agent-Service-Id` + `X-Agent-Service-Key` + `X-Agent-App`;
3. batch policy via component mutations;
4. centralized logs in `agentLogs`.

## Local development

```sh
npm i
npm run dev
```
