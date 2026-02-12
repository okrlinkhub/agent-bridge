# Convex Agent Bridge (Config-First)

[![npm version](https://badge.fury.io/js/@okrlinkhub%2Fagent-bridge.svg)](https://badge.fury.io/js/@okrlinkhub%2Fagent-bridge)

`@okrlinkhub/agent-bridge` espone un gateway HTTP per agenti esterni con approccio **config-first**:

- dichiari le funzioni Convex esposte in un solo file;
- configuri i permessi in batch solo su quelle funzioni;
- non modifichi query/mutation/action Convex esistenti.

## Installazione

```sh
npm install @okrlinkhub/agent-bridge
```

## Setup rapido

### 1) Inizializza i file nel consumer

```sh
npx @okrlinkhub/agent-bridge init
```

Questo genera:

- `agent-bridge.config.ts`
- `convex/agentBridge.ts`

### 2) Abilita il componente in `convex/convex.config.ts`

```ts
import { defineApp } from "convex/server";
import agentBridge from "@okrlinkhub/agent-bridge/convex.config.js";

const app = defineApp();
app.use(agentBridge);
export default app;
```

### 3) Monta le route in `convex/http.ts`

```ts
import { httpRouter } from "convex/server";
import { registerAgentBridgeRoutes } from "./agentBridge";

const http = httpRouter();
registerAgentBridgeRoutes(http);
export default http;
```

Configura auth strict multi-service in `registerRoutes`:

```ts
registerRoutes(http, components.agentBridge, bridgeConfig, {
  pathPrefix: "/agent",
  serviceKeysEnvVar: "AGENT_BRIDGE_SERVICE_KEYS_JSON",
  linkingMode: "component_api_only",
});
```

`linkingMode: "component_api_only"` e il default e mantiene il linking su API Convex del componente (niente endpoint HTTP di linking esposti dal bridge).

### 4) Configura funzioni esposte in `agent-bridge.config.ts`

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
      description: "Calcola prezzo totale",
      riskLevel: "low",
      category: "commerce",
    },
  },
});
```

## Endpoint HTTP esposti

- `POST /agent/execute`
- `GET /agent/functions`

### `POST /agent/execute`

Header richiesti (strict-only):

- `X-Agent-Service-Id: <service-id>`
- `X-Agent-Service-Key: <service-key>`
- `X-Agent-App: <app-key>` (es. `crm`, `billing`)

Header opzionale per contesto utente Convex:

- `Authorization: Bearer <user-jwt>`

Header opzionali per audit linking (hashati nel log bridge):

- `X-Agent-Link-Provider`
- `X-Agent-Link-Provider-User-Id`
- `X-Agent-Link-User-Subject`
- `X-Agent-Link-Status`

Quando usarlo:

- Se la funzione target usa `ctx.auth.getUserIdentity()`, invia sempre `Authorization`.
- Se la funzione e service-only, `Authorization` puo essere omesso.

Body richiesto:

```json
{
  "functionKey": "cart.calculatePrice",
  "args": { "cartId": "..." }
}
```

Risposta:

- successo: `{ "success": true, "result": ... }`
- errore: `{ "success": false, "error": "..." }`

Codici principali: `401`, `403`, `404`, `429`, `500`.

## User context cross-app (best practice)

Per usare Agent Bridge in app Convex con stack auth diversi, mantieni questo contratto:

1. **Service auth** (sempre): `X-Agent-Service-Id`, `X-Agent-Service-Key`, `X-Agent-App`
2. **User auth** (quando serve): `Authorization: Bearer <user-jwt>`

Token source comuni:

- `nextauth_convex`: leggi `session.convexToken` lato server
- `auth0`: usa access token Auth0 valido per Convex
- `custom_oidc`: usa token OIDC del provider dell'app

Il package include helper riusabili:

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

Esempio rapido:

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

Note:

- `validateJwtClaims` controlla solo claim (`exp`, `iss`, `aud`) e non sostituisce la validazione crittografica di Convex.
- Non loggare mai token utente o service key.

## Setup OpenClaw multi-app (semplice su Railway)

Per piu istanze OpenClaw che gestiscono piu applicativi:

1. In Convex imposta:
   - `AGENT_BRIDGE_SERVICE_KEYS_JSON={"openclaw-prod":"<key>","openclaw-staging":"<key>"}`
   - `AGENT_BRIDGE_AUDIT_HASH_SALT="<random-long-secret>"` (raccomandata per hashing audit)
2. In Convex registra un agente per app con `appKey` univoco:
   - `crm`, `billing`, `warehouse`, ecc.
3. OpenClaw invia per ogni chiamata:
   - `X-Agent-Service-Id` (identita istanza)
   - `X-Agent-Service-Key` (chiave della specifica istanza)
   - `X-Agent-App` (varia per app target)

### Routing URL multi-app (appKey -> baseUrl)

Quando OpenClaw deve chiamare piu consumer app-side (es. endpoint `execute-on-behalf`), usa la mappa:

- `APP_BASE_URL_MAP_JSON={"crm":"https://crm.example.com","billing":"https://billing.example.com"}`

Helper disponibili nel package:

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

Policy: nessun fallback a `APP_BASE_URL` legacy. Se `appKey` non e presente in mappa, il flusso deve fallire esplicitamente.

## Matrice variabili ambiente (Convex vs Vercel vs Railway)

Questa e la parte piu soggetta a errori: le variabili con nome simile non vanno tutte nello stesso posto.

Nota importante:
- In questo package sono lette direttamente solo: `AGENT_BRIDGE_SERVICE_KEYS_JSON`, `AGENT_BRIDGE_AUDIT_HASH_SALT`, `APP_BASE_URL_MAP_JSON`.
- Le variabili `OPENCLAW_*`, `PUBLISHED_SITE_URL`, `AGENT_BRIDGE_BASE_URL` appartengono al flusso di integrazione (OpenClaw + frontend/BFF), non al runtime interno del package.

### A) Variabili in Convex (deployment app consumer)

Dove impostarle:
- Convex Dashboard -> Project Settings -> Environment Variables (sia dev che prod, con valori coerenti per ambiente).

Variabili:
- `AGENT_BRIDGE_SERVICE_KEYS_JSON` (**obbligatoria**): mappa JSON `serviceId -> serviceKey`.
  - Esempio: `{"openclaw-prod":"abs_live_...","openclaw-staging":"abs_live_..."}`
  - Deve contenere la coppia usata da OpenClaw (`OPENCLAW_SERVICE_ID` / `OPENCLAW_SERVICE_KEY`).
- `AGENT_BRIDGE_AUDIT_HASH_SALT` (**fortemente raccomandata**): segreto lungo usato per hash nei log audit del bridge.
- `OPENCLAW_LINKING_SHARED_SECRET` (**obbligatoria se usi i flussi linking cross-service**): segreto condiviso da mantenere identico anche dove fai validazione linking lato app/OpenClaw.
- `PUBLISHED_SITE_URL` (**consigliata**): URL pubblico canonico del sito/app consumer, utile nei flussi che richiedono URL assoluti (es. redirect/callback/linking UX).

### B) Variabili in Vercel (frontend / BFF deployato su Vercel)

Dove impostarle:
- Vercel -> Project -> Settings -> Environment Variables.
- Impostale almeno in `Production` e `Preview` (e `Development` se usi env cloud in locale).

Variabili:
- `APP_BASE_URL_MAP_JSON` (**obbligatoria**): mappa `appKey -> baseUrl` per routing multi-app.
- `OPENCLAW_SERVICE_ID` (**obbligatoria**): id servizio usato negli header strict.
- `OPENCLAW_SERVICE_KEY` (**obbligatoria**): chiave servizio associata all'id sopra.
- `OPENCLAW_LINKING_SHARED_SECRET` (**obbligatoria se linking attivo**): deve essere identica a Convex/Railway.
- `AGENT_BRIDGE_BASE_URL` (**obbligatoria nel BFF che invoca il bridge**): base URL del bridge/endpoint applicativo usato dalle chiamate server-side.

### C) Variabili in Railway (agente OpenClaw deployato su Railway)

Dove impostarle:
- Railway -> Service -> Variables (servizio OpenClaw/Gateway).

Variabili:
- `APP_BASE_URL_MAP_JSON` (**obbligatoria**): stessa semantica della mappa usata lato Vercel.
- `OPENCLAW_LINKING_SHARED_SECRET` (**obbligatoria se linking attivo**): stesso valore di Convex/Vercel.
- `OPENCLAW_SERVICE_ID` (**obbligatoria**)
- `OPENCLAW_SERVICE_KEY` (**obbligatoria**)
- `OPENCLAW_GATEWAY_TRUSTED_PROXIES=127.0.0.1` (**essenziale su Railway**, anche se non e una variabile del bridge): necessaria per corretta gestione proxy/header nel gateway.

### Regole di consistenza (checklist anti-errori)

- `OPENCLAW_SERVICE_ID` e `OPENCLAW_SERVICE_KEY` devono combaciare con una entry in `AGENT_BRIDGE_SERVICE_KEYS_JSON` su Convex.
- `OPENCLAW_LINKING_SHARED_SECRET` deve essere identico in tutti i componenti che partecipano al linking.
- `APP_BASE_URL_MAP_JSON` deve avere le stesse `appKey` usate in `X-Agent-App` e nelle route map.
- Nessun fallback a `APP_BASE_URL` singola: se `appKey` non e mappata, fallire esplicitamente.
- Non loggare mai segreti (`OPENCLAW_SERVICE_KEY`, shared secret, bearer token).

Puoi generare una service key con l'helper del package:

```ts
import { generateAgentBridgeServiceKey } from "@okrlinkhub/agent-bridge";

