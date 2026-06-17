import express from "express";
import { discoverSubnets } from "./src/scanner/subnet-discovery.js";
import { discoverHosts } from "./src/scanner/host-discovery.js";
import { scanHost } from "./src/scanner/port-scanner.js";
import { traceRoute } from "./src/scanner/traceroute.js";
import { buildTopology } from "./src/analyzer/topology-builder.js";
import { CredentialManager, Blacklist } from "./src/security.js";

const app = express();
app.use(express.json());

const scanStates = new Map();
const credentialManager = new CredentialManager();
const blacklist = new Blacklist();
credentialManager.addSnmpV2("public");
credentialManager.addSnmpV2("private");

function setScanState(state) {
  scanStates.set(state.scanId, state);
  setTimeout(() => {
    const s = scanStates.get(state.scanId);
    if (s && (s.status === "done" || s.status === "cancelled")) scanStates.delete(state.scanId);
  }, 30 * 60 * 1000);
}

// --- REST API ---

// Start a full scan
app.post("/api/scan/start", async (req, res) => {
  const { startSubnet } = req.body || {};
  const scanId = `scan_${Date.now()}`;
  const state = {
    scanId, status: "running", phase: "subnet_detect",
    phases: [
      { name: "subnet_detect", total: 1, done: 0, status: "pending" },
      { name: "host_discovery", total: 0, done: 0, status: "pending" },
      { name: "port_scan", total: 0, done: 0, status: "pending" },
      { name: "topology_build", total: 1, done: 0, status: "pending" },
    ],
    intermediate: { hostsFound: 0, routersFound: 0, switchesFound: 0, edgesFound: 0 },
  };
  setScanState(state);
  res.json({ scanId });

  // Run scan async
  try {
    state.phases[0].status = "running";
    const subnets = startSubnet
      ? [{ subnet: startSubnet, source: "user", gateway: null }]
      : await discoverSubnets({ includeHeuristic: true });
    state.phases[0].done = 1;
    state.phases[0].status = "done";

    state.phase = "host_discovery";
    state.phases[1].total = subnets.length;
    state.phases[1].status = "running";
    let allHosts = [];
    for (let i = 0; i < subnets.length; i++) {
      if (state._abort) break;
      const hosts = await discoverHosts(subnets[i].subnet);
      allHosts = allHosts.concat(hosts.map(h => ({ ...h, subnet: subnets[i].subnet })));
      state.phases[1].done = i + 1;
      state.intermediate.hostsFound = allHosts.length;
    }
    state.phases[1].status = "done";

    state.phase = "port_scan";
    const scanTargets = allHosts.slice(0, 50);
    state.phases[2].total = scanTargets.length;
    state.phases[2].status = "running";
    let hostDetails = [];
    for (let i = 0; i < scanTargets.length; i++) {
      if (state._abort) break;
      try { hostDetails.push(await scanHost(scanTargets[i].ip, { portRange: "1-1000" })); } catch {}
      state.phases[2].done = i + 1;
    }
    state.phases[2].status = "done";

    state.phase = "topology_build";
    state.phases[3].status = "running";
    const topology = buildTopology({ hosts: allHosts, hostDetails, traces: [] });
    state.phases[3].done = 1;
    state.phases[3].status = "done";
    state.status = "done";
    state.topology = topology;
  } catch (e) {
    state.status = "error";
    state.error = e.message;
  }
});

// Scan progress
app.get("/api/scan/:scanId/progress", (req, res) => {
  const state = scanStates.get(req.params.scanId);
  if (!state) return res.status(404).json({ error: "scan not found" });
  res.json(state);
});

// Cancel scan
app.post("/api/scan/:scanId/cancel", (req, res) => {
  const state = scanStates.get(req.params.scanId);
  if (state) { state.status = "cancelled"; state._abort = true; }
  res.json({ cancelled: true });
});

// Topology data
app.get("/api/topology/:scanId", (req, res) => {
  const state = scanStates.get(req.params.scanId);
  if (!state || !state.topology) return res.status(404).json({ error: "topology not ready" });
  res.json(state.topology);
});

// Latest completed scan
app.get("/api/latest-scan", (req, res) => {
  const scans = Array.from(scanStates.values())
    .filter(s => s.status === "done" && s.topology)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  if (scans.length === 0) return res.status(404).json({ error: "no completed scans" });
  res.json({ scanId: scans[0].scanId });
});

// Subnet discovery (for UI)
app.get("/api/subnets", async (req, res) => {
  try {
    const subnets = await discoverSubnets({ includeHeuristic: true });
    res.json(subnets);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Static UI
app.use(express.static("public"));
app.use("/ui", express.static("src/ui"));

const listener = app.listen(process.env.PORT || 0, "127.0.0.1", () => {
  const port = listener.address().port;
  console.log(`[NetTopology] embed-webview`);
  console.log(JSON.stringify({ type: "http_start", port }));
});
