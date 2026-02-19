import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { initConvexTest } from "./setup.test";
import { api } from "./_generated/api";
import { components } from "./_generated/api";

describe("example app", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
  });

  test("configured functions are listed from config file", async () => {
    const t = initConvexTest();
    const functions = await t.query(api.example.configuredFunctions, {});
    expect(functions.map((f) => f.functionKey)).toContain("demo.listItems");
  });

  test("api key auth + wildcard permission + rate limiting", async () => {
    const t = initConvexTest();
    const { agentId } = await t.mutation(api.example.createAgent, {
      name: "demo-agent",
      apiKey: "sk_demo_123",
      rateLimit: 2,
    });
    await t.mutation(api.example.setAgentPermissions, {
      agentId,
      rules: [{ pattern: "demo.*", permission: "allow" }],
    });

    const firstAuth = await t.mutation(
      components.agentBridge.gateway.authorizeRequest,
      {
        apiKey: "sk_demo_123",
        functionKey: "demo.listItems",
      },
    );
    expect(firstAuth.authorized).toBe(true);

    if (!firstAuth.authorized) {
      throw new Error("Expected first authorization to succeed");
    }

    await t.mutation(components.agentBridge.gateway.logAccess, {
      agentId: firstAuth.agentId,
      functionKey: "demo.listItems",
      args: {},
      result: { ok: true },
      duration: 10,
      timestamp: Date.now(),
    });
    await t.mutation(components.agentBridge.gateway.logAccess, {
      agentId: firstAuth.agentId,
      functionKey: "demo.listItems",
      args: {},
      result: { ok: true },
      duration: 12,
      timestamp: Date.now(),
    });

    const thirdAuth = await t.mutation(
      components.agentBridge.gateway.authorizeRequest,
      {
        apiKey: "sk_demo_123",
        functionKey: "demo.listItems",
      },
    );
    expect(thirdAuth.authorized).toBe(false);
    if (thirdAuth.authorized) {
      throw new Error("Expected third authorization to fail");
    }
    expect(thirdAuth.statusCode).toBe(429);
  });

  test("function override can disable configured function", async () => {
    const t = initConvexTest();
    const { agentId } = await t.mutation(api.example.createAgent, {
      name: "override-agent",
      apiKey: "sk_demo_override",
      rateLimit: 10,
    });
    await t.mutation(api.example.setAgentPermissions, {
      agentId,
      rules: [{ pattern: "demo.listItems", permission: "allow" }],
    });

    await t.mutation(api.example.setFunctionOverrides, {
      overrides: [{ key: "demo.listItems", enabled: false }],
    });

    const authResult = await t.mutation(
      components.agentBridge.gateway.authorizeRequest,
      {
        apiKey: "sk_demo_override",
        functionKey: "demo.listItems",
      },
    );
    expect(authResult.authorized).toBe(false);
    if (authResult.authorized) {
      throw new Error("Expected authorization to fail");
    }
    expect(authResult.statusCode).toBe(403);
  });

  test("app key auth resolves the correct agent", async () => {
    const t = initConvexTest();
    const { agentId } = await t.mutation(components.agentBridge.agents.createAgent, {
      name: "crm-agent",
      appKey: "crm",
      apiKey: "sk_demo_crm",
      rateLimit: 10,
    });
    await t.mutation(api.example.setAgentPermissions, {
      agentId,
      rules: [{ pattern: "demo.listItems", permission: "allow" }],
    });

    const authResult = await t.mutation(
      components.agentBridge.gateway.authorizeByAppKey,
      {
        appKey: "crm",
        functionKey: "demo.listItems",
      },
    );

    expect(authResult.authorized).toBe(true);
  });

  test("app key auth fails when app is not registered", async () => {
    const t = initConvexTest();
    const authResult = await t.mutation(
      components.agentBridge.gateway.authorizeByAppKey,
      {
        appKey: "missing-app",
        functionKey: "demo.listItems",
      },
    );

    expect(authResult.authorized).toBe(false);
    if (authResult.authorized) {
      throw new Error("Expected authorization to fail");
    }
    expect(authResult.statusCode).toBe(404);
  });

  test("app key auth supports multiple agents for the same app key", async () => {
    const t = initConvexTest();
    const first = await t.mutation(components.agentBridge.agents.createAgent, {
      name: "crm-agent-disabled",
      appKey: "crm",
      apiKey: "sk_demo_crm_disabled",
      enabled: false,
      rateLimit: 10,
    });
    const second = await t.mutation(components.agentBridge.agents.createAgent, {
      name: "crm-agent-enabled",
      appKey: "crm",
      apiKey: "sk_demo_crm_enabled",
      enabled: true,
      rateLimit: 10,
    });

    await t.mutation(api.example.setAgentPermissions, {
      agentId: first.agentId,
      rules: [{ pattern: "demo.listItems", permission: "allow" }],
    });
    await t.mutation(api.example.setAgentPermissions, {
      agentId: second.agentId,
      rules: [{ pattern: "demo.listItems", permission: "allow" }],
    });

    const authResult = await t.mutation(
      components.agentBridge.gateway.authorizeByAppKey,
      {
        appKey: "crm",
        functionKey: "demo.listItems",
      },
    );

    expect(authResult.authorized).toBe(true);
    if (!authResult.authorized) {
      throw new Error("Expected authorization to succeed");
    }
    expect(authResult.agentId).toBe(second.agentId);
  });
});
