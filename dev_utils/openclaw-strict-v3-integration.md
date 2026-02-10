# OpenClaw Integration Guide (Strict v3)

Questo documento descrive come integrare OpenClaw con `@okrlinkhub/agent-bridge@3.x` in modalita strict-only.

## Protocollo richiesto (obbligatorio)

Endpoint:

- `POST {AGENT_BRIDGE_BASE_URL}/agent/execute`

Header obbligatori:

- `Content-Type: application/json`
- `X-Agent-Service-Id: <service-id>`
- `X-Agent-Service-Key: <service-key>`
- `X-Agent-App: <app-key>`

Header opzionale (richiesto per funzioni user-scoped):

- `Authorization: Bearer <user-jwt>`

Header non supportati:

- `X-Agent-API-Key`

## Variabili ambiente OpenClaw consigliate

- `AGENT_BRIDGE_BASE_URL=https://<your-convex-site>`
- `OPENCLAW_SERVICE_ID=openclaw-prod`
- `OPENCLAW_SERVICE_KEY=<service-key-associata-al-service-id>`
- `AGENT_BRIDGE_DEFAULT_APP_KEY=crm` (opzionale)
- `AGENT_BRIDGE_ROUTE_MAP_JSON=<json route-map>`

Esempio `AGENT_BRIDGE_ROUTE_MAP_JSON`:

```json
{
  "exact": {
    "billing.generateInvoice": "billing",
    "crm.createLead": "crm"
  },
  "prefix": {
    "billing.": "billing",
    "crm.": "crm",
    "warehouse.": "warehouse"
  }
}
```

## Contratto body request

```json
{
  "functionKey": "<string>",
  "args": {},
  "estimatedCost": 0
}
```

`estimatedCost` e opzionale.

## Regola universale service + user auth

Usa sempre questa matrice:

- Funzioni **service-only**: header strict sufficienti
- Funzioni che leggono `ctx.auth.getUserIdentity()`: header strict + `Authorization`

Senza `Authorization`, le funzioni user-scoped possono restituire empty/unauthorized.

## Snippet TypeScript pronto

```ts
type RouteMap = {
  exact?: Record<string, string>;
  prefix?: Record<string, string>;
};

function resolveAppKey(
  functionKey: string,
  routeMap: RouteMap,
  defaultApp?: string,
): string {
  const exact = routeMap.exact ?? {};
  if (exact[functionKey]) {
    return exact[functionKey];
  }

  const prefixEntries = Object.entries(routeMap.prefix ?? {}).sort(
    (a, b) => b[0].length - a[0].length,
  );
  for (const [prefix, appKey] of prefixEntries) {
    if (functionKey.startsWith(prefix)) {
      return appKey;
    }
  }

  if (defaultApp) {
    return defaultApp;
  }

  throw new Error(`Cannot resolve appKey for functionKey: ${functionKey}`);
}

export async function callAgentBridge(input: {
  functionKey: string;
  args?: Record<string, unknown>;
  estimatedCost?: number;
  userToken?: string | null;
}) {
  const baseUrl = process.env.AGENT_BRIDGE_BASE_URL;
  const serviceId = process.env.OPENCLAW_SERVICE_ID;
  const serviceKey = process.env.OPENCLAW_SERVICE_KEY;
  const defaultApp = process.env.AGENT_BRIDGE_DEFAULT_APP_KEY;
  const routeMapRaw = process.env.AGENT_BRIDGE_ROUTE_MAP_JSON ?? "{}";

  if (!baseUrl || !serviceId || !serviceKey) {
    throw new Error("Missing required bridge env vars");
  }

  const routeMap = JSON.parse(routeMapRaw) as RouteMap;
  const appKey = resolveAppKey(input.functionKey, routeMap, defaultApp);

  const response = await fetch(`${baseUrl}/agent/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Service-Id": serviceId,
      "X-Agent-Service-Key": serviceKey,
      "X-Agent-App": appKey,
      ...(input.userToken
        ? { Authorization: `Bearer ${input.userToken}` }
        : {}),
    },
    body: JSON.stringify({
      functionKey: input.functionKey,
      args: input.args ?? {},
      estimatedCost: input.estimatedCost,
    }),
  });

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("Retry-After") ?? "1");
    throw new Error(`Rate limited. Retry after ${retryAfter}s`);
  }

  const data = await response.json();
  if (!response.ok || !data?.success) {
    throw new Error(data?.error ?? `Bridge error (${response.status})`);
  }

  return data.result;
}
```

## Token source adapters (cross-app)

Per rendere il flusso riusabile tra stack diversi:

```ts
import {
  createNextAuthConvexTokenAdapter,
  createAuth0TokenAdapter,
  createCustomOidcTokenAdapter,
  resolveUserToken,
  validateJwtClaims,
} from "@okrlinkhub/agent-bridge";

// NextAuth + Convex JWT bridge
const nextAuthAdapter = createNextAuthConvexTokenAdapter({
  getSession: async () => session,
});

// Auth0
const auth0Adapter = createAuth0TokenAdapter({
  getAccessToken: async () => getAccessTokenSilently(),
});

// Custom OIDC
const customAdapter = createCustomOidcTokenAdapter({
  getToken: async () => myOidcClient.getToken(),
});

const userToken = await resolveUserToken(nextAuthAdapter);
const validation = userToken
  ? validateJwtClaims(userToken, { expectedAudience: "convex" })
  : { valid: false };
```

## Error handling minimo consigliato

- `400`: header mancanti o payload invalido
- `401`: `service-id` non riconosciuto o `service-key` errata
- `403`: policy/permessi negati per app/funzione
- `404`: app non registrata o `functionKey` non esposta
- `429`: rate limit, rispettare `Retry-After`
- `500`: errore interno bridge

## Sicurezza operativa

- Non loggare mai `OPENCLAW_SERVICE_KEY`.
- Non loggare mai bearer token utente.
- Non inviare mai `X-Agent-API-Key`.
- Eseguire validazioni minime claim (`exp`, `iss`, `aud`) prima del forward.
- In caso di rotazione, aggiornare in modo atomico:
  1) configurazione bridge (mappa service keys),
  2) env della specifica istanza OpenClaw.
