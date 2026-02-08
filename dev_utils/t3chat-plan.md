Ecco la documentazione tecnica finale riscritta con le tre modifiche richieste: **A2A intra-app** (canali tematici), **onboarding distribuito** (non centralizzato), e **Circuit Breaker dinamico basato su permissions** (senza modificare ogni singola API manualmente).

---

# Agent Bridge Component - Documentazione Tecnica v2
## Controllo Distribuito Agenti OpenClaw con Permessi Granulari

### 1. Visione Architetturale

**Problema**: Gli agenti LLM individuali rischiano di diventare silos o sovraccaricare le API. Inoltre, non possiamo modificare centinaia di endpoint esistenti per aggiungere autenticazione.

**Soluzione**: Un componente Convex che funge da **Security Gateway** dinamico:
1. **Onboarding Distribuito**: L'IT genera un "Agent Provisioning Token" (APT) che il dipendente usa per auto-registrarsi su qualsiasi app LinkHub
2. **Permissions Dinamiche**: Una tabella centrale definisce quali functions (query/mutation) ogni agente può chiamare su ogni app (`allow`/`deny`/`rate_limited`)
3. **A2A Tematico**: Gli agenti comunicano solo all'interno della stessa app su **canali tematici** (es. "okr-discussion", "hr-help"), evitando la complessità cross-app
4. **Wrapper Automatico**: Tutte le chiamate passano attraverso un gateway che applica i permessi senza modificare il codice business esistente

**Governance Distribuita**:
- L'IT controlla il "who" (chi può provisioningarsi) tramite APT e il "what" (cosa può fare) tramite permissions table
- Il dipendente controlla il "where" (su quale app si registra) e il "when" (deploy della propria istanza Railway)
- Costi LLM: Subscription Kimi K2.5 personale (Basic/Moderato/Alto) con auto-sospensione al termine crediti

---

### 2. Schema Database (Componente)

```typescript
// convex/components/agentBridge/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Provisioning Tokens (generati dall'IT, distribuiti ai dipendenti)
  provisioningTokens: defineTable({
    tokenHash: v.string(), // bcrypt hash dell'APT (es. "apt_live_xxx")
    employeeEmail: v.string(),
    department: v.string(),
    maxApps: v.number(), // Quante app può registrare (default 5)
    usedCount: v.number(),
    expiresAt: v.number(), // Scadenza token (es. 7 giorni)
    isActive: v.boolean(),
    createdBy: v.string(), // Email admin IT
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_email", ["employeeEmail"]),

  // Agenti registrati (creati al primo uso su una app)
  registeredAgents: defineTable({
    agentId: v.string(), // UUID univoco generato al primo provisioning
    employeeEmail: v.string(),
    department: v.string(),
    firstRegisteredAt: v.number(),
    lastSeenAt: v.number(),
    isActive: v.boolean(),
    revokedAt: v.optional(v.number()),
    revokedBy: v.optional(v.string()),
  })
    .index("by_agent_id", ["agentId"])
    .index("by_email", ["employeeEmail"]),

  // Istanze specifiche Railway (una per app per agente)
  agentAppInstances: defineTable({
    agentId: v.string(),
    appName: v.string(), // "okr", "hr", "incentives"
    instanceToken: v.string(), // JWT sessione (24h)
    railwayProjectId: v.optional(v.string()),
    railwayServiceId: v.optional(v.string()),
    registeredAt: v.number(),
    expiresAt: v.number(),
    lastActivityAt: v.number(),
    monthlyRequests: v.number(), // Contatore per questa app
  })
    .index("by_agent_app", ["agentId", "appName"])
    .index("by_token", ["instanceToken"])
    .index("by_app_activity", ["appName", "lastActivityAt"]),

  // PERMISSIONS DINAMICHE: Chi può fare cosa su quale app
  // Questa tabella controlla l'accesso senza modificare il codice esistente
  functionPermissions: defineTable({
    agentId: v.string(),
    appName: v.string(),
    functionPattern: v.string(), // Es: "okr:*", "okr:createObjective", "*"
    permission: v.union(v.literal("allow"), v.literal("deny"), v.literal("rate_limited")),
    rateLimitConfig: v.optional(v.object({
      requestsPerHour: v.number(),
      tokenBudget: v.number(),
    })),
    createdAt: v.number(),
    createdBy: v.string(),
  })
    .index("by_agent_app", ["agentId", "appName"])
    .index("by_pattern", ["appName", "functionPattern"]),

  // Circuit Breaker perimetrale (per app, per agente)
  circuitCounters: defineTable({
    agentId: v.string(),
    appName: v.string(),
    windowHour: v.string(), // "2026-08-02T14"
    requestCount: v.number(),
    tokenEstimate: v.number(),
    isBlocked: v.boolean(),
    blockedReason: v.optional(v.string()),
  })
    .index("by_agent_app_hour", ["agentId", "appName", "windowHour"])
    .index("by_blocked", ["isBlocked"]),

  // A2A Intra-App (canali tematici)
  // Gli agenti parlano solo all'interno della stessa app su canali specifici
  appChannels: defineTable({
    appName: v.string(),
    channelName: v.string(), // "general", "okr-discussion", "help"
    description: v.optional(v.string()),
    createdAt: v.number(),
    isActive: v.boolean(),
  })
    .index("by_app_channel", ["appName", "channelName"]),

  // Messaggi A2A (intra-app su canali)
  channelMessages: defineTable({
    appName: v.string(),
    channelName: v.string(),
    messageId: v.string(),
    fromAgentId: v.string(),
    payload: v.string(), // JSON
    metadata: v.object({
      priority: v.number(),
      ttl: v.number(),
    }),
    sentAt: v.number(),
    expiresAt: v.number(),
    readBy: v.array(v.string()), // Array di agentId che hanno letto
  })
    .index("by_channel_time", ["appName", "channelName", "sentAt"])
    .index("by_recipient", ["appName", "channelName", "fromAgentId"]),

  // Audit log
  accessLog: defineTable({
    timestamp: v.number(),
    agentId: v.string(),
    appName: v.string(),
    functionCalled: v.string(),
    permission: v.string(), // "allow", "deny", "rate_limited"
    instanceToken: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    durationMs: v.optional(v.number()),
  })
    .index("by_agent_time", ["agentId", "timestamp"])
    .index("by_app_function", ["appName", "functionCalled"]),
});
```

