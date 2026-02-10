#!/usr/bin/env node
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();

async function exists(targetPath: string) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function writeIfMissing(
  relativePath: string,
  content: string,
): Promise<"created" | "skipped"> {
  const absolutePath = path.join(cwd, relativePath);
  if (await exists(absolutePath)) {
    return "skipped";
  }

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
  return "created";
}

const configTemplate = `import { api } from "./convex/_generated/api";
import { defineAgentBridgeConfig } from "@okrlinkhub/agent-bridge";

export default defineAgentBridgeConfig({
  functions: {
    "cart.calculatePrice": {
      ref: api.cart.calculatePrice,
      type: "query",
    },
    "cart.applyDiscount": {
      ref: api.cart.applyDiscount,
      type: "mutation",
    },
  },
  metadata: {
    "cart.calculatePrice": {
      description: "Calcola il prezzo totale del carrello",
      riskLevel: "low",
      category: "commerce",
    },
  },
});
`;

const bridgeHttpTemplate = `import { registerRoutes } from "@okrlinkhub/agent-bridge";
import { components } from "./_generated/api";
import config from "../agent-bridge.config";

export function registerAgentBridgeRoutes(
  http: Parameters<typeof registerRoutes>[0],
) {
  registerRoutes(http, components.agentBridge, config, {
    pathPrefix: "/agent",
    serviceKeysEnvVar: "AGENT_BRIDGE_SERVICE_KEYS_JSON",
  });
}
`;

const integrationNotes = `
[agent-bridge] Init completed.

Next steps:
1) Add component in convex/convex.config.ts:

import { defineApp } from "convex/server";
import agentBridge from "@okrlinkhub/agent-bridge/convex.config.js";

const app = defineApp();
app.use(agentBridge);
export default app;

2) Mount routes in convex/http.ts:

import { httpRouter } from "convex/server";
import { registerAgentBridgeRoutes } from "./agentBridge";

const http = httpRouter();
registerAgentBridgeRoutes(http);
export default http;

3) Create agents and permissions with component mutations:
- components.agentBridge.agents.createAgent
- components.agentBridge.permissions.setAgentPermissions
- components.agentBridge.permissions.setFunctionOverrides

4) Configure strict service auth map (required):
- AGENT_BRIDGE_SERVICE_KEYS_JSON={"openclaw-prod":"<key>","openclaw-staging":"<key>"}
- OpenClaw must send X-Agent-Service-Id, X-Agent-Service-Key and X-Agent-App
- Legacy X-Agent-API-Key is not supported in strict mode
`;

async function main() {
  const commandArg = process.argv[2];
  if (commandArg && commandArg !== "init") {
    console.error(`[agent-bridge] Unknown command "${commandArg}".`);
    console.error("Usage: npx @okrlinkhub/agent-bridge init");
    process.exitCode = 1;
    return;
  }

  const configResult = await writeIfMissing("agent-bridge.config.ts", configTemplate);
  const bridgeResult = await writeIfMissing("convex/agentBridge.ts", bridgeHttpTemplate);

  console.log(
    `[agent-bridge] agent-bridge.config.ts: ${configResult === "created" ? "created" : "skipped (already exists)"}`,
  );
  console.log(
    `[agent-bridge] convex/agentBridge.ts: ${bridgeResult === "created" ? "created" : "skipped (already exists)"}`,
  );
  console.log(integrationNotes.trim());
}

void main();
