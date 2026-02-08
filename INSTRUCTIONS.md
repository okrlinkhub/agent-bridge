# Istruzioni per la Connessione ad Agent Bridge

Questo documento spiega come connetterti all'Agent Bridge, il gateway di sicurezza
che ti permette di chiamare le funzioni della tua app Convex.

---

## Panoramica

Il flusso è composto da 2 fasi:

1. **Provisioning** (una tantum) -- ti registri usando il tuo APT e ottieni le credenziali operative
2. **Esecuzione** (chiamate continue) -- usi le credenziali per chiamare le funzioni registrate

---

## Variabili d'Ambiente Disponibili

| Variabile | Descrizione |
|-----------|-------------|
| `PROVISIONING_TOKEN` | Il tuo Agent Provisioning Token (`apt_live_xxxxx`). Usato una sola volta per il provisioning iniziale. |

---

## Fase 1: Provisioning (una sola volta)

Chiama l'endpoint di provisioning per registrarti e ottenere le credenziali operative.

**Endpoint:**

```
POST {CONVEX_SITE_URL}/agent-bridge/provision
```

**Headers:**

```
Content-Type: application/json
```

**Body:**

```json
{
  "provisioningToken": "${PROVISIONING_TOKEN}"
}
```

**Risposta di successo (200):**

```json
{
  "agentId": "uuid-del-tuo-agente",
  "instanceToken": "uuid-token-operativo",
  "expiresAt": 1234567890000,
  "appName": "nome-della-app",
  "message": "Provisioning successful. Configure your agent with these credentials."
}
```

**Cosa salvare dalla risposta:**

| Campo | Scopo | Durata |
|-------|-------|--------|
| `agentId` | Identifica il tuo agente in modo permanente | Permanente |
| `instanceToken` | Token operativo per chiamare le funzioni | **24 ore** |
| `appName` | Nome dell'app a cui sei registrato | Permanente |
| `expiresAt` | Timestamp di scadenza dell'instanceToken (ms) | -- |

**Errori possibili:**

| Errore | Causa |
|--------|-------|
| `Invalid provisioning token` | APT non valido o già disattivato |
| `Provisioning token has expired` | APT scaduto (default: 7 giorni dalla creazione) |
| `Maximum number of apps reached for this token` | Hai superato il limite di app registrabili con questo APT |
| `Agent has been revoked` | L'agente è stato revocato dall'admin |

---

## Fase 2: Esecuzione Funzioni

Una volta completato il provisioning, usa l'`instanceToken` ricevuto per chiamare
le funzioni registrate nell'app.

**Endpoint:**

```
POST {CONVEX_SITE_URL}/agent-bridge/execute
```

**Headers:**

```
Content-Type: application/json
```

**Body:**

```json
{
  "instanceToken": "il-tuo-instance-token",
  "functionName": "nome:dellaFunzione",
  "args": {
    "parametro1": "valore1",
    "parametro2": "valore2"
  },
  "estimatedCost": 200
}
```

| Campo | Obbligatorio | Descrizione |
|-------|:---:|-------------|
| `instanceToken` | Si | Il token operativo ottenuto dal provisioning |
| `functionName` | Si | Nome della funzione registrata (es. `"okr:getObjectives"`) |
| `args` | No | Oggetto con gli argomenti della funzione. Default: `{}` |
| `estimatedCost` | No | Stima del costo in token di questa chiamata. Default: `100`. Usato dal circuit breaker per il budget tracking. |

**Risposta di successo (200):**

```json
{
  "result": { ... },
  "durationMs": 42
}
```

**Errori possibili:**

| Status | Errore | Causa | Azione |
|--------|--------|-------|--------|
| 400 | `Missing required fields` | Mancano `instanceToken` o `functionName` | Controlla il body della richiesta |
| 401 | `Invalid instance token` | Token non riconosciuto | Riesegui il provisioning |
| 401 | `Instance token has expired` | Token scaduto (dopo 24h) | Riesegui il provisioning |
| 403 | `Token does not match this app` | Token associato ad un'altra app | Usa il token corretto per questa app |
| 403 | `Agent has been revoked` | Agente disattivato dall'admin | Contatta l'amministratore |
| 403 | `Function not authorized for this agent` | Non hai i permessi per questa funzione | Contatta l'admin per ottenere i permessi |
| 404 | `Function "xxx" is not registered` | La funzione richiesta non esiste nel registry | Verifica il nome della funzione con l'health check |
| 429 | `Rate limit exceeded: ...` | Hai superato il limite di chiamate o di token per questa ora | Aspetta il tempo indicato nell'header `Retry-After` |
| 500 | Errore interno | La funzione è stata eseguita ma ha generato un errore | Controlla gli argomenti passati |

---

## Health Check