---

### 3. Il Gateway Dinamico (Nucleo del Componente)

Invece di modificare ogni API, esponiamo un **unico endpoint gateway** che smista le chiamate verificando i permessi dinamicamente.

```typescript
// convex/components/agentBridge/gateway.ts
import { httpAction } from "./_generated/server";
import { v } from "convex/values";

// Entry point unico per TUTTE le chiamate agente
export const executeFunction = httpAction(async (ctx, request) => {
  const { instanceToken, functionName, args, estimatedCost } = await request.json();
  
  // 1. Verifica instance
  const instance = await ctx.db.query("agentAppInstances")
    .withIndex("by_token", q => q.eq("instanceToken", instanceToken))
    .unique();
    
  if (!instance || instance.expiresAt < Date.now()) {
    return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401 });
  }

  const { agentId, appName } = instance;

  // 2. Verifica Permissions (pattern matching)
  const permission = await checkPermission(ctx, agentId, appName, functionName);
  
  if (permission.permission === "deny") {
    await logAccess(ctx, { agentId, appName, functionName, permission: "deny", instanceToken });
    return new Response(JSON.stringify({ error: "Function not authorized for this agent" }), { status: 403 });
  }

  // 3. Circuit Breaker
  if (permission.permission === "rate_limited") {
    const allowed = await checkCircuitBreaker(ctx, {
      agentId, 
      appName, 
      estimatedCost: estimatedCost || 100,
      limits: permission.rateLimitConfig
    });
    
    if (!allowed) {
      await logAccess(ctx, { agentId, appName, functionName, permission: "rate_limited", instanceToken, error: "Circuit open" });
      return new Response(JSON.stringify({ error: "Rate limit exceeded for this function" }), { status: 429 });
    }
  }

  // 4. Esecuzione dinamica
  // In Convex non possiamo chiamare function arbitrarie per sicurezza, 
  // quindi usiamo un pattern "action router"
  try {
    const startTime = Date.now();
    
    // Il componente espone un router che le app possono estendere
    // oppure usiamo ctx.runAction con nome dinamico se esposto
    const result = await ctx.runAction(functionName as any, args);
    
    await logAccess(ctx, { 
      agentId, appName, functionName, permission: "allow", 
      instanceToken, durationMs: Date.now() - startTime 
    });

    return new Response(JSON.stringify(result), { status: 200 });
    
  } catch (error: any) {
    await logAccess(ctx, { 
      agentId, appName, functionName, permission: "allow", 
      instanceToken, errorMessage: error.message 
    });
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});

// Verifica permissions con pattern matching (es. "okr:*" matcha "okr:createObjective")
async function checkPermission(ctx: any, agentId: string, appName: string, functionName: string) {
  // Cerca permessi specifici per questo agente su questa app
  const permissions = await ctx.db.query("functionPermissions")
    .withIndex("by_agent_app", q => q.eq("agentId", agentId).eq("appName", appName))
    .collect();

  // Ordina per specificità (più specifico prima)
  const sorted = permissions.sort((a, b) => {
    const specA = a.functionPattern.split("*").length;
    const specB = b.functionPattern.split("*").length;
    return specA - specB;
  });

  // Trova il primo match
  for (const perm of sorted) {
    const regex = new RegExp("^" + perm.functionPattern.replace("*", ".*") + "$");
    if (regex.test(functionName)) {
      return perm;
    }
  }

  // Default: deny se non specificato
  return { permission: "deny" };
}

async function checkCircuitBreaker(ctx: any, { agentId, appName, estimatedCost, limits }: any) {
  const currentHour = new Date().toISOString().slice(0, 13);
  
  let counter = await ctx.db.query("circuitCounters")
    .withIndex("by_agent_app_hour", q => 
      q.eq("agentId", agentId).eq("appName", appName).eq("windowHour", currentHour)
    )
    .unique();

  if (!counter) {
    counter = await ctx.db.insert("circuitCounters", {
      agentId, appName, windowHour: currentHour,
      requestCount: 0, tokenEstimate: 0, isBlocked: false
    });
  }

  if (counter.isBlocked) return false;
  
  const newRequests = counter.requestCount + 1;
  const newTokens = counter.tokenEstimate + estimatedCost;

  if (newRequests > (limits?.requestsPerHour || 100) || 
      newTokens > (limits?.tokenBudget || 50000)) {
    await ctx.db.patch(counter._id, { isBlocked: true, blockedReason: "Limit exceeded" });
    return false;
  }

  await ctx.db.patch(counter._id, {
    requestCount: newRequests,
    tokenEstimate: newTokens
  });
  
  return true;
}
```

