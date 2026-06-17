import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools, setServerPort } from "./src/mcp/tools.js";
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

app.get("/api/latest-scan", (req, res) => {
  const scans = Array.from(scanStates.values())
    .filter(s => s.status === "done" && s.topology)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  if (scans.length === 0) return res.status(404).json({ error: "no completed scans" });
  res.json({ scanId: scans[0].scanId });
});

app.use(express.static("public"));
app.use("/ui", express.static("src/ui"));

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
// MCP Streamable HTTP — AiPy Pro client doesn't send text/event-stream Accept
// SDK requires it, so inject before passing to transport
function fixAcceptHeader(req) {
  if (!req.headers["accept"]?.includes("text/event-stream")) {
    req.headers["accept"] = (req.headers["accept"] || "*/*") + ", text/event-stream";
  }
}

app.get("/mcp", (req, res) => {
  fixAcceptHeader(req);
  transport.handleRequest(req, res, req.body).catch(e => {
    if (!res.headersSent) res.status(500).json({ error: e.message });
  });
});
app.post("/mcp", (req, res) => {
  fixAcceptHeader(req);
  transport.handleRequest(req, res, req.body).catch(e => {
    if (!res.headersSent) res.status(500).json({ error: e.message });
  });
});
app.delete("/mcp", (req, res) => {
  fixAcceptHeader(req);
  transport.handleRequest(req, res, req.body).catch(e => {
    if (!res.headersSent) res.status(500).json({ error: e.message });
  });
});

const listener = app.listen(process.env.PORT || 0, "127.0.0.1", () => {
  const port = listener.address().port;
  setServerPort(port);
  console.log(`[NetTopology] embed-webview + conversation-tool`);
  console.log(JSON.stringify({ type: "http_start", port }));
});
