# Migration Guide: v0.2 -> Config-First Major

Questo documento e pensato per essere letto anche da agenti automatici (es. OpenClaw) per aggiornare una skill legacy che usa `@okrlinkhub/agent-bridge`.

## Executive Summary

La nuova major elimina il flusso legacy basato su:

- provisioning token (`/agent-bridge/provision`)
- instance token (`instanceToken`)
- registrazione runtime via `createFunctionHandle` + `registerFunction(s)`
- classe client `AgentBridge` (legacy workflow)

e introduce un flusso **config-first**:

- file `agent-bridge.config.ts` con funzioni esposte;
- endpoint `POST /agent/execute` con header `X-Agent-API-Key`;
- permessi/override in batch via mutation del componente;
- log in `agentLogs`.

## Mapping veloce vecchio -> nuovo

| Legacy | Nuovo |
|---|---|
| `POST /agent-bridge/provision` | rimosso |
| `instanceToken` | `X-Agent-API-Key` |
| `POST /agent-bridge/execute` | `POST /agent/execute` |
| `GET /agent-bridge/health` | rimosso |
| runtime `registerFunction` | config statica `agent-bridge.config.ts` |
| `functionRegistry` | rimosso |
| `provisioningTokens`, `registeredAgents`, `agentAppInstances` | sostituiti da `agents` |
| `functionPermissions` | sostituita da `agentPermissions` |
| `accessLog` | sostituito da `agentLogs` |
| class `AgentBridge` per setup | `registerRoutes(...)` + mutation component |

## Nuovi artefatti richiesti nel consumer

1. `agent-bridge.config.ts`
2. `convex/agentBridge.ts` (route registration helper)
3. route montate in `convex/http.ts`
4. policy admin via mutation:
   - `components.agentBridge.agents.createAgent`
   - `components.agentBridge.permissions.setAgentPermissions`
   - `components.agentBridge.permissions.setFunctionOverrides`

## Nuovo file di config (shape)

```ts
import { api } from "./convex/_generated/api";
import { defineAgentBridgeConfig } from "@okrlinkhub/agent-bridge";

export default defineAgentBridgeConfig({
  functions: {
    "cart.calculatePrice": { ref: api.cart.calculatePrice, type: "query" },
    "cart.applyDiscount": { ref: api.cart.applyDiscount, type: "mutation" },
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

## Endpoint contract nuovo

### `POST /agent/execute`

Header:

- `X-Agent-API-Key: <plaintext-api-key>`

Body:

```json
{
  "functionKey": "cart.calculatePrice",
  "args": {}
}
```

Response:

- success: `{ "success": true, "result": ... }`
- error: `{ "success": false, "error": "..." }`

Status tipici: `401`, `403`, `404`, `429`, `500`.

## Aggiornamento skill OpenClaw (checklist)

Aggiorna la skill/automazione in modo che:

1. non usi piu `provision` e `instanceToken`;
2. passi sempre la API key in header `X-Agent-API-Key`;
3. usi `functionKey` (non `functionName`);
4. mantenga una mappa interna delle funzioni da `agent-bridge.config.ts`;
5. interpreti `429` e `Retry-After` con backoff;
6. tratti `403` come policy failure (non retry immediato);
7. non provi a registrare funzioni runtime.

## Regole operative consigliate per l’agente

- Validare prima che `functionKey` sia tra quelle esposte.
- In caso di `404`, ricontrollare key e versione config.
- In caso di `429`, applicare retry dopo `Retry-After`.
- Non loggare mai la API key in chiaro.

## API key lifecycle consigliato

- Generazione: random crittografico (32+ byte).
- Storage lato bridge: hash SHA-256 (gia implementato).
- Storage lato agente: secret store (non repository, non log).
- Rotazione: periodica o immediata in caso di leak.

## Comando init

```sh
npx @okrlinkhub/agent-bridge init
```

Genera i template minimi per partire col nuovo flusso.
