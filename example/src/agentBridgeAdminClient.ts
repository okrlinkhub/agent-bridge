import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import {
  generateAgentApiKey,
  generateAgentBridgeServiceKey,
} from "@okrlinkhub/agent-bridge";

type PermissionRule = {
  pattern: string;
  permission: "allow" | "deny" | "rate_limited";
  rateLimitConfig?: {
    requestsPerHour: number;
    tokenBudget?: number;
  };
};

type FunctionOverride = {
  key: string;
  enabled: boolean;
  globalRateLimit?: number;
};

export function useAgentBridgeAdminClient() {
  const createAgentMutation = useMutation(api.example.createAgent);
  const setAgentPermissionsMutation = useMutation(api.example.setAgentPermissions);
  const setFunctionOverridesMutation = useMutation(api.example.setFunctionOverrides);

  const createAgentWithPolicies = async (args: {
    name: string;
    appKey?: string;
    apiKey?: string;
    rateLimit?: number;
    rules?: PermissionRule[];
    overrides?: FunctionOverride[];
  }) => {
    const apiKey = args.apiKey ?? generateAgentApiKey();
    const { agentId } = await createAgentMutation({
      name: args.name,
      appKey: args.appKey,
      apiKey,
      rateLimit: args.rateLimit,
    });

    if (args.rules && args.rules.length > 0) {
      await setAgentPermissionsMutation({
        agentId,
        rules: args.rules,
      });
    }

    if (args.overrides && args.overrides.length > 0) {
      await setFunctionOverridesMutation({
        overrides: args.overrides,
      });
    }

    return { agentId, apiKey };
  };

  const generateApiKey = (prefix?: string) => generateAgentApiKey(prefix);
  const generateServiceKey = (prefix?: string) =>
    generateAgentBridgeServiceKey(prefix);

  return {
    createAgent: createAgentMutation,
    setAgentPermissions: setAgentPermissionsMutation,
    setFunctionOverrides: setFunctionOverridesMutation,
    createAgentWithPolicies,
    generateApiKey,
    generateServiceKey,
  };
}