---

### 4. A2A Intra-App con Canali Tematici

Gli agenti comunicano solo all'interno della stessa app, su canali specifici.

```typescript
// convex/components/agentBridge/channels.ts
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Creazione canale (fatto dall'app o dall'admin)
export const createChannel = mutation({
  args: {
    appName: v.string(),
    channelName: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Verifica esistenza
    const existing = await ctx.db.query("appChannels")
      .withIndex("by_app_channel", q => q.eq("appName", args.appName).eq("channelName", args.channelName))
      .unique();
      
    if (existing) return existing._id;
    
    return await ctx.db.insert("appChannels", {
      appName: args.appName,
      channelName: args.channelName,
      description: args.description,
      createdAt: Date.now(),
      isActive: true,
    });
  },
});

// Invio messaggio su canale
export const postToChannel = mutation({
  args: {
    instanceToken: v.string(),
    channelName: v.string(),
    payload: v.string(),
    priority: v.optional(v.number()),
    ttlMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const instance = await verifyInstance(ctx, args.instanceToken);
    const appName = process.env.LINKHUB_APP_NAME;
    
    if (!appName) throw new Error("App name not configured");

    // Verifica canale esista
    const channel = await ctx.db.query("appChannels")
      .withIndex("by_app_channel", q => q.eq("appName", appName).eq("channelName", args.channelName))
      .unique();
      
    if (!channel) throw new Error(`Channel ${args.channelName} not found in ${appName}`);

    const ttl = (args.ttlMinutes || 60) * 60 * 1000;
    
    await ctx.db.insert("channelMessages", {
      appName,
      channelName: args.channelName,
      messageId: crypto.randomUUID(),
      fromAgentId: instance.agentId,
      payload: args.payload,
      metadata: {
        priority: args.priority || 5,
        ttl,
      },
      sentAt: Date.now(),
      expiresAt: Date.now() + ttl,
      readBy: [],
    });

    return { success: true };
  },
});

// Lettura messaggi da canale (con cursore)
export const readChannel = query({
  args: {
    instanceToken: v.string(),
    channelName: v.string(),
    limit: v.optional(v.number()),
    after: v.optional(v.number()), // timestamp
  },
  handler: async (ctx, args) => {
    const instance = await verifyInstance(ctx, args.instanceToken);
    const appName = process.env.LINKHUB_APP_NAME;
    
    let q = ctx.db.query("channelMessages")
      .withIndex("by_channel_time", q => 
        q.eq("appName", appName)
          .eq("channelName", args.channelName)
          .gt("sentAt", args.after || 0)
      )
      .filter(q => q.gt(q.field("expiresAt"), Date.now()));

    const messages = await q.order("desc").take(args.limit || 20);
    
    // Marca come letti (in background)
    for (const msg of messages) {
      if (!msg.readBy.includes(instance.agentId)) {
        ctx.scheduler.runAfter(0, "internal:markRead", { 
          messageId: msg._id, 
          agentId: instance.agentId 
        });
      }
    }
    
    return messages;
  },
});

// Liste canali disponibili per questa app
export const listChannels = query({
  args: {},
  handler: async (ctx) => {
    const appName = process.env.LINKHUB_APP_NAME;
    return await ctx.db.query("appChannels")
      .filter(q => q.eq(q.field("appName"), appName))
      .collect();
  },
});
```

