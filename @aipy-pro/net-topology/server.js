import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "./src/mcp/tools.js";
import { registerPrompts } from "./src/mcp/prompts.js";

const app = express();
app.use(express.json());

const scanStates = new Map();
const getScanState = (id) => scanStates.get(id);
const setScanState = (state) => { scanStates.set(state.scanId, state); };

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

const server = new McpServer({
  name: "@aipy-pro/net-topology",
  version: "1.0.0",
});

registerTools(server, { getScanState, setScanState });
registerPrompts(server);

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
});
await server.connect(transport);
app.post("/mcp", async (req, res) => {
  await transport.handleRequest(req, res, req.body);
});

const listener = app.listen(0, () => {
  console.log(`MCP server listening on port ${listener.address().port}`);
});
