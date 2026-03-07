# Installazione agent-bridge — Guida per LLM

Documento numerato e strutturato per l'installazione di `@okrlinkhub/agent-bridge` come componente. Ogni passaggio è atomico e indicizza dove inserire le variabili d'ambiente.

---

## PARTE 1: Installazione e setup iniziale

### 1.1 Installare il pacchetto

```sh
npm install @okrlinkhub/agent-bridge
```

### 1.2 Inizializzare i file nel progetto consumer

```sh
npx @okrlinkhub/agent-bridge init
```

Questo crea:
- `agent-bridge.config.ts` (root del progetto)
- `convex/agentBridge.ts`

### 1.3 Abilitare il componente in Convex

File: `convex/convex.config.ts`

```ts
import { defineApp } from "convex/server";
import agentBridge from "@okrlinkhub/agent-bridge/convex.config.js";

const app = defineApp();
app.use(agentBridge);
export default app;
```

### 1.4 Montare le route HTTP

File: `convex/http.ts`

```ts
import { httpRouter } from "convex/server";
import { registerAgentBridgeRoutes } from "./agentBridge";

const http = httpRouter();
registerAgentBridgeRoutes(http);
export default http;
```

### 1.5 Configurare le funzioni esposte

File: `agent-bridge.config.ts`

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

---

## PARTE 2: Variabili d'ambiente — Source of truth

**Unica source of truth:** file `.env.local` nella root del progetto.

Inserisci tutte le variabili in `.env.local`. Per il deployment, sincronizza le variabili rilevanti su Convex, Vercel e Fly.io secondo la matrice sotto.

### 2.1 Matrice di sincronizzazione (da .env.local verso le piattaforme)

| Variabile | Convex | Vercel | Fly.io |
|-----------|--------|--------|--------|

Solo su Convex:
| AGENT_BRIDGE_SERVICE_KEYS_JSON | SÌ | — | — |
| AGENT_BRIDGE_AUDIT_HASH_SALT | SÌ | — | — |
| PUBLISHED_SITE_URL | SÌ | — | — |

Solo su Vercel:
| AGENT_BRIDGE_BASE_URL | — | SÌ | — |

Sia su Vercel che Fly.io:
| APP_BASE_URL_MAP_JSON | — | SÌ | SÌ |
| OPENCLAW_SERVICE_ID | — | SÌ | SÌ |
| OPENCLAW_SERVICE_KEY | — | SÌ | SÌ |

---

## PARTE 3: Variabili in Convex

**Dove impostarle:** Convex Dashboard → Project Settings → Environment Variables. Sincronizzare da `.env.local` le variabili indicate in 2.1.

### 3.1 AGENT_BRIDGE_SERVICE_KEYS_JSON (obbligatoria)

#### Da dove vengono service_id e service_key?

- **service_id:** lo scegli tu. È un identificatore leggibile per l’istanza del servizio che chiama il bridge (es. `openclaw-prod`, `openclaw-staging`, `my-agent`).
- **service_key:** la generi con l’helper del package. È un segreto crittografico (formato `abs_live_<random>`).

**Flusso:**

1. Scegli un `service_id` (es. `openclaw-prod`).
2. Genera la `service_key` con uno dei metodi sotto.
3. Inserisci la coppia in `AGENT_BRIDGE_SERVICE_KEYS_JSON` su Convex.
4. Usa lo stesso `service_id` e `service_key` in `OPENCLAW_SERVICE_ID` e `OPENCLAW_SERVICE_KEY` su Vercel/Fly.io.

#### Come generare la service_key

**Da Node.js (richiede `npm install @okrlinkhub/agent-bridge`):** dopo aver installato il componente, apri il terminale sul progetto e digita da node -e...

```sh
node -e "import('@okrlinkhub/agent-bridge').then(m => console.log(m.generateAgentBridgeServiceKey()))"
```

#### Formato della variabile

- **Tipo:** JSON string
- **Formato:** `{"<service-id>":"<service-key>","<service-id2>":"<service-key2>"}`
- **Esempio:** `{"openclaw-prod":"abs_live_abc123xyz","openclaw-staging":"abs_live_def456uvw"}`

