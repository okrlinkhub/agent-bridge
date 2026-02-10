import { describe, expect, test, vi } from "vitest";
import {
  defineAgentBridgeConfig,
  registerRoutes,
  type AgentBridgeConfig,
} from "./index.js";

function setupExecuteHandler(
  config: AgentBridgeConfig,
  options?: { serviceKey?: string },
) {
  const routes: Array<{
    path: string;
    method: string;
    handler: (ctx: unknown, request: Request) => Promise<Response>;
  }> = [];
  const http = {
    route: (route: {
      path: string;
      method: string;
      handler: (ctx: unknown, request: Request) => Promise<Response>;
    }) => {
      routes.push(route);
    },
  };

  const component = {
    gateway: {
      authorizeRequest: "authorizeRequestRef",
      authorizeByAppKey: "authorizeByAppKeyRef",
      logAccess: "logAccessRef",
    },
  };

  registerRoutes(http as never, component as never, config, {
    pathPrefix: "/agent",
    serviceKey: options?.serviceKey,
  });
  const executeRoute = routes.find(
    (route) => route.path === "/agent/execute" && route.method === "POST",
  );
  if (!executeRoute) {
    throw new Error("Execute route not registered");
  }
  return executeRoute.handler;
}

describe("registerRoutes auth modes", () => {
  const config = defineAgentBridgeConfig({
    functions: {
      "demo.list": {
        ref: { _type: "query" },
        type: "query",
      },
    },
  });

  test("uses legacy api key flow when X-Agent-API-Key is present", async () => {
    const executeHandler = setupExecuteHandler(config, { serviceKey: "svc_key" });
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({
        authorized: true,
        agentId: "agent_1",
      })
      .mockResolvedValueOnce(null);
    const runQuery = vi.fn().mockResolvedValue({ ok: true });

    const response = await executeHandler(
      { runMutation, runQuery, runAction: vi.fn() },
      new Request("https://example.com/agent/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Agent-API-Key": "legacy_key",
        },
        body: JSON.stringify({
          functionKey: "demo.list",
          args: {},
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(runMutation).toHaveBeenNthCalledWith(1, "authorizeRequestRef", {
      apiKey: "legacy_key",
      functionKey: "demo.list",
      estimatedCost: undefined,
    });
  });

  test("returns 401 when service key is invalid", async () => {
    const executeHandler = setupExecuteHandler(config, { serviceKey: "svc_key" });
    const runMutation = vi.fn();

    const response = await executeHandler(
      { runMutation, runQuery: vi.fn(), runAction: vi.fn() },
      new Request("https://example.com/agent/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Service-Key": "wrong_key",
          "X-Agent-App": "crm",
        },
        body: JSON.stringify({
          functionKey: "demo.list",
          args: {},
        }),
      }),
    );

    expect(response.status).toBe(401);
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("returns app-level authorization error when app is missing", async () => {
    const executeHandler = setupExecuteHandler(config, { serviceKey: "svc_key" });
    const runMutation = vi.fn().mockResolvedValue({
      authorized: false,
      error: "App crm is not registered",
      statusCode: 404,
    });

    const response = await executeHandler(
      { runMutation, runQuery: vi.fn(), runAction: vi.fn() },
      new Request("https://example.com/agent/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Service-Key": "svc_key",
          "X-Agent-App": "crm",
        },
        body: JSON.stringify({
          functionKey: "demo.list",
          args: {},
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect(runMutation).toHaveBeenCalledWith("authorizeByAppKeyRef", {
      appKey: "crm",
      functionKey: "demo.list",
      estimatedCost: undefined,
    });
  });
});
