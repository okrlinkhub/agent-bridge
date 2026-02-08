import "./App.css";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { useState } from "react";

function App() {
  const convexUrl = import.meta.env.VITE_CONVEX_URL?.replace(
    ".cloud",
    ".site",
  );

  return (
    <>
      <h1>Agent Bridge - Demo</h1>
      <div className="card">
        <SetupPanel />
        <AgentsPanel />
        <FunctionsPanel />
        <AccessLogPanel />
        <div
          style={{
            marginTop: "1.5rem",
            padding: "1rem",
            backgroundColor: "rgba(128, 128, 128, 0.1)",
            borderRadius: "8px",
          }}
        >
          <h3>HTTP Endpoints</h3>
          <p style={{ fontSize: "0.9rem" }}>
            The component exposes the following endpoints:
          </p>
          <ul style={{ textAlign: "left", fontSize: "0.85rem" }}>
            <li>
              <code>POST {convexUrl}/agent-bridge/execute</code> -- Gateway
            </li>
            <li>
              <code>POST {convexUrl}/agent-bridge/provision</code> --
              Provisioning
            </li>
            <li>
              <a
                href={`${convexUrl}/agent-bridge/health`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <code>GET {convexUrl}/agent-bridge/health</code>
              </a>{" "}
              -- Health check
            </li>
          </ul>
        </div>
        <p style={{ marginTop: "1rem", fontSize: "0.85rem", color: "#888" }}>
          See <code>example/convex/example.ts</code> for the full integration
          code.
        </p>
      </div>
    </>
  );
}

function SetupPanel() {
  const setup = useMutation(api.example.setup);
  const [setupDone, setSetupDone] = useState(false);

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <h3>1. Setup</h3>
      <button
        onClick={async () => {
          await setup();
          setSetupDone(true);
        }}
        disabled={setupDone}
      >
        {setupDone ? "Setup Complete" : "Run Setup (configure + register functions)"}
      </button>
    </div>
  );
}

function AgentsPanel() {
  const agents = useQuery(api.example.agents);
  const generateToken = useMutation(api.example.generateToken);
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState("");
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <h3>2. Agents</h3>
      <div style={{ marginBottom: "1rem" }}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Employee email"
          style={{ marginRight: "0.5rem", padding: "0.5rem" }}
        />
        <input
          type="text"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          placeholder="Department"
          style={{ marginRight: "0.5rem", padding: "0.5rem" }}
        />
        <button
          onClick={async () => {
            if (email && department) {
              const result = await generateToken({
                employeeEmail: email,
                department,
              });
              setGeneratedToken(result.token);
            }
          }}
        >
          Generate Token
        </button>
      </div>
      {generatedToken && (
        <div
          style={{
            padding: "0.5rem",
            backgroundColor: "rgba(0,128,0,0.1)",
            borderRadius: "4px",
            fontSize: "0.85rem",
            wordBreak: "break-all",
            marginBottom: "1rem",
          }}
        >
          Token: <code>{generatedToken}</code>
        </div>
      )}
      <p style={{ fontSize: "0.9rem" }}>
        Registered agents: {agents?.length ?? 0}
      </p>
      {agents && agents.length > 0 && (
        <ul style={{ textAlign: "left", fontSize: "0.85rem" }}>
          {agents.map((a) => (
            <li key={a.agentId}>
              {a.employeeEmail} ({a.department}) -{" "}
              {a.isActive ? "active" : "revoked"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FunctionsPanel() {
  const functions = useQuery(api.example.registeredFunctions);

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <h3>3. Registered Functions</h3>
      {functions && functions.length > 0 ? (
        <ul style={{ textAlign: "left", fontSize: "0.85rem" }}>
          {functions.map((fn) => (
            <li key={fn.functionName}>
              <code>{fn.functionName}</code> ({fn.functionType})
              {fn.description && ` -- ${fn.description}`}
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ fontSize: "0.85rem", color: "#888" }}>
          No functions registered yet. Run setup first.
        </p>
      )}
    </div>
  );
}

function AccessLogPanel() {
  const logs = useQuery(api.example.accessLogs, { limit: 10 });

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <h3>4. Access Log</h3>
      {logs && logs.length > 0 ? (
        <ul style={{ textAlign: "left", fontSize: "0.85rem" }}>
          {logs.map((log, i) => (
            <li key={i}>
              [{new Date(log.timestamp).toLocaleTimeString()}]{" "}
              <code>{log.functionCalled}</code> - {log.permission}
              {log.durationMs && ` (${log.durationMs}ms)`}
              {log.errorMessage && ` - ERROR: ${log.errorMessage}`}
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ fontSize: "0.85rem", color: "#888" }}>
          No access logs yet.
        </p>
      )}
    </div>
  );
}

export default App;