---

### 5. Onboarding Distribuito (Flusso Completo)

**Step 1: IT Genera Provisioning Token**
```typescript
// Admin IT esegue una volta
const apt = "apt_live_" + crypto.randomUUID().replace(/-/g, "");
const hash = await bcrypt.hash(apt, 10);

await ctx.db.insert("provisioningTokens", {
  tokenHash: hash,
  employeeEmail: "mario.rossi@company.com",
  department: "engineering",
  maxApps: 5,
  usedCount: 0,
  expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 giorni
  isActive: true,
  createdBy: "admin.it@company.com",
});
// Comunica a Mario: "Il tuo APT è: apt_live_xxx... (valido 7 giorni)"
```

**Step 2: Mario effettua Self-Provisioning su App OKR**
```typescript
// convex/components/agentBridge/provisioning.ts
export const provisionAgent = mutation({
  args: {
    provisioningToken: v.string(),
    railwayMetadata: v.object({
      projectId: v.string(),
      serviceId: v.string(),
    }),
  },
  handler: async (ctx, args) => {
    // Verifica APT
    const tokenRecord = await ctx.db.query("provisioningTokens")
      .filter(q => q.eq(q.field("isActive"), true))
      .collect();
      
    let validToken = null;
    for (const t of tokenRecord) {
      if (await bcrypt.compare(args.provisioningToken, t.tokenHash)) {
        validToken = t;
        break;
      }
    }
    
    if (!validToken || validToken.expiresAt < Date.now()) {
      throw new Error("Invalid or expired provisioning token");
    }
    
    if (validToken.usedCount >= validToken.maxApps) {
      throw new Error("Maximum number of apps reached for this token");
    }

    const appName = process.env.LINKHUB_APP_NAME;
    
    // Cerca o crea agente
    let agent = await ctx.db.query("registeredAgents")
      .withIndex("by_email", q => q.eq("employeeEmail", validToken.employeeEmail))
      .unique();
      
    if (!agent) {
      // Primo provisioning: crea agente globale
      agent = await ctx.db.insert("registeredAgents", {
        agentId: crypto.randomUUID(),
        employeeEmail: validToken.employeeEmail,
        department: validToken.department,
        firstRegisteredAt: Date.now(),
        lastSeenAt: Date.now(),
        isActive: true,
      });
      
      // Setup permessi default (deny all, allow specifiche da configurare dopo)
      await setupDefaultPermissions(ctx, agent.agentId, appName);
    }

    // Verifica non esista già istanza per questa app
    const existing = await ctx.db.query("agentAppInstances")
      .withIndex("by_agent_app", q => q.eq("agentId", agent.agentId).eq("appName", appName))
      .unique();
      
    if (existing) {
      // Ritorna token esistente (refresh)
      return { 
        agentId: agent.agentId, 
        instanceToken: existing.instanceToken,
        expiresAt: existing.expiresAt,
        message: "Instance already exists, returning existing credentials"
      };
    }

    // Crea nuova istanza
    const instanceToken = crypto.randomUUID();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    
    await ctx.db.insert("agentAppInstances", {
      agentId: agent.agentId,
      appName,
      instanceToken,
      railwayProjectId: args.railwayMetadata.projectId,
      railwayServiceId: args.railwayMetadata.serviceId,
      registeredAt: Date.now(),
      expiresAt,
      lastActivityAt: Date.now(),
      monthlyRequests: 0,
    });

    // Incrementa uso token
    await ctx.db.patch(validToken._id, { usedCount: validToken.usedCount + 1 });

    return {
      agentId: agent.agentId,
      instanceToken,
      expiresAt,
      appName,
      message: "Provisioning successful. Configure your Railway instance with these credentials."
    };
  },
});
```