const serviceKey = generateAgentBridgeServiceKey(); // es: abs_live_<random>
```

Vantaggi:
- controllo e debugging centralizzati nel bridge Convex;
- nessun invio multiplo di API key nelle request;
- rotazione e policy per app gestite nel bridge.

## Gestione agenti e permessi

Mutation/query del componente disponibili in `components.agentBridge`:

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

### Link Registry nel componente (per-app)

Il registro link utente e persistito nel DB Convex del componente:

- chiave logica: `provider + providerUserId + appKey`
- target: `appUserSubject`
- stato: `active | revoked | expired`

In questo modo ogni app che installa il componente mantiene il proprio registry nel proprio deployment Convex, senza un database centralizzato cross-app.

### Esempio permessi batch

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

## Breaking change strict-only

Da questa versione:
- `X-Agent-API-Key` non e piu supportato nel runtime HTTP;
- non esiste fallback single-key;
- e obbligatoria la triade `X-Agent-Service-Id` + `X-Agent-Service-Key` + `X-Agent-App`.

## Migrazione 0.2 -> next major

Breaking changes principali:

- rimosso il flusso provisioning token/instance token;
- rimossa la registrazione runtime delle funzioni via `createFunctionHandle`;
- rimosso l’uso della classe `AgentBridge` legacy.

Nuovo flusso:

1. config funzioni in `agent-bridge.config.ts`;
2. auth strict via `X-Agent-Service-Id + X-Agent-Service-Key + X-Agent-App`;
3. policy in batch via mutation del componente;
4. log centralizzato in `agentLogs`.

## Sviluppo locale

```sh
npm i
npm run dev
```
