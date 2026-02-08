# Convex Agent Bridge

[![npm version](https://badge.fury.io/js/@okrlinkhub%2Fagent-bridge.svg)](https://badge.fury.io/js/@okrlinkhub%2Fagent-bridge)

A Convex component that acts as a **Security Gateway** between external AI agents
(e.g. OpenClaw on Railway) and your Convex app's functions. It provides:

- **Function Handle Registry**: Register which of your app's functions agents can call
- **Dynamic Permissions**: Pattern-based access control (e.g. `"okr:read*"` -> allow)
- **Distributed Provisioning**: Token-based agent registration with self-service onboarding
- **Audit Logging**: Full access log of all agent interactions
- **HTTP Gateway**: Single endpoint for agents to call registered functions securely

Found a bug? Feature request?
[File it here](https://github.com/okrlinkhub/agent-bridge/issues).

## Installation

```sh
npm install @okrlinkhub/agent-bridge
```

Add the component to your `convex/convex.config.ts`:

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import agentBridge from "@okrlinkhub/agent-bridge/convex.config.js";

const app = defineApp();
app.use(agentBridge);

export default app;
```

## Quick Start

### 1. Initialize the client

```ts
// convex/agentBridge.ts
import { AgentBridge } from "@okrlinkhub/agent-bridge";
import { components } from "./_generated/api";

export const bridge = new AgentBridge(components.agentBridge, {
  appName: "my-app",
  defaultPermissions: [
    { pattern: "myapp:read*", permission: "allow" },
    { pattern: "myapp:write*", permission: "rate_limited", rateLimitConfig: { requestsPerHour: 50, tokenBudget: 50000 } },
    { pattern: "*", permission: "deny" },
  ],
});
```

### 2. Register functions that agents can call

```ts
import { mutation } from "./_generated/server";
import { createFunctionHandle } from "convex/server";
import { api } from "./_generated/api";
import { bridge } from "./agentBridge";

export const setup = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await bridge.configure(ctx);

    const handle = await createFunctionHandle(api.myFunctions.getItems);
    await bridge.registerFunction(ctx, {
      name: "myapp:getItems",
      handle,
      type: "query",
      description: "List all items",
    });

    return null;
  },
});
```

### 3. Mount HTTP routes

```ts
// convex/http.ts
import { httpRouter } from "convex/server";
import { registerRoutes } from "@okrlinkhub/agent-bridge";
import { components } from "./_generated/api";

const http = httpRouter();

// Exposes:
//   POST /agent-bridge/execute    -- Gateway for agent function calls
//   POST /agent-bridge/provision  -- Agent self-provisioning
//   GET  /agent-bridge/health     -- Health check
registerRoutes(http, components.agentBridge, {
  appName: "my-app",
});

export default http;
```

### 4. Generate a provisioning token (admin)

```ts
export const generateToken = mutation({
  args: { email: v.string(), department: v.string() },
  handler: async (ctx, args) => {
    // Authenticate admin here
    return await bridge.generateProvisioningToken(ctx, {
      employeeEmail: args.email,
      department: args.department,
      createdBy: "admin@company.com",
    });
  },
});
```

## How It Works

### Agent Provisioning Flow

1. **IT Admin** generates a Provisioning Token (APT) via the `generateProvisioningToken` method
2. **Employee** uses the APT to self-register on an app by calling `POST /agent-bridge/provision`
3. The component creates an agent record and returns an `instanceToken` (valid 24h)
4. The agent uses the `instanceToken` for all subsequent function calls

### Function Execution Flow

1. Agent sends `POST /agent-bridge/execute` with `{ instanceToken, functionName, args }`
2. The gateway validates the token, checks permissions via pattern matching
3. If authorized, executes the registered function handle and returns the result
4. All access attempts are logged to the audit table

### Permission Pattern Matching

Permissions use glob-style patterns with `*` wildcards:

| Pattern | Matches |
|---------|---------|
| `*` | Everything (catch-all) |
| `okr:*` | All OKR functions |
| `okr:read*` | `okr:readObjectives`, `okr:readKeyResults`, etc. |
| `okr:createObjective` | Only this specific function |

More specific patterns take priority over wildcards. Default behavior when no pattern matches: **deny**.

## API Reference

### `AgentBridge` class

| Method | Description |
|--------|-------------|
| `configure(ctx)` | Initialize component configuration |
| `registerFunction(ctx, fn)` | Register a callable function |
| `registerFunctions(ctx, fns)` | Bulk register functions |
| `unregisterFunction(ctx, name)` | Remove a function |
| `listFunctions(ctx)` | List registered functions |
| `generateProvisioningToken(ctx, opts)` | Create an APT (admin) |
| `listAgents(ctx)` | List registered agents |
| `revokeAgent(ctx, opts)` | Revoke an agent globally |
| `revokeAppInstance(ctx, opts)` | Revoke a specific app instance |
| `setPermission(ctx, opts)` | Set/update a permission |
| `removePermission(ctx, opts)` | Remove a permission |
| `listPermissions(ctx, agentId)` | List agent permissions |
| `queryAccessLog(ctx, opts)` | Query audit logs |

### `registerRoutes(http, component, config)`

Registers HTTP endpoints on the host app's router:

- `POST /agent-bridge/execute` -- Execute a registered function
- `POST /agent-bridge/provision` -- Agent self-provisioning
- `GET /agent-bridge/health` -- Health check

See [example/convex/example.ts](./example/convex/example.ts) for a complete working example.

## Development

```sh
npm i
npm run dev
```