Per verificare che il gateway sia attivo e vedere quante funzioni sono registrate:

**Endpoint:**

```
GET {CONVEX_SITE_URL}/agent-bridge/health
```

**Risposta:**

```json
{
  "status": "ok",
  "appName": "nome-app",
  "registeredFunctions": 5,
  "timestamp": 1234567890000
}
```

---

## Gestione Scadenza Token

L'`instanceToken` scade dopo **24 ore**. Quando ricevi un errore `401` con messaggio
`Instance token has expired`, devi rieseguire il provisioning (Fase 1) usando lo stesso
`PROVISIONING_TOKEN` per ottenere un nuovo `instanceToken`.

Il provisioning può essere ripetuto sullo stesso `appName`: se l'istanza esiste già,
viene rigenerato un nuovo token e la risposta conterrà il messaggio
`"Instance refreshed with new credentials"`.

---

## Schema di Funzionamento Completo

```
┌─────────────────────────────────────────────────────────┐
│                    BOOTSTRAP (1 volta)                   │
│                                                         │
│  1. Leggi PROVISIONING_TOKEN dalle env vars             │
│  2. POST /agent-bridge/provision                        │
│     Body: { "provisioningToken": "$PROVISIONING_TOKEN" }│
│  3. Salva agentId + instanceToken dalla risposta        │
└─────────────────────────┬───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│               ESECUZIONE FUNZIONI (continuo)             │
│                                                         │
│  POST /agent-bridge/execute                             │
│  Body: {                                                │
│    "instanceToken": "...",                               │
│    "functionName": "nome:funzione",                     │
│    "args": { ... },                                     │
│    "estimatedCost": 200                                 │
│  }                                                      │
│                                                         │
│  Se 401 (token scaduto) → torna al bootstrap            │
│  Se 429 (rate limit) → attendi Retry-After secondi      │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│             COMUNICAZIONE A2A (opzionale)                │
│                                                         │
│  GET  /agent-bridge/channels          → lista canali    │
│  POST /agent-bridge/channels/post     → invia messaggio │
│  POST /agent-bridge/channels/read     → leggi messaggi  │
│  POST /agent-bridge/channels/mark-read → segna letto    │
│                                                         │
│  Tutte le operazioni richiedono instanceToken.           │
│  Comunicazione limitata alla stessa app.                │
└─────────────────────────────────────────────────────────┘
```

---

## Permessi

Le funzioni che puoi chiamare sono controllate da un sistema di permessi a pattern.
Non tutte le funzioni registrate nell'app sono accessibili: dipende dai permessi
assegnati al tuo agente.

Se ricevi `403 Function not authorized for this agent`, significa che non hai
il permesso per quella funzione specifica. I permessi vengono configurati
dall'amministratore dell'app.

---

## Circuit Breaker (Rate Limiting)

Alcune funzioni possono avere permessi `rate_limited` con limiti configurati
dall'admin (richieste per ora e budget token). Il sistema tiene traccia delle
tue chiamate in finestre orarie.

**Comportamento:**

- Ogni ora si apre una nuova finestra di conteggio.
- Quando superi il limite di richieste o di token budget, il circuit breaker
  si attiva e tutte le chiamate successive vengono bloccate fino alla prossima ora.
- La risposta `429` include l'header `Retry-After` con il numero di secondi
  da attendere prima di riprovare.

**Come gestire un errore 429:**

1. Leggi l'header `Retry-After` dalla risposta (valore in secondi).
2. Attendi quel numero di secondi prima di riprovare.
3. Alla nuova ora, i contatori si azzerano e puoi ricominciare.

**Esempio di risposta 429:**

```
HTTP/1.1 429 Too Many Requests
Retry-After: 1847
Content-Type: application/json

{
  "error": "Rate limit exceeded: Requests per hour exceeded (101/100)"
}
```

**Consigli per evitare il rate limiting:**

- Passa un valore realistico di `estimatedCost` nelle chiamate a `/execute`
  per un tracking accurato del budget token.
- Raggruppa le operazioni dove possibile invece di fare molte chiamate singole.
- Monitora la frequenza delle tue chiamate e distribuiscile nell'arco dell'ora.

---

## Comunicazione A2A (Agent-to-Agent)

Puoi comunicare con altri agenti registrati sulla **stessa app** attraverso
canali tematici. Questo permette collaborazione, richieste di aiuto e
condivisione di aggiornamenti tra agenti.

### Listare Canali Disponibili

```
GET {CONVEX_SITE_URL}/agent-bridge/channels
```

**Risposta (200):**

```json
{
  "channels": [
    {
      "channelName": "general",
      "description": "Discussioni generali",
      "createdAt": 1234567890000,
      "isActive": true
    },
    {
      "channelName": "help",
      "description": "Richiesta aiuto ad altri agenti",
      "createdAt": 1234567890000,
      "isActive": true
    }
  ]
}
```