#### Come creare la variabile nel Convex Dashboard

1. Vai su [dashboard.convex.dev](https://dashboard.convex.dev).
2. Seleziona il progetto dell’app consumer.
3. Menu laterale → **Settings** → **Environment Variables**.
4. Clicca **Add Environment Variable**.
5. **Name:** `AGENT_BRIDGE_SERVICE_KEYS_JSON`
6. **Value:** il JSON (es. `{"openclaw-prod":"abs_live_xxx"}`). Attenzione: nessuno spazio superfluo, virgolette doppie.
7. Fallo sia per gli ambienti: **Development** che **Production**.
8. Clicca **Save**.

**Nota:** `OPENCLAW_SERVICE_ID` e `OPENCLAW_SERVICE_KEY` usati da OpenClaw/Vercel devono corrispondere a una entry in questa mappa.

---

### 3.2 AGENT_BRIDGE_AUDIT_HASH_SALT (fortemente raccomandata)

- **Tipo:** string (segreto lungo, 32+ caratteri)
- **Uso:** salt per hash nei log audit del bridge (es. identificatori utente). Non usare valori prevedibili.

#### Come generare AGENT_BRIDGE_AUDIT_HASH_SALT

**Opzione A — OpenSSL (consigliata):**

```sh
openssl rand -base64 32
```

**Opzione B — Node.js:**

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Opzione C — Node.js (hex):**

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

#### Come creare la variabile nel Convex Dashboard

1. Vai su **Settings** → **Environment Variables**.
2. **Add Environment Variable**.
3. **Name:** `AGENT_BRIDGE_AUDIT_HASH_SALT`
4. **Value:** la stringa generata (es. `K7x2mN9pQ4vR8sT1wY3zA6bC0dE5fG2hI=`).
5. Seleziona **Development** e **Production**.
6. **Save**.

### 3.3 PUBLISHED_SITE_URL (consigliata)

- **Tipo:** URL assoluto
- **Esempio:** `https://app.example.com`
- **Uso:** URL canonico del sito per redirect/callback/linking UX
- **Convex Dashboard:** come in 3.1, variabile `PUBLISHED_SITE_URL` con l’URL pubblico dell’app.

---

## PARTE 4: Variabili in Vercel

**Dove impostarle:** Vercel → Project → Settings → Environment Variables. Sincronizzare da `.env.local` le variabili indicate in 2.1.

### 4.1 APP_BASE_URL_MAP_JSON (obbligatoria)

- **Tipo:** JSON string
- **Formato:** `{"<appKey>":"<baseUrl>","<appKey2>":"<baseUrl2>"}`
- **Esempio:** `{"crm":"https://crm.example.com","billing":"https://billing.example.com"}`
- **Regola:** le `appKey` devono coincidere con `X-Agent-App` nelle richieste, quindi devono essere inserite in agentBridge.agents.appKey nel database per ogni agente creato.

### 4.2 OPENCLAW_SERVICE_ID (obbligatoria, vedi 3.1.)

- **Tipo:** string
- **Esempio:** `openclaw-prod`
- **Regola:** deve esistere come chiave in `AGENT_BRIDGE_SERVICE_KEYS_JSON` su Convex.

### 4.3 OPENCLAW_SERVICE_KEY (obbligatoria, vedi 3.1.)

- **Tipo:** string (segreto)
- **Esempio:** `abs_live_xxx`
- **Regola:** deve essere il valore associato a `OPENCLAW_SERVICE_ID` in `AGENT_BRIDGE_SERVICE_KEYS_JSON`.

### 4.4 AGENT_BRIDGE_BASE_URL (obbligatoria nel BFF che invoca il bridge)

- **Tipo:** URL base
- **Esempio:** `https://your-convex-deployment.convex.site`
- **Uso:** base URL usata dalle chiamate server-side verso il bridge.

---

## PARTE 5: .env.local — Elenco completo (source of truth)

Crea il file `.env.local` nella root del progetto e inserisci tutte le variabili. Da qui sincronizzerai su Convex, Vercel e Fly.io secondo la matrice in 2.1.

```env
# Convex (sincronizzare su Convex Dashboard)
AGENT_BRIDGE_SERVICE_KEYS_JSON={"openclaw-prod":"abs_live_xxx","openclaw-staging":"abs_live_yyy"}
AGENT_BRIDGE_AUDIT_HASH_SALT=<random-32-chars>
PUBLISHED_SITE_URL=https://app.example.com

# Vercel / Fly.io (sincronizzare su entrambe le piattaforme)
APP_BASE_URL_MAP_JSON={"crm":"https://crm.example.com","billing":"https://billing.example.com"}
OPENCLAW_SERVICE_ID=openclaw-prod
OPENCLAW_SERVICE_KEY=abs_live_xxx

# Solo Vercel (BFF che invoca il bridge)
AGENT_BRIDGE_BASE_URL=https://your-deployment.convex.site

```

---

## PARTE 6: Variabili in Fly.io (agente OpenClaw)

**Dove impostarle:** Fly.io → App → Secrets (o `fly secrets set KEY=value`). Sincronizzare da `.env.local` le variabili indicate in 2.1.

### 6.1 APP_BASE_URL_MAP_JSON (obbligatoria)

- Stessa semantica di Vercel (vedi 4.1).

### 6.2 OPENCLAW_SERVICE_ID (obbligatoria)

- Vedi 4.2.

### 6.3 OPENCLAW_SERVICE_KEY (obbligatoria)

- Vedi 4.3.

---

## PARTE 7: Checklist di consistenza

### 7.1 Regole obbligatorie

1. `OPENCLAW_SERVICE_ID` + `OPENCLAW_SERVICE_KEY` devono corrispondere a una entry in `AGENT_BRIDGE_SERVICE_KEYS_JSON` (Convex).
2. Le `appKey` in `APP_BASE_URL_MAP_JSON` devono coincidere con `X-Agent-App` nelle richieste, quindi nel database effettivo.
3. Non usare fallback a `APP_BASE_URL` singola: se `appKey` non è mappata, fallire esplicitamente.
4. Non loggare mai: `OPENCLAW_SERVICE_KEY`, bearer token.

### 7.2 Generazione service key

Vedi 3.1 per il flusso completo e i comandi (Node.js, OpenSSL, ecc.).

---

## PARTE 8: Configurazione opzionale di registerRoutes

Se serve personalizzare il path o le variabili env:

File: `convex/agentBridge.ts`

```ts
import { registerRoutes } from "@okrlinkhub/agent-bridge";
import { components } from "./_generated/api";
import config from "../agent-bridge.config";

export function registerAgentBridgeRoutes(
  http: Parameters<typeof registerRoutes>[0],
) {
  registerRoutes(http, components.agentBridge, config, {
    pathPrefix: "/agent",
    serviceKeysEnvVar: "AGENT_BRIDGE_SERVICE_KEYS_JSON",
    linkingMode: "component_api_only",
  });
}
```

- `pathPrefix`: prefisso delle route (default `/agent`).
- `serviceKeysEnvVar`: nome della variabile Convex per le service keys (default `AGENT_BRIDGE_SERVICE_KEYS_JSON`).
- `linkingMode: "component_api_only"`: nessun endpoint HTTP di linking esposto dal bridge.

---

## PARTE 9: Endpoint HTTP esposti

Dopo il setup, il bridge espone:

- `POST /agent/execute` — esecuzione funzione
- `GET /agent/functions` — elenco funzioni disponibili

Header richiesti per `POST /agent/execute`:
- `X-Agent-Service-Id`
- `X-Agent-Service-Key`
- `X-Agent-App`

---

## PARTE 10: Flusso di decisione per LLM

Quando un LLM deve configurare l'agent-bridge:

1. **Passo 1:** Eseguire 1.1–1.5 (installazione e setup file).
2. **Passo 2:** Creare `.env.local` con tutte le variabili (PARTE 5) — unica source of truth.
3. **Passo 3:** Sincronizzare su ogni piattaforma secondo la matrice 2.1:
   - Convex → PARTE 3
   - Vercel → PARTE 4
   - Fly.io (OpenClaw) → PARTE 6
4. **Passo 4:** Verificare la checklist in PARTE 7.
