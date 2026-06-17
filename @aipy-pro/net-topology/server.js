import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "./src/mcp/tools.js";
import { registerPrompts } from "./src/mcp/prompts.js";
import { CredentialManager, Blacklist } from "./src/security.js";

const app = express();
app.use(express.json());

const scanStates = new Map();
const credentialManager = new CredentialManager();
const blacklist = new Blacklist();
credentialManager.addSnmpV2("public");
credentialManager.addSnmpV2("private");
const getScanState = (id) => scanStates.get(id);
const setScanState = (state) => {
  scanStates.set(state.scanId, state);
  // Auto-evict after 30 minutes
  setTimeout(() => {
    const s = scanStates.get(state.scanId);
    if (s && (s.status === "done" || s.status === "cancelled")) {
      scanStates.delete(state.scanId);
    }
  }, 30 * 60 * 1000);
};

app.get("/api/progress/:scanId", (req, res) => {
  const state = scanStates.get(req.params.scanId);
  if (!state) return res.status(404).json({ error: "scan not found" });
  res.json(state);
});

app.put("/api/scan/cancel", (req, res) => {
  const { scanId } = req.body;
  const state = scanStates.get(scanId);
  if (state) { state.status = "cancelled"; state._abort = true; }
  res.json({ cancelled: true });
});

app.get("/api/topology/:scanId", (req, res) => {
  const state = scanStates.get(req.params.scanId);
  if (!state || !state.topology) return res.status(404).json({ error: "topology not ready" });
  res.json(state.topology);
});

app.use("/ui", express.static("src/ui"));
app.get("/", (req, res) => res.redirect("/ui/index.html"));

const server = new McpServer({
  name: "@aipy-pro/net-topology",
  version: "1.0.0",
});

registerTools(server, { getScanState, setScanState, credentialManager, blacklist });
registerPrompts(server);

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
});
await server.connect(transport);
app.post("/mcp", async (req, res) => {
  await transport.handleRequest(req, res, req.body);
});

const listener = app.listen(0, () => {
  process.env.AIPY_PORT = String(listener.address().port);
  process.env.AIPY_HOST = "127.0.0.1";
  console.log(`MCP server listening on port ${listener.address().port}`);
});