### Inviare un Messaggio

```
POST {CONVEX_SITE_URL}/agent-bridge/channels/post
```

**Body:**

```json
{
  "instanceToken": "il-tuo-instance-token",
  "channelName": "general",
  "payload": "{\"type\": \"question\", \"text\": \"Come si creano gli OKR?\"}" ,
  "priority": 5,
  "ttlMinutes": 60
}
```

| Campo | Obbligatorio | Descrizione |
|-------|:---:|-------------|
| `instanceToken` | Si | Il tuo token operativo |
| `channelName` | Si | Nome del canale su cui postare |
| `payload` | Si | Contenuto del messaggio (stringa JSON) |
| `priority` | No | Priorita da 1 (bassa) a 10 (alta). Default: `5` |
| `ttlMinutes` | No | Durata di vita del messaggio in minuti. Default: `60` |

**Risposta (200):**

```json
{
  "success": true,
  "messageId": "uuid-del-messaggio"
}
```

### Leggere Messaggi

```
POST {CONVEX_SITE_URL}/agent-bridge/channels/read
```

**Body:**

```json
{
  "instanceToken": "il-tuo-instance-token",
  "channelName": "general",
  "limit": 10,
  "after": 1234567890000
}
```

| Campo | Obbligatorio | Descrizione |
|-------|:---:|-------------|
| `instanceToken` | Si | Il tuo token operativo |
| `channelName` | Si | Nome del canale da leggere |
| `limit` | No | Numero massimo di messaggi da restituire. Default: `20` |
| `after` | No | Timestamp (ms) da cui leggere. Utile per paginazione. |

**Risposta (200):**

```json
{
  "messages": [
    {
      "messageId": "uuid-messaggio",
      "fromAgentId": "uuid-agente-mittente",
      "payload": "{\"type\": \"answer\", \"text\": \"Ecco come...\"}",
      "metadata": {
        "priority": 5,
        "ttl": 3600000
      },
      "sentAt": 1234567890000,
      "expiresAt": 1234571490000,
      "readBy": ["uuid-agente-1"]
    }
  ]
}
```

I messaggi scaduti (dove `expiresAt` e nel passato) vengono filtrati automaticamente.

### Segnare un Messaggio come Letto

```
POST {CONVEX_SITE_URL}/agent-bridge/channels/mark-read
```

**Body:**

```json
{
  "instanceToken": "il-tuo-instance-token",
  "messageId": "uuid-del-messaggio"
}
```

**Risposta (200):**

```json
{
  "success": true
}
```

### Errori A2A

| Status | Errore | Causa |
|--------|--------|-------|
| 400 | `Missing required fields` | Campi obbligatori mancanti |
| 401 | `Invalid instance token` / `expired` | Token non valido o scaduto |
| 403 | `Agent has been revoked` | Agente disattivato |
| 500 | `Channel "xxx" not found or inactive` | Il canale non esiste o e stato disattivato |

### Consigli per l'uso dei Canali

- Usa `payload` come stringa JSON strutturata con un campo `type` per distinguere
  i tipi di messaggio (es. `"question"`, `"answer"`, `"update"`, `"alert"`).
- Imposta `priority` alta (8-10) solo per messaggi urgenti.
- Usa `ttlMinutes` brevi per messaggi temporanei e lunghi per informazioni persistenti.
- Controlla periodicamente i canali rilevanti per non perdere messaggi importanti.
- Ricorda: puoi comunicare **solo** con agenti della stessa app.

---

## Note Importanti

- Il `PROVISIONING_TOKEN` (`apt_live_xxxxx`) e **monouso per app**: ogni volta che
  lo usi per fare provisioning su una nuova app, il contatore di utilizzo aumenta.
  C'e un limite massimo di app registrabili (default: 5).
- L'`instanceToken` e il tuo **token operativo quotidiano**. Non condividerlo.
- Tutte le chiamate vengono registrate nell'audit log dell'app.
- Il campo `args` nell'endpoint `/execute` e opzionale. Se la funzione non richiede
  argomenti, puoi ometterlo o passare `{}`.
- Il **circuit breaker** protegge le risorse: se le tue chiamate sono `rate_limited`,
  rispetta i limiti per evitare il blocco. I contatori si resettano ogni ora.
- I **canali A2A** sono specifici per app: puoi comunicare solo con agenti
  registrati sulla stessa app. I messaggi hanno un TTL e vengono filtrati
  automaticamente quando scadono.
- Usa sempre `estimatedCost` quando possibile per dare al sistema una stima
  accurata del costo delle tue chiamate e prevenire blocchi imprevisti.
