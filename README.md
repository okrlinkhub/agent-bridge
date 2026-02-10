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

Se vuoi usare il flusso multi-app gestito dal bridge, passa anche la service key:

```ts
registerRoutes(http, components.agentBridge, bridgeConfig, {
  pathPrefix: "/agent",
  serviceKey:
    (globalThis as { process?: { env?: Record<string, string> } }).process?.env
      ?.AGENT_BRIDGE_SERVICE_KEY,
});
```

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

Header richiesti (una delle due modalita):

- Legacy:
  - `X-Agent-API-Key: <api-key>`
- Service-to-bridge (consigliato per OpenClaw multi-app):
  - `X-Agent-Service-Key: <shared-service-secret>`
  - `X-Agent-App: <app-key>` (es. `crm`, `billing`)

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

## Setup OpenClaw multi-app (semplice su Railway)

Per un solo servizio OpenClaw che gestisce piu applicativi:

1. In Railway imposta solo:
   - `AGENT_BRIDGE_SERVICE_KEY=<secret-unico>`
2. In Convex registra un agente per app con `appKey` univoco:
   - `crm`, `billing`, `warehouse`, ecc.
3. OpenClaw invia per ogni chiamata:
   - `X-Agent-Service-Key` (sempre uguale)
   - `X-Agent-App` (varia per app target)

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

## Migrazione 0.2 -> next major

Breaking changes principali:

- rimosso il flusso provisioning token/instance token;
- rimossa la registrazione runtime delle funzioni via `createFunctionHandle`;
- rimosso l’uso della classe `AgentBridge` legacy.

Nuovo flusso:

1. config funzioni in `agent-bridge.config.ts`;
2. auth via `X-Agent-API-Key` (legacy) oppure `X-Agent-Service-Key + X-Agent-App` (multi-app);
3. policy in batch via mutation del componente;
4. log centralizzato in `agentLogs`.

## Sviluppo locale

```sh
npm i
npm run dev
```
