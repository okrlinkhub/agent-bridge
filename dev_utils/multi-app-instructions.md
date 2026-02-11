1) Prompt pronto per OpenClaw (strict, multi-app consumer)
Always call: POST {resolved_app_base_url}/api/agent/execute-on-behalf
Always send headers:
- Content-Type: application/json
- X-Agent-Service-Id: {OPENCLAW_SERVICE_ID}
- X-Agent-Service-Key: {OPENCLAW_SERVICE_KEY}
- X-Agent-App: {resolved_app_key} (opzionale se risolto nel consumer)
Do not send Authorization from OpenClaw for execute-on-behalf.
Never send X-Agent-API-Key.
Never log or print secrets (service keys or API keys).

2) Procedura tecnica pronta (routing automatico)
Env consigliate su Railway (OpenClaw):
- APP_BASE_URL_MAP_JSON={"crm":"https://crm.example.com","billing":"https://billing.example.com"}
- OPENCLAW_SERVICE_ID=openclaw-prod
- OPENCLAW_SERVICE_KEY=abs_live_...
- AGENT_BRIDGE_DEFAULT_APP_KEY=crm (opzionale)
- AGENT_BRIDGE_ROUTE_MAP_JSON=<json sotto>
- AGENT_BRIDGE_AUDIT_HASH_SALT=<random-long-secret> (raccomandata lato Convex, nel bridge)

Esempio AGENT_BRIDGE_ROUTE_MAP_JSON:
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

Regola operativa cross-app:
- OpenClaw risolve `appKey` da `functionKey`
- OpenClaw risolve `baseUrl` usando `APP_BASE_URL_MAP_JSON` e `appKey`
- Se `appKey` non e mappata: fail-fast (errore esplicito, nessun fallback)

Decisione linking:
- Il bridge NON espone endpoint HTTP per creare/risolvere link utente.
- Usa sempre le mutation/query del componente (`components.agentBridge.linking.*`) da BFF/app server-side.
