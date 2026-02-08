import { httpRouter } from "convex/server";
import { registerRoutes } from "@okrlinkhub/agent-bridge";
import { components } from "./_generated/api";

const http = httpRouter();

// Register agent bridge HTTP routes.
// This exposes:
//   POST /agent-bridge/execute    -- Gateway for agent function calls
//   POST /agent-bridge/provision  -- Agent self-provisioning
//   GET  /agent-bridge/health     -- Health check
registerRoutes(http, components.agentBridge, {
  appName: "demo",
});

export default http;
