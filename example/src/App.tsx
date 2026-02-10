import "./App.css";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { useState } from "react";
import { useAgentBridgeAdminClient } from "./agentBridgeAdminClient";

function App() {
  const convexUrl = import.meta.env.VITE_CONVEX_URL?.replace(
    ".cloud",
    ".site",
  );
  const configuredFunctions = useQuery(api.example.configuredFunctions, {});
  const agents = useQuery(api.example.agents, {});
  const accessLogs = useQuery(api.example.accessLogs, { limit: 10 });
  const adminClient = useAgentBridgeAdminClient();

  const [agentName, setAgentName] = useState("");
  const [agentApiKey, setAgentApiKey] = useState("");
  const [serviceKey, setServiceKey] = useState("");

  return (
    <>
      <h1>Agent Bridge - Demo</h1>
      <div className="card">
        <h3>Create Agent</h3>
        <input
          type="text"
          value={agentName}
          onChange={(event) => setAgentName(event.target.value)}
          placeholder="Agent name"
          style={{ marginRight: "0.5rem", padding: "0.5rem" }}
        />
        <input
          type="text"
          value={agentApiKey}
          onChange={(event) => setAgentApiKey(event.target.value)}
          placeholder="API key"
          style={{ marginRight: "0.5rem", padding: "0.5rem" }}
        />
        <button
          onClick={async () => {
            if (!agentName || !agentApiKey) {
              return;
            }
            await adminClient.createAgentWithPolicies({
              name: agentName,
              apiKey: agentApiKey,
              rules: [{ pattern: "demo.*", permission: "allow" }],
            });
            setAgentName("");
            setAgentApiKey("");
          }}
        >
          Create Agent
        </button>
        <button
          onClick={() => setAgentApiKey(adminClient.generateApiKey())}
          style={{ marginLeft: "0.5rem" }}
        >
          Generate API Key
        </button>

        <h3 style={{ marginTop: "1.5rem" }}>Generate Service Key</h3>
        <input
          type="text"
          value={serviceKey}
          onChange={(event) => setServiceKey(event.target.value)}
          placeholder="Service key"
          style={{ marginRight: "0.5rem", padding: "0.5rem", width: "420px" }}
        />
        <button onClick={() => setServiceKey(adminClient.generateServiceKey())}>
          Generate Service Key
        </button>

        <h3 style={{ marginTop: "1.5rem" }}>Configured Functions</h3>
        <ul style={{ textAlign: "left", fontSize: "0.85rem" }}>
          {(configuredFunctions ?? []).map((fn) => (
            <li key={fn.functionKey}>
              <code>{fn.functionKey}</code> ({fn.type})
              {fn.description ? ` -- ${fn.description}` : ""}
            </li>
          ))}
        </ul>

        <h3 style={{ marginTop: "1.5rem" }}>Agents</h3>
        <ul style={{ textAlign: "left", fontSize: "0.85rem" }}>
          {(agents ?? []).map((agent) => (
            <li key={agent._id}>
              {agent.name}
              {agent.appKey ? ` (${agent.appKey})` : ""} -{" "}
              {agent.enabled ? "enabled" : "disabled"} - limit{" "}
              {agent.rateLimit}/h
            </li>
          ))}
        </ul>

        <h3 style={{ marginTop: "1.5rem" }}>Recent Logs</h3>
        <ul style={{ textAlign: "left", fontSize: "0.85rem" }}>
          {(accessLogs ?? []).map((log, index) => (
            <li key={`${log._id}-${index}`}>
              [{new Date(log.timestamp).toLocaleTimeString()}]{" "}
              <code>{log.functionKey}</code>
              {log.error ? ` - ERROR: ${log.error}` : " - success"}
              {` (${log.duration}ms)`}
            </li>
          ))}
        </ul>

        <div
          style={{
            marginTop: "1.5rem",
            padding: "1rem",
            backgroundColor: "rgba(128, 128, 128, 0.1)",
            borderRadius: "8px",
          }}
        >
          <h3>HTTP Endpoints</h3>
          <ul style={{ textAlign: "left", fontSize: "0.85rem" }}>
            <li>
              <code>POST {convexUrl}/agent/execute</code>
            </li>
            <li>
              <a
                href={`${convexUrl}/agent/functions`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <code>GET {convexUrl}/agent/functions</code>
              </a>
            </li>
          </ul>
        </div>
      </div>
    </>
  );
}

export default App;