**Step 3: Configurazione Railway da parte di Mario**
```yaml
# railway.yaml (template che Mario deploya sul suo account Railway, ma con credenziali fornite dal sistema)
services:
  agent:
    build: .
    variables:
      # Queste vengono dal provisioning Step 2
      INSTANCE_TOKEN: ${INSTANCE_TOKEN} # Mario le inserisce manualmente o via CLI Railway
      AGENT_ID: ${AGENT_ID}
      APP_URL: "https://linkhub-okr.convex.site" # URL dell'app su cui si è provisionato
      
      # Kimi - gestione personale
      KIMI_API_KEY: ${KIMI_API_KEY} # Mario inserisce la sua chiave Kimi personale
      
      # Metadata auto-rilevati da Railway
      RAILWAY_PROJECT_ID: ${RAILWAY_PROJECT_ID}
      RAILWAY_SERVICE_ID: ${RAILWAY_SERVICE_ID}
```

**Step 4: Auto-Registrazione all'avvio**
Lo script di bootstrap dell'agente OpenClaw chiama `/agent-bridge/provision` una sola volta per ottenere le credenziali, poi usa il gateway per tutte le chiamate successive.

---

### 6. Integrazione nell'App Host (Pattern Gateway)

Ogni app LinkHub monta il componente e configura il gateway.

```typescript
// convex/convex.config.ts
import { defineApp } from "convex/server";
import agentBridge from "./components/agentBridge/convex.config.js";

const app = defineApp();
app.use(agentBridge, {
  appName: "okr", // CRITICO: identifica l'app per A2A e permissions
  defaultPermissions: [
    { pattern: "public:*", permission: "allow" }, // Functions pubbliche
    { pattern: "okr:read*", permission: "allow" }, // Read-only OKR
    { pattern: "okr:write*", permission: "rate_limited", limits: { requestsPerHour: 50 } },
    { pattern: "*", permission: "deny" }, // Default deny
  ]
});
export default app;
```

```typescript
// convex/http.ts (App OKR)
import { httpRouter } from "convex/server";
import agentBridgeHttp from "./components/agentBridge/http";

const http = httpRouter();

// Monta tutte le route del componente (gateway, provisioning, channels)
agentBridgeHttp(http);

// Le tue API esistenti NON devono essere modificate!
// Sono accessibili solo tramite il gateway /agent-bridge/execute
// Oppure se vuoi mantenere endpoint pubblici separati, li lasci qui

export default http;
```

**Esempio di chiamata da OpenClaw**:
```yaml
tools:
  - name: "get_my_okrs"
    endpoint: "https://linkhub-okr.convex.site/agent-bridge/execute"
    method: "POST"
    headers:
      Content-Type: "application/json"
    body:
      instanceToken: "${INSTANCE_TOKEN}"
      functionName: "okr:getUserObjectives" # Nome della tua query Convex esistente
      args: { userId: "self" }
      estimatedCost: 200
```

---

### 7. Offboarding Distribuito

