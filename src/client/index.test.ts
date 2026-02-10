import { describe, expect, test, vi } from "vitest";
import {
  defineAgentBridgeConfig,
  registerRoutes,
  type AgentBridgeConfig,
} from "./index.js";

function setupExecuteHandler(
  config: AgentBridgeConfig,
  options?: {
    serviceKeys?: Record<string, string>;
    serviceKeysEnvVar?: string;
  },
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
    serviceKeys: options?.serviceKeys,
    serviceKeysEnvVar: options?.serviceKeysEnvVar,
  });
  const executeRoute = routes.find(
    (route) => route.path === "/agent/execute" && route.method === "POST",
  );
  if (!executeRoute) {
    throw new Error("Execute route not registered");
  }
  return executeRoute.handler;
}

describe("registerRoutes strict service auth", () => {
  const originalEnv = process.env.AGENT_BRIDGE_SERVICE_KEYS_JSON;

  const config = defineAgentBridgeConfig({
    functions: {
      "demo.list": {
        ref: { _type: "query" },
        type: "query",
      },
    },
  });

  test("authorizes with strict headers and service id map", async () => {
    const executeHandler = setupExecuteHandler(config, {
      serviceKeys: { "railway-a": "svc_key_a" },
    });
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
          "X-Agent-Service-Id": "railway-a",
          "X-Agent-Service-Key": "svc_key_a",
          "X-Agent-App": "crm",
        },
        body: JSON.stringify({
          functionKey: "demo.list",
          args: {},
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(runMutation).toHaveBeenNthCalledWith(1, "authorizeByAppKeyRef", {
      appKey: "crm",
      functionKey: "demo.list",
      estimatedCost: undefined,
    });
    expect(runMutation).toHaveBeenNthCalledWith(2, "logAccessRef", {
      agentId: "agent_1",
      serviceId: "railway-a",
      functionKey: "demo.list",
      args: {},
      result: { ok: true },
      duration: expect.any(Number),
      timestamp: expect.any(Number),
    });
  });

  test("returns 400 when service id header is missing", async () => {
    const executeHandler = setupExecuteHandler(config, {
      serviceKeys: { "railway-a": "svc_key_a" },
    });
    const runMutation = vi.fn();

    const response = await executeHandler(
      { runMutation, runQuery: vi.fn(), runAction: vi.fn() },
      new Request("https://example.com/agent/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Service-Key": "svc_key_a",
          "X-Agent-App": "crm",
        },
        body: JSON.stringify({
          functionKey: "demo.list",
          args: {},
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("returns 400 when service key header is missing", async () => {
    const executeHandler = setupExecuteHandler(config, {
      serviceKeys: { "railway-a": "svc_key_a" },
    });
    const runMutation = vi.fn();

    const response = await executeHandler(
      { runMutation, runQuery: vi.fn(), runAction: vi.fn() },
      new Request("https://example.com/agent/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Service-Id": "railway-a",
          "X-Agent-App": "crm",
        },
        body: JSON.stringify({
          functionKey: "demo.list",
          args: {},
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("returns 400 when app header is missing", async () => {
    const executeHandler = setupExecuteHandler(config, {
      serviceKeys: { "railway-a": "svc_key_a" },
    });
    const runMutation = vi.fn();

    const response = await executeHandler(
      { runMutation, runQuery: vi.fn(), runAction: vi.fn() },
      new Request("https://example.com/agent/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Service-Id": "railway-a",
          "X-Agent-Service-Key": "svc_key_a",
        },
        body: JSON.stringify({
          functionKey: "demo.list",
          args: {},
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("returns 401 when service id is not configured", async () => {
    const executeHandler = setupExecuteHandler(config, {
      serviceKeys: { "railway-a": "svc_key_a" },
    });
    const runMutation = vi.fn();

    const response = await executeHandler(
      { runMutation, runQuery: vi.fn(), runAction: vi.fn() },
      new Request("https://example.com/agent/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Service-Id": "railway-b",
          "X-Agent-Service-Key": "svc_key_b",
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

  test("returns 401 when service key mismatches configured service id", async () => {
    const executeHandler = setupExecuteHandler(config, {
      serviceKeys: { "railway-a": "svc_key_a" },
    });
    const runMutation = vi.fn();

    const response = await executeHandler(
      { runMutation, runQuery: vi.fn(), runAction: vi.fn() },
      new Request("https://example.com/agent/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Service-Id": "railway-a",
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

  test("returns 500 when service key map is missing", async () => {
    delete process.env.AGENT_BRIDGE_SERVICE_KEYS_JSON;
    const executeHandler = setupExecuteHandler(config);
    const runMutation = vi.fn();

    const response = await executeHandler(
      { runMutation, runQuery: vi.fn(), runAction: vi.fn() },
      new Request("https://example.com/agent/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Service-Id": "railway-a",
          "X-Agent-Service-Key": "svc_key_a",
          "X-Agent-App": "crm",
        },
        body: JSON.stringify({
          functionKey: "demo.list",
          args: {},
        }),
      }),
    );

    expect(response.status).toBe(500);
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("returns 500 when env service key map is invalid JSON", async () => {
    process.env.AGENT_BRIDGE_SERVICE_KEYS_JSON = "not-json";
    const executeHandler = setupExecuteHandler(config);
    const runMutation = vi.fn();

    const response = await executeHandler(
      { runMutation, runQuery: vi.fn(), runAction: vi.fn() },
      new Request("https://example.com/agent/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Service-Id": "railway-a",
          "X-Agent-Service-Key": "svc_key_a",
          "X-Agent-App": "crm",
        },
        body: JSON.stringify({
          functionKey: "demo.list",
          args: {},
        }),
      }),
    );

    expect(response.status).toBe(500);
    expect(runMutation).not.toHaveBeenCalled();
    process.env.AGENT_BRIDGE_SERVICE_KEYS_JSON = originalEnv;
  });
});
