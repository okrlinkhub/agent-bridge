import { httpRouter } from "convex/server";
import { registerRoutes } from "@okrlinkhub/agent-bridge";
import { components } from "./_generated/api";
import bridgeConfig from "../agent-bridge.config";

const http = httpRouter();

registerRoutes(http, components.agentBridge, bridgeConfig, {
  pathPrefix: "/agent",
});

export default http;
