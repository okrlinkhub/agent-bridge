---
name: Account Linking Multi App
overview: Definire un flusso dedicato di account linking utente per OpenClaw che funzioni su più applicativi Convex senza dipendere da frontend session-based o token manuali da dashboard.
todos:
  - id: define-linking-contract
    content: Definire contratto account-linking multi-app e modello dati per providerUserId/appUserSubject/status
    status: pending
  - id: add-auth-mode-metadata
    content: Aggiungere classificazione authMode service|user nelle funzioni esposte e validazione runtime
    status: pending
  - id: implement-link-lifecycle
    content: Implementare start/complete/revoke link con codici one-time e policy di sicurezza
    status: pending
  - id: build-delegated-execution-endpoint
    content: Implementare endpoint execute-on-behalf app-side che risolve link e inoltra a Agent Bridge
    status: pending
  - id: harden-security-audit
    content: Applicare redaction log, hashing identificativi, rotazione segreti e controlli anti-abuso
    status: pending
  - id: rollout-multi-app
    content: Validare il flusso su Linkhub e Area Manager Compass e produrre template riusabile
    status: pending
isProject: false
---

# Piano testuale: account linking utente per OpenClaw multi-app

## Obiettivo

Consentire a OpenClaw (Discord, Telegram, server esterni) di operare con identità utente reale dell’app, senza accesso al frontend e senza token copiati manualmente.

## Problema attuale

- Agent Bridge oggi autentica il servizio con header `X-Agent-*`.
- Le funzioni Convex user-scoped richiedono `ctx.auth.getUserIdentity()` e quindi un bearer utente valido.
- OpenClaw, da solo, non ha sessione utente né un meccanismo standard per ottenere token utente per richiesta.

## Soluzione scelta

Adottare un flusso di **account linking utente** (no impersonazione admin come default):

1. L’utente collega il proprio account app a OpenClaw una volta.
2. OpenClaw salva un riferimento al collegamento, non token permanenti in chiaro.
3. A ogni comando, OpenClaw risolve l’utente collegato e ottiene un token valido tramite endpoint dedicato di delega.
4. OpenClaw chiama Agent Bridge con header strict + `Authorization: Bearer <token utente>`.

## Principi di sicurezza

- Mai esporre endpoint “give me token” pubblico.
- Usare solo endpoint di esecuzione delegata o token exchange con TTL breve.
- Conservare in storage solo metadati di collegamento e refresh/segreti cifrati se necessari.
- Log senza PII sensibile e senza token.
- Revoca immediata del collegamento da app e da OpenClaw.

## Architettura target (riusabile)

### 1) Link Registry lato Agent Bridge/OpenClaw

Introdurre un registro collegamenti utente con queste informazioni minime:

- `provider`: discord/telegram/slack/altro
- `providerUserId`: id utente sul canale
- `appKey`: applicativo target
- `appUserSubject`: subject utente nell’app (non necessariamente DB id)
- `status`: active/revoked
- `createdAt`, `updatedAt`, `lastUsedAt`

Uso:

- ogni comando in ingresso mappa `provider + providerUserId + appKey` -> identità app collegata.

### 2) Endpoint di delega nell’app (per ogni app Convex)

Definire endpoint server-side dedicato (non frontend-only) che:

- autentica la richiesta da OpenClaw (service signature/shared secret/mTLS)
- verifica che il linking sia valido
- emette o recupera un bearer utente breve (o esegue direttamente la chiamata bridge per conto utente)
- restituisce solo risultato (preferito) o token corto se necessario

Nota pratica:

- Per app Next.js (Linkhub) il pattern già esistente con route server-side è base solida.
- Per SPA Auth0 (Area Manager Compass) serve BFF dedicato, come già documentato, ma esteso con linking e delega machine-to-machine.

### 3) Modalità esecuzione consigliata

Preferire **execute-on-behalf** rispetto a “token handing”:

- OpenClaw invia comando + identità canale + appKey
- BFF app risolve collegamento e chiama Agent Bridge con bearer utente
- OpenClaw riceve risultato, non riceve token

Vantaggi:

- riduce superficie di esposizione token
- centralizza policy e auditing nell’app
- più semplice da rendere conforme in ambienti enterprise

## Estensioni Agent Bridge proposte (compatibili)

### A) Metadata di funzione

Aggiungere in config funzioni un flag semantico:

- `authMode: "service" | "user"`

Comportamento:

- `service`: chiamata valida con soli `X-Agent-*`
- `user`: bridge rifiuta se manca `Authorization`

### B) Audit avanzato

Estendere log accesso con:

- `authMode` risolto
- `linkedProvider` (discord/telegram)
- `providerUserId` hashato
- `userSubject` hashato

### C) Revoca e policy

Aggiungere query/mutation per:

- revocare link per singolo utente
- revocare link per appKey
- elencare link attivi con filtri amministrativi

## Piano implementativo per fasi

### Fase 1: Contratto e schema

- Definire contratto linking multi-app e struttura tabelle.
- Introdurre `authMode` nella configurazione funzioni.
- Definire errori standard: `missing_user_context`, `link_not_found`, `link_revoked`, `delegation_denied`.

### Fase 2: Link flow utente

- Implementare “start link” e “complete link” con codice one-time.
- Associare in modo deterministico `providerUserId` all’utente app autenticato.
- Salvare stato link e timestamp.

### Fase 3: Delega esecuzione

- Implementare endpoint dedicato app-side per execute-on-behalf.
- Validare richiesta OpenClaw, risolvere link, inoltrare ad Agent Bridge con bearer utente.
- Uniformare mapping errori e retry (`429` con `Retry-After`).

### Fase 4: Hardening

- Cifratura/segreti, rotazione chiavi, TTL breve su credenziali delegate.
- Redaction log, auditing e alert su fallimenti auth ripetuti.
- Revoca immediata e cleanup link inattivi.

### Fase 5: Rollout multi-app

- Pilot su Linkhub.
- Porting su Area Manager Compass con adapter Auth0.
- Template riusabile per nuove app Convex (custom OIDC incluso).

## Criteri di accettazione

- OpenClaw può eseguire funzioni user-scoped senza frontend attivo.
- Nessun token utente copiato manualmente da dashboard.
- Ogni esecuzione user-scoped è tracciabile al collegamento utente-canale.
- Revoca link efficace in tempo reale.
- Stesso contratto funziona su app NextAuth e Auth0.