**Scenario 1: Revoca Totale (dipendente licenziato)**
```typescript
// Admin IT esegue:
await ctx.db.patch(agentId, { isActive: false, revokedAt: Date.now(), revokedBy: "admin@company.com" });

// Tutte le istanze diventano invalide al prossimo check (max 24h, o immediato se implementato webhook)
// Inoltre, script opzionale che chiama Railway API per stoppare le istanze (se Railway account è aziendale)
```

**Scenario 2: Revoca Singola App (Mario non deve più accedere a OKR, ma sì a HR)**
```typescript
// Rimuovi permissions specifiche
await ctx.db.delete(permissionId); // Rimuovi le allow per okr:*

// O revoca l'istanza specifica
const instance = await ctx.db.query("agentAppInstances")
  .withIndex("by_agent_app", q => q.eq("agentId", marioAgentId).eq("appName", "okr"))
  .unique();
  
if (instance) {
  await ctx.db.delete(instance._id);
}
```

**Scenario 3: Auto-Offboarding (dipendente cancella istanza Railway)**
Se Mario cancella la sua istanza Railway, il token scade dopo 24h automaticamente. Nessuna azione richiesta.

---

### 8. Configurazione OpenClaw (soul.md) per Dipendente

```yaml
name: LinkHub Agent - {{department}}
model: kimi-k2-5

tools:
  # Tutte le chiamate passano per il gateway
  - name: "call_app_function"
    endpoint: "${APP_URL}/agent-bridge/execute"
    method: "POST"
    headers:
      Content-Type: "application/json"
    parameters:
      type: object
      properties:
        functionName: { type: string, description: "Nome function Convex (es. okr:getObjectives)" }
        args: { type: object }
        estimatedCost: { type: number, default: 100 }
        
  # A2A su canali tematici di questa app
  - name: "post_to_channel"
    endpoint: "${APP_URL}/agent-bridge/channels/post"
    method: "POST"
    parameters:
      channelName: { type: string, enum: ["general", "help", "updates"] }
      payload: { type: object }
      priority: { type: number, minimum: 1, maximum: 10 }
      
  - name: "read_channel"
    endpoint: "${APP_URL}/agent-bridge/channels/read"
    method: "GET"
    parameters:
      channelName: { type: string }
      limit: { type: number, default: 10 }

system_prompt: |
  You are an agent operating on the {{appName}} LinkHub application.
  
  Your permissions are dynamically controlled by the IT department. If a function 
  call returns 403, you don't have permission for that operation.
  
  You can communicate with other agents on this same app through channels:
  - "general": Discussioni generali
  - "help": Richiesta aiuto ad altri agenti
  - "updates": Aggiornamenti automatici
  
  Be mindful of costs: you are using your personal Kimi K2.5 subscription. 
  If you exceed your plan (Basic/Moderato/Alto), the API will return 429 and you'll 
  need to wait for renewal or upgrade.
  
  Always check circuit breaker limits: max 100 calls/hour per function.
```

---

### 9. Checklist Implementazione per Cursor

1. **Setup Iniziale**:
   - `npm install bcryptjs @types/bcryptjs` nel progetto Convex
   - Configurare `LINKHUB_APP_NAME` nelle env vars di ogni app

2. **Provisioning Iniziale**:
   - Creare un Provisioning Token per te stesso (test)
   - Chiamare `/agent-bridge/provision` per generare il primo agente
   - Verificare che `functionPermissions` venga popolata con i default

3. **Test Permissions**:
   - Tentare di chiamare una function non autorizzata → deve ritornare 403
   - Verificare che il pattern matching funzioni (es. `okr:*` matcha `okr:create`)

4. **Test A2A**:
   - Creare due agenti sulla stessa app
   - Farli scambiare messaggi su un canale tematico
   - Verificare che non possano vedere messaggi di altre app (se esistono)

5. **Offboarding Test**:
   - Revocare permissions per una function specifica
   - Verificare che l'agente riceva 403 immediatamente

**Pronto per la produzione**: Inizia con una singola app e 2 agenti di test. Il vantaggio di questa architettura è che puoi aggiungere nuove app senza toccare il codice delle app esistenti - basta montare il componente e configurare i permessi dinamicamente.