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
  }
}
```

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
│                   OPERAZIONI (continuo)                  │
│                                                         │
│  POST /agent-bridge/execute                             │
│  Body: {                                                │
│    "instanceToken": "...",                               │
│    "functionName": "nome:funzione",                     │
│    "args": { ... }                                      │
│  }                                                      │
│                                                         │
│  Se 401 (token scaduto) → torna al bootstrap            │
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

## Note Importanti

- Il `PROVISIONING_TOKEN` (`apt_live_xxxxx`) è **monouso per app**: ogni volta che
  lo usi per fare provisioning su una nuova app, il contatore di utilizzo aumenta.
  C'è un limite massimo di app registrabili (default: 5).
- L'`instanceToken` è il tuo **token operativo quotidiano**. Non condividerlo.
- Tutte le chiamate vengono registrate nell'audit log dell'app.
- Il campo `args` nell'endpoint `/execute` è opzionale. Se la funzione non richiede
  argomenti, puoi ometterlo o passare `{}`.
