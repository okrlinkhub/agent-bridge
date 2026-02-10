1) Prompt pronto per OpenClaw (strict)
Always call: POST {AGENT_BRIDGE_BASE_URL}/agent/execute
Always send headers:
- Content-Type: application/json
- X-Agent-Service-Id: {OPENCLAW_SERVICE_ID}
- X-Agent-Service-Key: {OPENCLAW_SERVICE_KEY}
- X-Agent-App: {resolved_app_key}
Add Authorization only when function needs user context:
- Authorization: Bearer {user_jwt}
Never send X-Agent-API-Key.
Never log or print secrets (service keys or API keys).

2) Procedura tecnica pronta (routing automatico)
Env consigliate su Railway (OpenClaw):
- AGENT_BRIDGE_BASE_URL=https://<your-convex-site>
- OPENCLAW_SERVICE_ID=openclaw-prod
- OPENCLAW_SERVICE_KEY=abs_live_...
- AGENT_BRIDGE_DEFAULT_APP_KEY=crm (opzionale)
- AGENT_BRIDGE_ROUTE_MAP_JSON=<json sotto>
- AGENT_BRIDGE_AUDIT_HASH_SALT=<random-long-secret> (raccomandata lato Convex)

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
- service-only function: usa solo header strict
- user-scoped function (`ctx.auth.getUserIdentity()`): inoltra anche `Authorization`

Decisione linking:
- Il bridge NON espone endpoint HTTP per creare/risolvere link utente.
- Usa sempre le mutation/query del componente (`components.agentBridge.linking.*`) da BFF/app server-side.
