import {
  defineAgentBridgeConfig,
  type AgentBridgeConfig,
} from "@okrlinkhub/agent-bridge";
import { api } from "./convex/_generated/api";

const config: AgentBridgeConfig = defineAgentBridgeConfig({
  functions: {
    "demo.listItems": {
      ref: api.example.listItems,
      type: "query",
    },
    "demo.getItem": {
      ref: api.example.getItem,
      type: "query",
    },
    "demo.createItem": {
      ref: api.example.createItem,
      type: "mutation",
    },
  },
  metadata: {
    "demo.listItems": {
      description: "Lista tutti gli item attivi",
      riskLevel: "low",
      category: "demo",
    },
    "demo.getItem": {
      description: "Restituisce un item per ID",
      riskLevel: "low",
      category: "demo",
    },
    "demo.createItem": {
      description: "Crea un nuovo item",
      riskLevel: "medium",
      category: "demo",
    },
  },
});

export default config;
